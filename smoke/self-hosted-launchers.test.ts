import { access, readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

async function assertFileExists(filePath: string) {
  await expect(access(filePath)).resolves.toBeUndefined()
}

describe('self-hosted smoke launchers', () => {
  it('keeps adapter smoke suite membership pinned to stable and experimental hosts', async () => {
    const script = await readFile(new URL('../scripts/smoke-adapters.mjs', import.meta.url), 'utf8')

    expect(script).toContain('stable: [')
    expect(script).toContain("scriptPath: 'scripts/smoke-claude.mjs'")
    expect(script).toContain("scriptPath: 'scripts/smoke-codex.mjs'")
    expect(script).toContain('experimental: [')
    expect(script).toContain("scriptPath: 'scripts/smoke-gemini.mjs'")
    expect(script).toContain("scriptPath: 'scripts/smoke-opencode.mjs'")
    expect(script).toContain('Expected one of: stable, experimental.')
  })

  it('keeps the stable self-hosted launcher on the canonical wiring suite', async () => {
    const script = await readFile(new URL('../scripts/smoke-self-hosted.mjs', import.meta.url), 'utf8')

    expect(script).toContain("const smokeTestPath = 'smoke/self-hosted-wiring.test.ts'")
  })

  it('ships a dedicated experimental self-hosted launcher and suite', async () => {
    const experimentalScriptPath = new URL('../scripts/smoke-self-hosted-experimental.mjs', import.meta.url)
    const experimentalSuitePath = new URL('./self-hosted-experimental.test.ts', import.meta.url)

    await assertFileExists(experimentalScriptPath)
    await assertFileExists(experimentalSuitePath)

    const script = await readFile(experimentalScriptPath, 'utf8')
    expect(script).toContain("const smokeTestPath = 'smoke/self-hosted-experimental.test.ts'")
  })
})
