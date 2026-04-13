import { access } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { launcherDescriptors, smokeSuites } from '../scripts/smoke-adapters.mjs'
import { smokeTestPath as stableSelfHostedSmokeTestPath } from '../scripts/smoke-self-hosted.mjs'
import { smokeTestPath as experimentalSelfHostedSmokeTestPath } from '../scripts/smoke-self-hosted-experimental.mjs'

async function assertFileExists(filePath: string) {
  await expect(access(filePath)).resolves.toBeUndefined()
}

describe('self-hosted smoke launchers', () => {
  it('keeps adapter smoke suite membership pinned to stable and experimental hosts', async () => {
    expect(smokeSuites.stable).toEqual([
      {
        scriptPath: 'scripts/smoke-claude.mjs',
        stepLabel: 'adapter smoke: claude',
      },
      {
        scriptPath: 'scripts/smoke-codex.mjs',
        stepLabel: 'adapter smoke: codex',
      },
    ])
    expect(smokeSuites.experimental).toEqual([
      {
        scriptPath: 'scripts/smoke-gemini.mjs',
        stepLabel: 'adapter smoke: gemini',
      },
      {
        scriptPath: 'scripts/smoke-opencode.mjs',
        stepLabel: 'adapter smoke: opencode',
      },
    ])
  })

  it('keeps the stable self-hosted launcher on the canonical wiring suite', async () => {
    expect(stableSelfHostedSmokeTestPath).toBe('smoke/self-hosted-wiring.test.ts')
  })

  it('ships a dedicated experimental self-hosted launcher and suite', async () => {
    const experimentalScriptPath = new URL('../scripts/smoke-self-hosted-experimental.mjs', import.meta.url)
    const experimentalSuitePath = new URL('./self-hosted-experimental.test.ts', import.meta.url)

    await assertFileExists(experimentalScriptPath)
    await assertFileExists(experimentalSuitePath)

    expect(experimentalSelfHostedSmokeTestPath).toBe('smoke/self-hosted-experimental.test.ts')
  })

  it('exposes structured launcher descriptors for adapter and self-hosted smoke ownership', () => {
    expect(launcherDescriptors).toEqual([
      { kind: 'adapter', mode: 'stable', path: 'scripts/smoke-claude.mjs' },
      { kind: 'adapter', mode: 'stable', path: 'scripts/smoke-codex.mjs' },
      { kind: 'adapter', mode: 'experimental', path: 'scripts/smoke-gemini.mjs' },
      { kind: 'adapter', mode: 'experimental', path: 'scripts/smoke-opencode.mjs' },
      { kind: 'self-hosted', mode: 'stable', path: 'smoke/self-hosted-wiring.test.ts' },
      { kind: 'self-hosted', mode: 'experimental', path: 'smoke/self-hosted-experimental.test.ts' },
    ])
  })
})
