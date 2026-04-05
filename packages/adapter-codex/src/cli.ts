import fs from 'node:fs'

import { sendBatch } from '../../collector-core/src/index.js'
import { normalizeCodexHookEvent } from './index.js'

async function main(): Promise<void> {
  const rawInput = fs.readFileSync(0, 'utf-8').trim()
  if (!rawInput) {
    return
  }

  const input = JSON.parse(rawInput)
  const event = normalizeCodexHookEvent(input)
  const batch = { events: [event] }
  const apiBaseUrl = process.env.CLIPULSE_API_URL

  if (apiBaseUrl) {
    await sendBatch(apiBaseUrl, batch)
    return
  }

  process.stdout.write(`${JSON.stringify(batch)}\n`)
}

void main()
