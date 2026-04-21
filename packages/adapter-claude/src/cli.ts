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
  buildClaudeHookEvent,
  clearClaudeTranscriptStateVariants,
  readClaudeTranscriptState,
  writeClaudeTranscriptState,
} from './index.js'

interface ClaudeCliDependencies {
  deliverBatch?: typeof deliverBatch
  env?: NodeJS.ProcessEnv
  fileExists?: (filePath: string) => Promise<boolean>
  readFile?: (filePath: string) => Promise<string>
  readStdin?: () => Promise<string>
  stdout?: {
    write: (chunk: string) => void
  }
}

export async function runClaudeCli(dependencies: ClaudeCliDependencies = {}): Promise<void> {
  const env = dependencies.env ?? process.env
  const readStdin = dependencies.readStdin ?? defaultReadStdin
  const readFile = dependencies.readFile ?? defaultReadFile
  const fileExists = dependencies.fileExists ?? defaultFileExists
  const writeStdout = dependencies.stdout?.write ?? process.stdout.write.bind(process.stdout)
  const deliverBatchFn = dependencies.deliverBatch ?? deliverBatch
  const rawInput = (await readStdin()).trim()

  if (!rawInput) {
    return
  }

  const input = parseClaudeCliInput(rawInput)
  const cwd = typeof input.cwd === 'string' ? input.cwd : ''
  const projectContext = cwd
    ? await resolveProjectContext(cwd)
    : null
  if (
    projectContext
    && await shouldSkipUnmarkedProject(projectContext, env)
  ) {
    return
  }
  const scopedInput = projectContext
    ? {
        ...input,
        cwd: projectContext.workspaceRoot,
      }
    : input

  const transcriptPath = typeof scopedInput.transcript_path === 'string' ? scopedInput.transcript_path : ''
  const transcript = transcriptPath && await fileExists(transcriptPath)
    ? await readFile(transcriptPath)
    : ''
  const stateDir = env.CLIPULSE_STATE_DIR ?? resolveStateDir()
  const previousState = await readClaudeTranscriptState(stateDir, scopedInput as never)
  const result = await buildClaudeHookEvent(scopedInput as never, transcript, {
    stateDir,
    previousState,
  })
  await handoffPreparedEvent(
    {
      event: result.event,
      commit: async () => {
        await persistClaudeState(stateDir, scopedInput as never, result.nextState)
      },
    },
    {
      apiBaseUrl: env.CLIPULSE_API_URL,
      apiBearerToken: env.CLIPULSE_API_BEARER_TOKEN,
      deliverBatch: deliverBatchFn,
      stateDir,
      writeStdout,
    },
  )
}

async function defaultReadStdin(): Promise<string> {
  return fs.readFileSync(0, 'utf-8')
}

async function defaultReadFile(filePath: string): Promise<string> {
  return fs.promises.readFile(filePath, 'utf-8')
}

async function defaultFileExists(filePath: string): Promise<boolean> {
  return fs.existsSync(filePath)
}

function parseClaudeCliInput(rawInput: string): {
  session_id: string
  cwd: string
  hook_event_name: string
  transcript_path?: string
  [key: string]: unknown
} {
  let parsed: unknown

  try {
    parsed = JSON.parse(rawInput)
  } catch {
    throw new Error('Invalid Claude hook stdin: expected a JSON object.')
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid Claude hook stdin: expected a JSON object.')
  }

  const input = parsed as Record<string, unknown>
  const requiredStringFields = [
    'session_id',
    'cwd',
    'hook_event_name',
  ] as const

  for (const fieldName of requiredStringFields) {
    if (typeof input[fieldName] !== 'string' || input[fieldName].trim().length === 0) {
      throw new Error(`Invalid Claude hook stdin: "${fieldName}" must be a non-empty string.`)
    }
  }

  if (
    'transcript_path' in input
    && input.transcript_path != null
    && typeof input.transcript_path !== 'string'
  ) {
    throw new Error('Invalid Claude hook stdin: "transcript_path" must be a string when provided.')
  }

  return input as {
    session_id: string
    cwd: string
    hook_event_name: string
    transcript_path?: string
    [key: string]: unknown
  }
}

function formatClaudeCliError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  return 'Claude CLI failed with an unknown error.'
}

function isDirectExecution(): boolean {
  const entrypoint = process.argv[1]
  if (!entrypoint) {
    return false
  }

  return import.meta.url === pathToFileURL(entrypoint).href
}

if (isDirectExecution()) {
  void runClaudeCli().catch((error) => {
    process.stderr.write(`${formatClaudeCliError(error)}\n`)
    process.exitCode = 1
  })
}

async function persistClaudeState(
  stateDir: string,
  input: {
    hook_event_name?: string
    [key: string]: unknown
  },
  nextState: {
    lineCount: number
    lastSubmittedAt?: string
  },
): Promise<void> {
  const eventName = typeof input.hook_event_name === 'string' ? input.hook_event_name : ''
  const normalizedEventName = eventName
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase()

  if (
    normalizedEventName === 'stop'
    || normalizedEventName === 'stop_failure'
    || normalizedEventName === 'session_end'
    || normalizedEventName === 'pre_compact'
  ) {
    await clearClaudeTranscriptStateVariants(stateDir, input as never)
    return
  }

  await writeClaudeTranscriptState(stateDir, input as never, nextState)
}
