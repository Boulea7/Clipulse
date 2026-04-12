import { runSmokeCommand } from './smoke-shared.mjs'
import { getRepoRoot } from './smoke-shared.mjs'

const repoRoot = getRepoRoot(import.meta.url)

await runSmokeCommand({
  command: 'node',
  args: ['scripts/smoke-gemini.mjs'],
  cwd: repoRoot,
  onStdoutChunk: (chunk) => process.stdout.write(chunk),
  onStderrChunk: (chunk) => process.stderr.write(chunk),
  stepLabel: 'adapter smoke: gemini',
})

await runSmokeCommand({
  command: 'node',
  args: ['scripts/smoke-opencode.mjs'],
  cwd: repoRoot,
  onStdoutChunk: (chunk) => process.stdout.write(chunk),
  onStderrChunk: (chunk) => process.stderr.write(chunk),
  stepLabel: 'adapter smoke: opencode',
})
