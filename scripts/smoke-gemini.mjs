import { readFileSync } from 'node:fs'

import { parseSingleJsonBatchOutput, runSmokeCommand } from './smoke-shared.mjs'

const fixturePath = new URL('../packages/adapter-gemini/examples/after-tool.write-file.json', import.meta.url)
const input = readFileSync(fixturePath)
const stateDir = process.env.CLIPULSE_STATE_DIR ?? `${process.env.TMPDIR ?? '/tmp'}/clipulse-gemini-smoke`

const result = await runSmokeCommand({
  command: 'node',
  args: ['packages/adapter-gemini/dist/cli.js'],
  env: {
    CLIPULSE_STATE_DIR: stateDir,
  },
  input,
  stepLabel: 'gemini smoke',
})

const payload = parseSingleJsonBatchOutput(result.stdout, {
  contextLabel: 'Gemini smoke',
  expectedHost: 'gemini-cli',
  expectedSessionId: 'gemini-smoke-session',
  requiredEventNames: ['post_tool_use'],
})

if (!payload.events.some((event) => event.privacy_mode === 'hashed')) {
  throw new Error('Gemini smoke must include a hashed privacy_mode event.')
}

process.stdout.write(result.stdout)
