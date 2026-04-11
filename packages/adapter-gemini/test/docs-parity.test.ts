import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const GEMINI_DUAL_WIRING_GUARDRAILS = [
  {
    file: new URL('../../../README.md', import.meta.url),
    snippet: '`BeforeAgent` 与兼容 alias `UserPromptSubmit` 不应在同一套接线里同时保留',
  },
  {
    file: new URL('../../../README.en.md', import.meta.url),
    snippet: '`BeforeAgent` and the compatibility alias `UserPromptSubmit` should not both stay wired in the same installation',
  },
  {
    file: new URL('../../../README.zh-TW.md', import.meta.url),
    snippet: '`BeforeAgent` 與相容 alias `UserPromptSubmit` 不應在同一套接線裡同時保留',
  },
  {
    file: new URL('../../../README.ja.md', import.meta.url),
    snippet: '`BeforeAgent` と互換 alias `UserPromptSubmit` を同じ導入で同時に配線したままにしない',
  },
  {
    file: new URL('../../../docs/self-hosting-and-integration.md', import.meta.url),
    snippet: '`BeforeAgent` and the compatibility alias `UserPromptSubmit` should not both stay wired in the same installation',
  },
]

const GEMINI_OPERATOR_DOC_CONTRACT_POINTERS = [
  new URL('../../../README.md', import.meta.url),
  new URL('../../../README.en.md', import.meta.url),
  new URL('../../../README.zh-TW.md', import.meta.url),
  new URL('../../../README.ja.md', import.meta.url),
  new URL('../../../docs/self-hosting-and-integration.md', import.meta.url),
]

describe('gemini docs parity', () => {
  it('keeps the dual-wiring guardrail visible across operator-facing docs', () => {
    for (const { file, snippet } of GEMINI_DUAL_WIRING_GUARDRAILS) {
      const content = readFileSync(file, 'utf8')
      expect(content).toContain(snippet)
    }
  })

  it('keeps the canonical Gemini contract pointers visible across operator-facing docs', () => {
    for (const file of GEMINI_OPERATOR_DOC_CONTRACT_POINTERS) {
      const content = readFileSync(file, 'utf8')
      expect(content).toContain('packages/adapter-gemini/README.md')
      expect(content).toContain('packages/adapter-gemini/examples/.gemini/settings.json')
    }
  })

  it('keeps Gemini compatibility boundaries explicit in the package README', () => {
    const content = readFileSync(new URL('../README.md', import.meta.url), 'utf8')

    expect(content).toContain('compatibility-only aliases stay limited to normalization / cleanup compatibility and do not widen the official wiring contract')
    expect(content).toContain('compatibility-only aliases do not imply file-delta equivalence with the official hook surface')
  })
})
