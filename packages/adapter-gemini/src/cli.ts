import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

import {
  deliverBatch,
  handoffPreparedEvent,
  resolveProjectContext,
  resolveStateDir,
  shouldSkipUnmarkedProject,
} from '@clipulse/collector-core'
import {
  type GeminiHookInput,
  planGeminiHookEvent,
} from './index.js'

interface GeminiCliDependencies {
  deliverBatch?: typeof deliverBatch
  env?: NodeJS.ProcessEnv
  onInvalidInput?: () => void
  readStdin?: () => Promise<string>
  stderr?: {
    write: (chunk: string) => void
  }
  stdout?: {
    write: (chunk: string) => void
  }
}

interface GeminiCliEntrypointDependencies extends GeminiCliDependencies {
  exit?: (code: number) => void
}

export async function runGeminiCli(
  dependencies: GeminiCliDependencies = {},
): Promise<void> {
  const env = dependencies.env ?? process.env
  const readStdin = dependencies.readStdin ?? defaultReadStdin
  const writeStderr = dependencies.stderr?.write ?? process.stderr.write.bind(process.stderr)
  const writeStdout = dependencies.stdout?.write ?? process.stdout.write.bind(process.stdout)
  const deliverBatchFn = dependencies.deliverBatch ?? deliverBatch
  const rawInput = (await readStdin()).trim()

  if (!rawInput) {
    return
  }

  const input = parseGeminiHookInput(rawInput, writeStderr)
  if (!input) {
    dependencies.onInvalidInput?.()
    return
  }
  const projectContext = await resolveProjectContext(input.cwd)
  if (await shouldSkipUnmarkedProject(projectContext, env)) {
    return
  }
  const stateDir = env.CLIPULSE_STATE_DIR ?? resolveStateDir()
  const plannedEvent = await planGeminiHookEvent(input, {
    stateDir,
  })
  if (!plannedEvent) {
    if (isGeminiDebugHooksEnabled(env.CLIPULSE_GEMINI_DEBUG_HOOKS)) {
      writeStderr(
        `[clipulse-gemini] ignored_hook_not_allowlisted hook_event_name=${JSON.stringify(input?.hook_event_name ?? null)}\n`,
      )
    }
    return
  }

  await handoffPreparedEvent(
    plannedEvent,
    {
      apiBaseUrl: env.CLIPULSE_API_URL,
      apiBearerToken: env.CLIPULSE_API_BEARER_TOKEN,
      deliverBatch: deliverBatchFn,
      stateDir,
      writeStdout,
    },
  )
}

export async function runGeminiCliEntrypoint(
  dependencies: GeminiCliEntrypointDependencies = {},
): Promise<void> {
  const writeStderr = dependencies.stderr?.write ?? process.stderr.write.bind(process.stderr)
  const exit = dependencies.exit ?? ((code: number) => {
    process.exitCode = code
  })
  let invalidInput = false

  try {
    await runGeminiCli({
      ...dependencies,
      onInvalidInput: () => {
        invalidInput = true
        dependencies.onInvalidInput?.()
      },
    })
    if (invalidInput) {
      exit(1)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown Gemini CLI failure'
    writeStderr(`[clipulse-gemini] fatal_error message=${JSON.stringify(message)}\n`)
    exit(1)
  }
}

function parseGeminiHookInput(
  rawInput: string,
  writeStderr: (chunk: string) => void,
): GeminiHookInput | null {
  let parsed: unknown

  try {
    parsed = JSON.parse(rawInput) as unknown
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown JSON parse failure'
    writeStderr(`[clipulse-gemini] invalid_json_stdin message=${JSON.stringify(message)}\n`)
    return null
  }

  return validateGeminiHookInput(parsed, writeStderr)
}

function validateGeminiHookInput(
  input: unknown,
  writeStderr: (chunk: string) => void,
): GeminiHookInput | null {
  if (!isRecord(input)) {
    writeInvalidHookInput(writeStderr, '$', 'object', input)
    return null
  }

  if (!isNonEmptyString(input.session_id)) {
    writeInvalidHookInput(writeStderr, 'session_id', 'non-empty string', input.session_id)
    return null
  }

  if (!isNonEmptyString(input.cwd)) {
    writeInvalidHookInput(writeStderr, 'cwd', 'non-empty string', input.cwd)
    return null
  }

  if (!isNonEmptyString(input.hook_event_name)) {
    writeInvalidHookInput(writeStderr, 'hook_event_name', 'non-empty string', input.hook_event_name)
    return null
  }

  if (input.model !== undefined && typeof input.model !== 'string') {
    writeInvalidHookInput(writeStderr, 'model', 'string', input.model)
    return null
  }

  if (input.event_time !== undefined && typeof input.event_time !== 'string') {
    writeInvalidHookInput(writeStderr, 'event_time', 'string', input.event_time)
    return null
  }

  if (input.timestamp !== undefined && typeof input.timestamp !== 'string') {
    writeInvalidHookInput(writeStderr, 'timestamp', 'string', input.timestamp)
    return null
  }

  if (input.prompt !== undefined && typeof input.prompt !== 'string') {
    writeInvalidHookInput(writeStderr, 'prompt', 'string', input.prompt)
    return null
  }

  if (input.tool_name !== undefined && typeof input.tool_name !== 'string') {
    writeInvalidHookInput(writeStderr, 'tool_name', 'string', input.tool_name)
    return null
  }

  if (input.tool_input !== undefined && !isRecord(input.tool_input)) {
    writeInvalidHookInput(writeStderr, 'tool_input', 'object', input.tool_input)
    return null
  }

  return {
    session_id: input.session_id,
    cwd: input.cwd,
    hook_event_name: input.hook_event_name,
    model: input.model,
    event_time: input.event_time,
    timestamp: input.timestamp,
    prompt: input.prompt,
    tool_name: input.tool_name,
    tool_input: input.tool_input,
  }
}

function writeInvalidHookInput(
  writeStderr: (chunk: string) => void,
  field: string,
  expected: string,
  actual: unknown,
): void {
  writeStderr(
    `[clipulse-gemini] invalid_hook_input field=${JSON.stringify(field)} expected=${JSON.stringify(expected)} actual=${JSON.stringify(describeValueType(actual))}\n`,
  )
}

function isGeminiDebugHooksEnabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase()
  return normalized === '1' || normalized === 'true'
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function describeValueType(value: unknown): string {
  if (value === null) {
    return 'null'
  }

  if (Array.isArray(value)) {
    return 'array'
  }

  return typeof value
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
  void runGeminiCliEntrypoint()
}
