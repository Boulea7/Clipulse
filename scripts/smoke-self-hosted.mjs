import { startVitest } from 'vitest/node'

const smokeTestPath = 'smoke/self-hosted-wiring.test.ts'

const context = await startVitest('test', [smokeTestPath], {
  config: false,
  environment: 'node',
  root: process.cwd(),
})
const failed = context?.state.getCountOfFailedTests?.() ?? 0
await context?.close()

if (failed > 0) {
  process.exit(1)
}
