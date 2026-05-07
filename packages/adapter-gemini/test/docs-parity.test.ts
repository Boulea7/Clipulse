import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const GEMINI_CANONICAL_SETTINGS_PATH = new URL('../examples/.gemini/settings.json', import.meta.url)
const ROOT_PACKAGE_JSON_PATH = new URL('../../../package.json', import.meta.url)
const GEMINI_COMPATIBILITY_ALIASES = [
  'AfterToolFailure',
  'UserPromptSubmit',
] as const
const GEMINI_TOP_LEVEL_BASELINE_SUMMARY_DOCS = [
  new URL('../../../README.md', import.meta.url),
  new URL('../../../README.en.md', import.meta.url),
  new URL('../../../README.zh-TW.md', import.meta.url),
  new URL('../../../README.ja.md', import.meta.url),
  new URL('../../../README.es.md', import.meta.url),
  new URL('../../../README.fr.md', import.meta.url),
  new URL('../../../README.ko.md', import.meta.url),
]
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
    snippet: '`BeforeAgent` と互換 alias `UserPromptSubmit` を同じ導入で同時に配線しないでください',
  },
  {
    file: new URL('../../../README.es.md', import.meta.url),
    snippet: '`BeforeAgent` y el alias de compatibilidad `UserPromptSubmit` no deben quedar conectados al mismo tiempo en la misma instalación',
  },
  {
    file: new URL('../../../README.fr.md', import.meta.url),
    snippet: "`BeforeAgent` et l'alias de compatibilite `UserPromptSubmit` ne doivent pas rester cables en meme temps dans la meme installation",
  },
  {
    file: new URL('../../../README.ko.md', import.meta.url),
    snippet: '`BeforeAgent`와 호환 alias `UserPromptSubmit`를 같은 설치에 동시에 연결하면 안 됩니다',
  },
  {
    file: new URL('../../../docs/self-hosting-and-integration.md', import.meta.url),
    snippet: 'Keep `BeforeAgent` and the compatibility alias `UserPromptSubmit` not both wired in the same installation',
  },
]

const GEMINI_OPERATOR_DOC_CONTRACT_POINTERS = [
  new URL('../../../README.md', import.meta.url),
  new URL('../../../README.en.md', import.meta.url),
  new URL('../../../README.zh-TW.md', import.meta.url),
  new URL('../../../README.ja.md', import.meta.url),
  new URL('../../../README.es.md', import.meta.url),
  new URL('../../../README.fr.md', import.meta.url),
  new URL('../../../README.ko.md', import.meta.url),
  new URL('../../../docs/self-hosting-and-integration.md', import.meta.url),
]

function readCanonicalGeminiBaselineSurface(): string[] {
  const example = JSON.parse(readFileSync(GEMINI_CANONICAL_SETTINGS_PATH, 'utf8')) as {
    hooks: Record<string, unknown>
  }
  return Object.keys(example.hooks)
}

function findRequiredLine(content: string, needle: string): string {
  const line = content.split('\n').find((candidate) => candidate.includes(needle))
  expect(line).toBeDefined()
  return line ?? ''
}

function findRequiredLineContainingAll(content: string, needles: string[]): string {
  const line = content
    .split('\n')
    .find((candidate) => needles.every((needle) => candidate.includes(needle)))
  expect(line).toBeDefined()
  return line ?? ''
}

describe('gemini docs parity', () => {
  it('derives the canonical Gemini baseline wiring surface from the checked-in settings example', () => {
    const canonicalBaselineSurface = readCanonicalGeminiBaselineSurface()

    expect(canonicalBaselineSurface).toEqual([
      'SessionStart',
      'BeforeTool',
      'AfterTool',
      'BeforeAgent',
      'AfterAgent',
      'SessionEnd',
    ])

    for (const alias of GEMINI_COMPATIBILITY_ALIASES) {
      expect(canonicalBaselineSurface).not.toContain(alias)
    }
  })

  it('keeps the dual-wiring guardrail visible across operator-facing docs', () => {
    for (const { file, snippet } of GEMINI_DUAL_WIRING_GUARDRAILS) {
      const content = readFileSync(file, 'utf8')
      expect(content).toContain(snippet)
    }
  })

  it('keeps top-level Gemini baseline summaries anchored to the checked-in example instead of compatibility aliases', () => {
    const canonicalBaselineSurface = readCanonicalGeminiBaselineSurface()

    for (const file of GEMINI_TOP_LEVEL_BASELINE_SUMMARY_DOCS) {
      const content = readFileSync(file, 'utf8')
      const baselineLine = findRequiredLineContainingAll(content, [
        'packages/adapter-gemini/dist/cli.js',
        'SessionStart',
      ])

      for (const hookName of canonicalBaselineSurface) {
        expect(baselineLine).toContain(`\`${hookName}\``)
      }

      for (const alias of GEMINI_COMPATIBILITY_ALIASES) {
        expect(baselineLine).not.toContain(`\`${alias}\``)
      }
    }
  })

  it('keeps the canonical Gemini contract pointers visible across operator-facing docs', () => {
    for (const file of GEMINI_OPERATOR_DOC_CONTRACT_POINTERS) {
      const content = readFileSync(file, 'utf8')
      expect(content).toContain('packages/adapter-gemini/README.md')
      expect(content).toContain('packages/adapter-gemini/examples/.gemini/settings.json')
    }
  })

  it('keeps the self-hosting Gemini guide explicit about compatibility-only aliases and lifecycle limits', () => {
    const content = readFileSync(new URL('../../../docs/self-hosting-and-integration.md', import.meta.url), 'utf8')
    const canonicalSourceLine = findRequiredLine(content, 'canonical wiring source')

    expect(canonicalSourceLine).not.toContain('AfterToolFailure')
    expect(canonicalSourceLine).not.toContain('UserPromptSubmit')
    expect(content).toContain('without assuming transcripts or shell parsing')
    expect(content).toContain('The detailed host contract intentionally lives in `packages/adapter-gemini/README.md`')
  })

  it('keeps Gemini compatibility boundaries explicit in the package README', () => {
    const content = readFileSync(new URL('../README.md', import.meta.url), 'utf8')

    expect(content).toContain('compatibility-only aliases stay limited to normalization / cleanup compatibility and do not widen the official wiring contract')
    expect(content).toContain('compatibility-only aliases do not imply file-delta equivalence with the official hook surface')
    expect(content).toContain('stdout mode only treats a non-throwing single-line `stdout.write(...)` as a successful handoff before it commits local timing state')
    expect(content).toContain('treat those lines as at-least-once experimental handoff data instead of a durable queue protocol')
  })

  it('keeps the package README smoke anchor pointed at the checked-in fixture and smoke command', () => {
    const content = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
    const smokeLine = findRequiredLineContainingAll(content, [
      '`scripts/smoke-gemini.mjs`',
      'stdout',
      'lifecycle sequence',
    ])
    const fixtureLine = findRequiredLineContainingAll(content, [
      'checked-in smoke fixtures',
      '`examples/`',
    ])

    expect(content).toContain('## Smoke check')
    expect(content).toContain('CLIPULSE_REQUIRE_PROJECT_FILE=1')
    expect(content).toContain('`npm run smoke:gemini`')
    expect(smokeLine).toContain('`scripts/smoke-gemini.mjs`')
    expect(fixtureLine).toContain('`examples/`')
    expect(content).toContain('legacy `UserPromptSubmit` prompt-only compatibility path')
    expect(content).toContain('`replace`-backed completion')
  })

  it('keeps the root smoke:gemini script pointed at scripts/smoke-gemini.mjs', () => {
    const packageJson = JSON.parse(readFileSync(ROOT_PACKAGE_JSON_PATH, 'utf8')) as {
      scripts?: Record<string, string>
    }

    expect(packageJson.scripts?.['smoke:gemini']).toBe('node scripts/smoke-gemini.mjs')
  })
})
