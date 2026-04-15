import { getRepoRoot, isDirectRun, runVitestSmokeFile } from './smoke-shared.mjs'

export const smokeTestPath = 'smoke/self-hosted-wiring.test.ts'
export const launcherSmokeTestPath = 'smoke/self-hosted-launchers.test.ts'

export async function main({
  importMetaUrl = import.meta.url,
} = {}) {
  const repoRoot = getRepoRoot(importMetaUrl)
  const launcherFailed = await runVitestSmokeFile({
    root: repoRoot,
    smokeTestPath: launcherSmokeTestPath,
  })
  const failed = await runVitestSmokeFile({
    root: repoRoot,
    smokeTestPath,
  })

  const totalFailed = launcherFailed + failed

  if (totalFailed > 0) {
    process.exitCode = 1
  }

  return totalFailed
}

if (isDirectRun(import.meta.url)) {
  const failed = await main()

  if (failed > 0) {
    process.exit(1)
  }
}
