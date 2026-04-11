import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const REPO_OPERATOR_DOCS = [
  new URL('../../../README.md', import.meta.url),
  new URL('../../../README.en.md', import.meta.url),
  new URL('../../../README.zh-TW.md', import.meta.url),
  new URL('../../../README.ja.md', import.meta.url),
  new URL('../../../docs/self-hosting-and-integration.md', import.meta.url),
]

const BETA_RELEASE_CHECKLIST = new URL('../../../docs/beta-release-checklist.md', import.meta.url)
const OPENCODE_README = new URL('../../adapter-opencode/README.md', import.meta.url)

describe('repo operator docs parity', () => {
  it('keeps the first-party dashboard compatibility artifact visible for troubleshooting surfaces', () => {
    for (const file of REPO_OPERATOR_DOCS) {
      const content = readFileSync(file, 'utf8')
      expect(content).toContain('/contracts/dashboard-compat.v1.json')
    }
  })

  it('keeps Gemini and OpenCode source-of-truth pointers symmetric across operator-facing docs', () => {
    for (const file of REPO_OPERATOR_DOCS) {
      const content = readFileSync(file, 'utf8')
      expect(content).toContain('packages/adapter-gemini/README.md')
      expect(content).toContain('packages/adapter-gemini/examples/.gemini/settings.json')
      expect(content).toContain('packages/adapter-opencode/README.md')
      expect(content).toContain('packages/adapter-opencode/examples/clipulse.ts')
    }
  })

  it('keeps operator runtime surfaces distinct across operator-facing docs', () => {
    for (const file of REPO_OPERATOR_DOCS) {
      const content = readFileSync(file, 'utf8')
      expect(content).toContain('/healthz')
      expect(content).toContain('/api/v1/status')
      expect(content).toContain('doctor')
      expect(content).toContain('pending')
    }
  })

  it('keeps OpenCode session.diff documented as explicit opt-in across operator-facing docs', () => {
    for (const file of REPO_OPERATOR_DOCS) {
      const content = readFileSync(file, 'utf8')
      expect(content).toContain('session.diff')
      expect(content).toContain('CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF=1')
    }

    const opencodeReadme = readFileSync(OPENCODE_README, 'utf8')
    expect(opencodeReadme).toContain('keep `session.diff` out of the default ingestion path')
    expect(opencodeReadme).toContain('default-off unless you explicitly opt in with `CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF=1`')
  })

  it('keeps Gemini and OpenCode marked as experimental across repo-level operator docs', () => {
    for (const file of REPO_OPERATOR_DOCS) {
      const content = readFileSync(file, 'utf8')
      expect(content).toMatch(/Gemini CLI[\s\S]*OpenCode[\s\S]*(experimental|实验|實驗|実験)/)
    }
  })

  it('points the beta checklist at machine-readable status and compatibility fields', () => {
    const content = readFileSync(BETA_RELEASE_CHECKLIST, 'utf8')

    expect(content).toContain('api.status')
    expect(content).toContain('db.status')
    expect(content).toContain('spool.ready')
    expect(content).toContain('spool.processing')
    expect(content).toContain('spool.quarantine')
    expect(content).toContain('projectTopItem')
    expect(content).toContain('sessionListItem')
    expect(content).toContain('projectDetail')
    expect(content).toContain('sessionDetail')
  })
})
