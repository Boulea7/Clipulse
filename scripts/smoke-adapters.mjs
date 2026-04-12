import { runSmokeCommand } from './smoke-shared.mjs'

await runSmokeCommand({
  command: 'node',
  args: ['scripts/smoke-gemini.mjs'],
  stepLabel: 'adapter smoke: gemini',
})

await runSmokeCommand({
  command: 'node',
  args: ['scripts/smoke-opencode.mjs'],
  stepLabel: 'adapter smoke: opencode',
})
