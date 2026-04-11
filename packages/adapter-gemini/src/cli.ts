import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

import { deliverBatch, resolveStateDir } from '@clipulse/collector-core'
import { buildGeminiHookEvent } from './index.js'

interface GeminiCliDependencies {
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

  const input = JSON.parse(rawInput)
  const stateDir = env.CLIPULSE_STATE_DIR ?? resolveStateDir()
  const event = await buildGeminiHookEvent(input, {
    stateDir,
  })
  if (!event) {
    if (env.CLIPULSE_GEMINI_DEBUG_HOOKS === '1' || env.CLIPULSE_GEMINI_DEBUG_HOOKS === 'true') {
      writeStderr(
        `[clipulse-gemini] ignored_hook_not_allowlisted hook_event_name=${JSON.stringify(input?.hook_event_name ?? null)}\n`,
      )
    }
    return
  }

  const batch = { events: [event] }
  const apiBaseUrl = env.CLIPULSE_API_URL

  if (apiBaseUrl) {
    await deliverBatchFn(apiBaseUrl, batch, { stateDir })
    return
  }

  writeStdout(`${JSON.stringify(batch)}\n`)
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
  void runGeminiCli()
}
