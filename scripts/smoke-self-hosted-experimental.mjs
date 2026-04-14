import { getRepoRoot, isDirectRun, runVitestSmokeFile } from './smoke-shared.mjs'

export const smokeTestPath = 'smoke/self-hosted-experimental.test.ts'

export async function main({
  importMetaUrl = import.meta.url,
} = {}) {
  const repoRoot = getRepoRoot(importMetaUrl)
  const failed = await runVitestSmokeFile({
    root: repoRoot,
    smokeTestPath,
  })

  if (failed > 0) {
    process.exitCode = 1
  }

  return failed
}

if (isDirectRun(import.meta.url)) {
  const failed = await main()

  if (failed > 0) {
    process.exit(1)
  }
}
