import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const REPO_OPERATOR_DOCS = [
  new URL('../../../README.md', import.meta.url),
  new URL('../../../README.en.md', import.meta.url),
  new URL('../../../README.zh-TW.md', import.meta.url),
  new URL('../../../README.ja.md', import.meta.url),
  new URL('../../../docs/self-hosting-and-integration.md', import.meta.url),
]

describe('repo operator docs parity', () => {
  it('keeps the dashboard compatibility contract path visible for troubleshooting surfaces', () => {
    for (const file of REPO_OPERATOR_DOCS) {
      const content = readFileSync(file, 'utf8')
      expect(content).toContain('/contracts/dashboard-compat.v1.json')
    }
  })

  it('keeps OpenCode session.diff documented as default-off across operator-facing docs', () => {
    for (const file of REPO_OPERATOR_DOCS) {
      const content = readFileSync(file, 'utf8')
      expect(content).toContain('CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF=1')
    }

    const opencodeReadme = readFileSync(new URL('../../adapter-opencode/README.md', import.meta.url), 'utf8')
    expect(opencodeReadme).toContain('keep `session.diff` out of the default ingestion path')
  })

  it('keeps Gemini and OpenCode marked as experimental across repo-level operator docs', () => {
    for (const file of REPO_OPERATOR_DOCS) {
      const content = readFileSync(file, 'utf8')
      expect(content).toMatch(/Gemini CLI[\s\S]*OpenCode[\s\S]*(experimental|实验|實驗|実験)/)
    }
  })
})
