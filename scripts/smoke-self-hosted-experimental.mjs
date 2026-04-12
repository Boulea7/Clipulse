import { getRepoRoot, runVitestSmokeFile } from './smoke-shared.mjs'

const smokeTestPath = 'smoke/self-hosted-experimental.test.ts'
const repoRoot = getRepoRoot(import.meta.url)

const failed = await runVitestSmokeFile({
  root: repoRoot,
  smokeTestPath,
})

if (failed > 0) {
  process.exit(1)
}
