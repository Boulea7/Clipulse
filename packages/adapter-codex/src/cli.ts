#!/usr/bin/env node
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  deliverBatch,
  handoffPreparedEvent,
  normalizeSessionId,
  resolveProjectContext,
  resolveStateDir,
  shouldSkipUnmarkedProject,
} from '@clipulse/collector-core'
import { buildCodexHookEventResult } from './index.js'

interface CodexHookInput {
  session_id: string
  cwd: string
  hook_event_name: string
}

interface CodexCliDependencies {
  deliverBatch?: typeof deliverBatch
  env?: NodeJS.ProcessEnv
  readStdin?: () => Promise<string>
  stdout?: {
    write: (chunk: string) => void
  }
}

export async function runCodexCli(dependencies: CodexCliDependencies = {}): Promise<void> {
  const env = dependencies.env ?? process.env
  const readStdin = dependencies.readStdin ?? defaultReadStdin
  const writeStdout = dependencies.stdout?.write ?? process.stdout.write.bind(process.stdout)
  const deliverBatchFn = dependencies.deliverBatch ?? deliverBatch
  const rawInput = (await readStdin()).trim()

  if (!rawInput) {
    return
  }

  const input = parseCodexHookInput(rawInput)
  const projectContext = await resolveProjectContext(input.cwd)
  if (await shouldSkipUnmarkedProject(projectContext, env)) {
    return
  }
  const stateDir = env.CLIPULSE_STATE_DIR ?? resolveStateDir()
  const releaseTerminalLock = isCodexTerminalHookEvent(input.hook_event_name)
    ? await acquireCodexTerminalLock(stateDir, input.session_id, projectContext.projectRoot)
    : async () => {}
  try {
    const result = await buildCodexHookEventResult(input, {
      stateDir,
      suppressFinalizedTerminalRetries: true,
    })
    await handoffPreparedEvent(
      {
        event: result.event,
        commit: result.commitState,
      },
      {
        apiBaseUrl: env.CLIPULSE_API_URL,
        apiBearerToken: env.CLIPULSE_API_BEARER_TOKEN,
        deliverBatch: deliverBatchFn,
        stateDir,
        writeStdout,
      },
    )
  } finally {
    await releaseTerminalLock()
  }
}

async function defaultReadStdin(): Promise<string> {
  return fs.readFileSync(0, 'utf-8')
}

function isDirectExecution(): boolean {
  const entrypoint = process.argv[1]
  if (!entrypoint) {
    return false
  }

  return import.meta.url === pathToFileURL(fs.realpathSync(entrypoint)).href
}

if (isDirectExecution()) {
  void executeCodexCli()
}

async function executeCodexCli(): Promise<void> {
  try {
    await runCodexCli()
  } catch (error) {
    process.stderr.write(`${formatCliError(error)}\n`)
    process.exitCode = 1
  }
}

function parseCodexHookInput(rawInput: string): CodexHookInput {
  let parsed: unknown

  try {
    parsed = JSON.parse(rawInput)
  } catch {
    throw new Error('Invalid Codex hook JSON on stdin.')
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid Codex hook payload: expected a JSON object.')
  }

  const input = parsed as Partial<CodexHookInput>
  validateRequiredCodexField(input.session_id, 'session_id')
  validateRequiredCodexField(input.cwd, 'cwd')
  validateRequiredCodexField(input.hook_event_name, 'hook_event_name')

  return {
    ...(parsed as CodexHookInput),
    session_id: normalizeSessionId(input.session_id as string),
  }
}

function validateRequiredCodexField(
  value: unknown,
  fieldName: keyof CodexHookInput,
): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid Codex hook payload: expected non-empty string "${fieldName}".`)
  }
}

function isCodexTerminalHookEvent(hookEventName: string): boolean {
  const normalized = hookEventName
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase()
  return normalized === 'stop' || normalized === 'stop_failure' || normalized === 'session_end'
}

async function acquireCodexTerminalLock(
  stateDir: string,
  sessionId: string,
  projectRoot: string,
): Promise<() => Promise<void>> {
  const lockDir = getCodexTerminalLockDir(stateDir, sessionId, projectRoot)
  const startedAt = Date.now()
  const timeoutMs = 10_000
  const staleLockMs = 30_000
  await fs.promises.mkdir(path.dirname(lockDir), { recursive: true })

  while (true) {
    try {
      await fs.promises.mkdir(lockDir, { recursive: false })
      return async () => {
        await fs.promises.rm(lockDir, { recursive: true, force: true })
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EEXIST') {
        throw error
      }

      const stat = await fs.promises.stat(lockDir).catch(() => null)
      if (stat && Date.now() - stat.mtimeMs > staleLockMs) {
        await fs.promises.rm(lockDir, { recursive: true, force: true })
        continue
      }
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error('Timed out waiting for Codex terminal finalizer lock.')
      }
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
}

function getCodexTerminalLockDir(stateDir: string, sessionId: string, projectRoot: string): string {
  const stateKey = ['codex', sessionId, projectRoot].join(':')
  const fileName = `${createHash('sha1').update(stateKey).digest('hex')}.lock`
  return path.join(stateDir, 'terminal-finalizer-locks', fileName)
}

function formatCliError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return 'Codex CLI failed.'
}
