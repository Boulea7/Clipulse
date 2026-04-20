import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { deliverBatch, prepareOutboundBatch, resolveProjectContext, resolveStateDir } from '@clipulse/collector-core'
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
  if (await shouldSkipUnmarkedProject(projectContext.workspaceRoot, env)) {
    return
  }
  const stateDir = env.CLIPULSE_STATE_DIR ?? resolveStateDir()
  const result = await buildCodexHookEventResult(input, {
    stateDir,
  })
  const batch = { events: [result.event] }
  const apiBaseUrl = env.CLIPULSE_API_URL

  if (apiBaseUrl) {
    await deliverBatchFn(apiBaseUrl, batch, { stateDir })
    await result.commitState()
    return
  }

  writeStdout(`${JSON.stringify(prepareOutboundBatch(batch))}\n`)
  await result.commitState()
}

async function defaultReadStdin(): Promise<string> {
  return fs.readFileSync(0, 'utf-8')
}

function isDirectExecution(): boolean {
  const entrypoint = process.argv[1]
  if (!entrypoint) {
    return false
  }

  return import.meta.url === pathToFileURL(entrypoint).href
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

  return parsed as CodexHookInput
}

function validateRequiredCodexField(
  value: unknown,
  fieldName: keyof CodexHookInput,
): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid Codex hook payload: expected non-empty string "${fieldName}".`)
  }
}

function formatCliError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return 'Codex CLI failed.'
}

async function shouldSkipUnmarkedProject(
  projectRoot: string,
  env: NodeJS.ProcessEnv,
): Promise<boolean> {
  if (!isRequireProjectFileEnabled(env.CLIPULSE_REQUIRE_PROJECT_FILE)) {
    return false
  }

  return !(await pathExists(path.join(projectRoot, '.clipulse-project')))
}

function isRequireProjectFileEnabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase()
  return normalized === '1' || normalized === 'true'
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath)
    return true
  } catch {
    return false
  }
}
