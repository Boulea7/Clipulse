import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'

const fixturePath = new URL('../packages/adapter-gemini/examples/after-tool.write-file.json', import.meta.url)
const input = readFileSync(fixturePath)
const stateDir = process.env.CLIPULSE_STATE_DIR ?? `${process.env.TMPDIR ?? '/tmp'}/clipulse-gemini-smoke`

const child = spawn(
  'node',
  ['packages/adapter-gemini/dist/cli.js'],
  {
    stdio: ['pipe', 'inherit', 'inherit'],
    env: {
      ...process.env,
      CLIPULSE_STATE_DIR: stateDir,
    },
  },
)

child.stdin.end(input)
child.on('exit', (code) => {
  process.exit(code ?? 1)
})
child.on('error', (error) => {
  console.error(error)
  process.exit(1)
})
