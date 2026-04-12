import { access, readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

async function assertFileExists(filePath: string) {
  await expect(access(filePath)).resolves.toBeUndefined()
}

describe('self-hosted smoke launchers', () => {
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
