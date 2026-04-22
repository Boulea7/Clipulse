import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

import {
  deliverBatch,
  handoffPreparedEvent,
  resolveProjectContext,
  resolveStateDir,
  shouldSkipUnmarkedProject,
} from '@clipulse/collector-core'
import { prepareOpenCodeEvent, type OpenCodeEventInput } from './index.js'

interface OpenCodePluginDependencies {
  deliverBatch?: typeof deliverBatch
  env?: NodeJS.ProcessEnv
  readStdin?: () => Promise<string>
  stderr?: {
    write: (chunk: string) => void
  }
  stdout?: {
    write: (chunk: string) => void
  }
}

class OpenCodePluginInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OpenCodePluginInputError'
  }
}

export async function runOpenCodePlugin(
  dependencies: OpenCodePluginDependencies = {},
): Promise<void> {
  const env = dependencies.env ?? process.env
  const readStdin = dependencies.readStdin ?? defaultReadStdin
  const writeStdout = dependencies.stdout?.write ?? process.stdout.write.bind(process.stdout)
  const deliverBatchFn = dependencies.deliverBatch ?? deliverBatch
  const rawInput = (await readStdin()).trim()

  if (!rawInput) {
    return
  }

  const input = parseOpenCodeEventInput(rawInput)
  const projectContext = await resolveProjectContext(input.cwd)
  if (await shouldSkipUnmarkedProject(projectContext, env)) {
    return
  }
  const stateDir = env.CLIPULSE_STATE_DIR ?? resolveStateDir()
  const prepared = await prepareOpenCodeEvent(input, {
    stateDir,
  })
  await handoffPreparedEvent(prepared, {
    apiBaseUrl: env.CLIPULSE_API_URL,
    apiBearerToken: env.CLIPULSE_API_BEARER_TOKEN,
    deliverBatch: deliverBatchFn,
    stateDir,
    writeStdout,
  })
}

export async function runOpenCodePluginCli(
  dependencies: OpenCodePluginDependencies = {},
): Promise<number> {
  const writeStderr = dependencies.stderr?.write ?? process.stderr.write.bind(process.stderr)

  try {
    await runOpenCodePlugin(dependencies)
    return 0
  } catch (error) {
    writeStderr(`${formatTopLevelPluginError(error)}\n`)
    return 1
  }
}

async function defaultReadStdin(): Promise<string> {
  return fs.readFileSync(0, 'utf-8')
}

function parseOpenCodeEventInput(rawInput: string): OpenCodeEventInput {
  let parsed: unknown

  try {
    parsed = JSON.parse(rawInput)
  } catch {
    throw new OpenCodePluginInputError('OpenCode adapter expected a JSON object on stdin.')
  }

  if (!isRecord(parsed)) {
    throw new OpenCodePluginInputError('OpenCode adapter expected a JSON object on stdin.')
  }

  const sessionId = requireNonEmptyString(parsed.session_id, 'session_id')
  const cwd = requireNonEmptyString(parsed.cwd, 'cwd')
  const eventName = requireNonEmptyString(parsed.event_name, 'event_name')
  const eventTime = requireOptionalString(parsed.event_time, 'event_time')
  const model = requireOptionalString(parsed.model, 'model')
  const fileEdits = requireOptionalFileEdits(parsed.file_edits)

  return {
    session_id: sessionId,
    cwd,
    event_name: eventName,
    event_time: eventTime,
    model,
    file_edits: fileEdits,
  }
}

function requireNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new OpenCodePluginInputError(
      `OpenCode adapter expected "${fieldName}" to be a non-empty string.`,
    )
  }

  return value
}

function requireOptionalString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) {
    return undefined
  }

  return requireNonEmptyString(value, fieldName)
}

function requireOptionalFileEdits(value: unknown): OpenCodeEventInput['file_edits'] {
  if (value === undefined) {
    return undefined
  }

  if (!Array.isArray(value)) {
    throw new OpenCodePluginInputError('OpenCode adapter expected "file_edits" to be an array.')
  }

  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new OpenCodePluginInputError(
        `OpenCode adapter expected "file_edits[${index}]" to be an object.`,
      )
    }

    return {
      path: requireNonEmptyString(entry.path, `file_edits[${index}].path`),
      added: requireOptionalCount(entry.added, `file_edits[${index}].added`),
      removed: requireOptionalCount(entry.removed, `file_edits[${index}].removed`),
      additions: requireOptionalCount(entry.additions, `file_edits[${index}].additions`),
      deletions: requireOptionalCount(entry.deletions, `file_edits[${index}].deletions`),
    }
  })
}

function requireOptionalCount(value: unknown, fieldName: string): number | undefined {
  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new OpenCodePluginInputError(
      `OpenCode adapter expected "${fieldName}" to be a non-negative number.`,
    )
  }

  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function formatTopLevelPluginError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return `clipulse adapter-opencode failed: ${error.message}`
  }

  return 'clipulse adapter-opencode failed: unknown error'
}

function isDirectExecution(): boolean {
  const entrypoint = process.argv[1]
  if (!entrypoint) {
    return false
  }

  return import.meta.url === pathToFileURL(entrypoint).href
}

if (isDirectExecution()) {
  void runOpenCodePluginCli().then((exitCode) => {
    if (exitCode !== 0) {
      process.exitCode = exitCode
    }
  })
}
