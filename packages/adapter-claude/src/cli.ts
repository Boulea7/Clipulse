import fs from 'node:fs'

import { sendBatch } from '../../collector-core/src/index.js'
import { normalizeClaudeHookEvent } from './index.js'

async function main(): Promise<void> {
  const rawInput = fs.readFileSync(0, 'utf-8').trim()
  if (!rawInput) {
    return
  }

  const input = JSON.parse(rawInput) as {
    transcript_path?: string
    [key: string]: unknown
  }

  const transcriptPath = typeof input.transcript_path === 'string' ? input.transcript_path : ''
  const transcript = transcriptPath && fs.existsSync(transcriptPath)
    ? fs.readFileSync(transcriptPath, 'utf-8')
    : ''

  const event = normalizeClaudeHookEvent(input as never, transcript)
  const batch = { events: [event] }
  const apiBaseUrl = process.env.CLIPULSE_API_URL

  if (apiBaseUrl) {
    await sendBatch(apiBaseUrl, batch)
    return
  }

  process.stdout.write(`${JSON.stringify(batch)}\n`)
}

void main()

