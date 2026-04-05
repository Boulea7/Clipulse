import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

import { deliverBatch, resolveStateDir } from '@clipulse/collector-core'
import { buildClaudeHookEvent } from './index.js'

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

  const input = JSON.parse(rawInput) as {
    transcript_path?: string
    [key: string]: unknown
  }

  const transcriptPath = typeof input.transcript_path === 'string' ? input.transcript_path : ''
  const transcript = transcriptPath && await fileExists(transcriptPath)
    ? await readFile(transcriptPath)
    : ''

  const event = await buildClaudeHookEvent(input as never, transcript, {
    stateDir: env.CLIPULSE_STATE_DIR ?? resolveStateDir(),
  })
  const batch = { events: [event] }
  const apiBaseUrl = env.CLIPULSE_API_URL

  if (apiBaseUrl) {
    await deliverBatchFn(apiBaseUrl, batch, {})
    return
  }

  writeStdout(`${JSON.stringify(batch)}\n`)
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

function isDirectExecution(): boolean {
  const entrypoint = process.argv[1]
  if (!entrypoint) {
    return false
  }

  return import.meta.url === pathToFileURL(entrypoint).href
}

if (isDirectExecution()) {
  void runClaudeCli()
}
