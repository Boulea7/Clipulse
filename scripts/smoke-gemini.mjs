import { readFileSync } from 'node:fs'

import { runSmokeCommand } from './smoke-shared.mjs'

const fixturePath = new URL('../packages/adapter-gemini/examples/after-tool.write-file.json', import.meta.url)
const input = readFileSync(fixturePath)
const stateDir = process.env.CLIPULSE_STATE_DIR ?? `${process.env.TMPDIR ?? '/tmp'}/clipulse-gemini-smoke`

await runSmokeCommand({
  command: 'node',
  args: ['packages/adapter-gemini/dist/cli.js'],
  env: {
    CLIPULSE_STATE_DIR: stateDir,
  },
  input,
})
