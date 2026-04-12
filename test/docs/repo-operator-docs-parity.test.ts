import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const REPO_OPERATOR_DOCS = [
  new URL('../../README.md', import.meta.url),
  new URL('../../README.en.md', import.meta.url),
  new URL('../../README.zh-TW.md', import.meta.url),
  new URL('../../README.ja.md', import.meta.url),
  new URL('../../docs/self-hosting-and-integration.md', import.meta.url),
]

const REPO_TOP_LEVEL_OPERATOR_SUMMARY_DOCS = [
  new URL('../../README.md', import.meta.url),
  new URL('../../README.en.md', import.meta.url),
  new URL('../../README.zh-TW.md', import.meta.url),
  new URL('../../README.ja.md', import.meta.url),
]

const GEMINI_CANONICAL_SETTINGS_PATH = new URL(
  '../../packages/adapter-gemini/examples/.gemini/settings.json',
  import.meta.url,
)
const GEMINI_COMPATIBILITY_ALIASES = [
  'AfterToolFailure',
  'UserPromptSubmit',
] as const
const GEMINI_DUAL_WIRING_GUARDRAILS = [
  {
    file: new URL('../../README.md', import.meta.url),
    snippet: '`BeforeAgent` 与兼容 alias `UserPromptSubmit` 不应在同一套接线里同时保留',
  },
  {
    file: new URL('../../README.en.md', import.meta.url),
    snippet: '`BeforeAgent` and the compatibility alias `UserPromptSubmit` should not both stay wired in the same installation',
  },
  {
    file: new URL('../../README.zh-TW.md', import.meta.url),
    snippet: '`BeforeAgent` 與相容 alias `UserPromptSubmit` 不應在同一套接線裡同時保留',
  },
  {
    file: new URL('../../README.ja.md', import.meta.url),
    snippet: '`BeforeAgent` と互換 alias `UserPromptSubmit` を同じ導入で同時に配線したままにしない',
  },
  {
    file: new URL('../../docs/self-hosting-and-integration.md', import.meta.url),
    snippet: '`BeforeAgent` and the compatibility alias `UserPromptSubmit` should not both stay wired in the same installation',
  },
]
const BETA_RELEASE_CHECKLIST = new URL('../../docs/beta-release-checklist.md', import.meta.url)
const ROOT_PACKAGE_JSON = new URL('../../package.json', import.meta.url)
const PULL_REQUEST_TEMPLATE = new URL('../../.github/pull_request_template.md', import.meta.url)
const BETA_CHECKS_WORKFLOW = new URL('../../.github/workflows/beta-checks.yml', import.meta.url)
const SELF_HOSTED_SMOKE_SCRIPT = new URL('../../scripts/smoke-self-hosted.mjs', import.meta.url)
const GEMINI_SMOKE_SCRIPT = new URL('../../scripts/smoke-gemini.mjs', import.meta.url)
const OPENCODE_SMOKE_SCRIPT = new URL('../../scripts/smoke-opencode.mjs', import.meta.url)

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

describe('repo operator docs parity', () => {
  it('keeps the first-party dashboard compatibility artifact visible for troubleshooting surfaces', () => {
    for (const file of REPO_OPERATOR_DOCS) {
      const content = readFileSync(file, 'utf8')
      expect(content).toContain('/contracts/dashboard-compat.v1.json')
    }
  })

  it('keeps top-level Gemini baseline summaries anchored to the checked-in example instead of compatibility aliases', () => {
    const canonicalBaselineSurface = readCanonicalGeminiBaselineSurface()

    expect(canonicalBaselineSurface).toEqual([
      'SessionStart',
      'BeforeTool',
      'AfterTool',
      'BeforeAgent',
      'AfterAgent',
      'SessionEnd',
    ])

    for (const file of REPO_TOP_LEVEL_OPERATOR_SUMMARY_DOCS) {
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

  it('keeps the Gemini dual-wiring guardrail visible across operator-facing docs', () => {
    for (const { file, snippet } of GEMINI_DUAL_WIRING_GUARDRAILS) {
      const content = readFileSync(file, 'utf8')
      expect(content).toContain(snippet)
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

  it('keeps README variants summary-first and delegates detailed runtime payload examples to the self-hosting guide', () => {
    for (const file of REPO_TOP_LEVEL_OPERATOR_SUMMARY_DOCS) {
      const content = readFileSync(file, 'utf8')
      expect(content).toContain('docs/self-hosting-and-integration.md')
      expect(content).not.toContain('oldest_backlog_age_seconds')
      expect(content).not.toContain('ready_bytes')
    }
  })

  it('keeps OpenCode session.diff documented as explicit opt-in across operator-facing docs', () => {
    for (const file of REPO_OPERATOR_DOCS) {
      const content = readFileSync(file, 'utf8')
      expect(content).toContain('session.diff')
      expect(content).toContain('CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF=1')
    }
  })

  it('keeps Gemini and OpenCode marked as experimental across repo-level operator docs', () => {
    for (const file of REPO_OPERATOR_DOCS) {
      const content = readFileSync(file, 'utf8')
      expect(content).toMatch(/Gemini CLI[\s\S]*OpenCode[\s\S]*(experimental|实验|實驗|実験)/)
    }
  })

  it('keeps the self-hosting Gemini guide explicit about compatibility-only aliases and lifecycle limits', () => {
    const content = readFileSync(new URL('../../docs/self-hosting-and-integration.md', import.meta.url), 'utf8')
    const canonicalSourceLine = findRequiredLine(content, 'canonical wiring source')

    expect(canonicalSourceLine).not.toContain('AfterToolFailure')
    expect(canonicalSourceLine).not.toContain('UserPromptSubmit')
    expect(content).toContain('without assuming transcripts or shell parsing')
    expect(content).toContain('the detailed hook allowlist, ignored-hook behavior, `SessionEnd` fallback semantics, and out-of-scope boundaries stay in `packages/adapter-gemini/README.md`')
  })

  it('keeps the beta checklist aligned to the repo smoke entrypoints and machine-readable adapter stdout contracts', () => {
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
    expect(content).toContain('npm run smoke:adapters')
    expect(content).toContain('npm run smoke:self-hosted')
    expect(content).toContain('single JSON batch line on stdout')
    expect(content).toContain('`events` array')
    expect(content).toContain('"host":"gemini-cli"')
    expect(content).toContain('"event_name":"post_tool_use"')
    expect(content).toContain('"privacy_mode":"hashed"')
    expect(content).toContain('"host":"opencode"')
    expect(content).toContain('"event_name":"session_start"')
    expect(content).toContain('"event_name":"pre_tool_use"')
    expect(content).toContain('"event_name":"file_edited"')
    expect(content).toContain('"event_name":"post_tool_use"')
    expect(content).toContain('packages/adapter-gemini/README.md')
    expect(content).toContain('packages/adapter-gemini/examples/.gemini/settings.json')
    expect(content).toContain('packages/adapter-opencode/README.md')
    expect(content).toContain('packages/adapter-opencode/examples/clipulse.ts')
    expect(content).toContain('`Gemini CLI` and `OpenCode` as experimental')
    expect(content).toContain('`session.diff` as default-off unless `CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF=1` is explicitly set')
    expect(content).toContain('wrapper-based smoke')
    expect(content).toContain('manual probes below are diagnostics')
    expect(content).toContain('short sequence of machine-readable JSON batch lines')
  })

  it('keeps repo-level beta scripts anchored to self-hosted smoke and the default vitest surface', () => {
    const packageJson = JSON.parse(readFileSync(ROOT_PACKAGE_JSON, 'utf8')) as {
      scripts?: Record<string, string>
    }
    const selfHostedScript = readFileSync(SELF_HOSTED_SMOKE_SCRIPT, 'utf8')
    const geminiSmokeScript = readFileSync(GEMINI_SMOKE_SCRIPT, 'utf8')
    const opencodeSmokeScript = readFileSync(OPENCODE_SMOKE_SCRIPT, 'utf8')

    expect(packageJson.scripts?.['smoke:adapters']).toContain('scripts/smoke-adapters.mjs')
    expect(packageJson.scripts?.['smoke:gemini']).toContain('scripts/smoke-gemini.mjs')
    expect(packageJson.scripts?.['smoke:opencode']).toContain('scripts/smoke-opencode.mjs')
    expect(packageJson.scripts?.['smoke:self-hosted']).toContain('scripts/smoke-self-hosted.mjs')
    expect(packageJson.scripts?.['test:js']).toBe('vitest run')
    expect(packageJson.scripts?.['check:beta']).toContain('npm run smoke:adapters')
    expect(packageJson.scripts?.['check:beta']).toContain('npm run test')
    expect(packageJson.scripts?.['check:beta']).toContain('npm run lint:api')
    expect(packageJson.scripts?.['check:beta']).toContain('npm run smoke:self-hosted')
    expect(selfHostedScript).toContain('smoke/self-hosted-wiring.test.ts')
    expect(geminiSmokeScript).toContain('packages/adapter-gemini/examples/after-tool.write-file.json')
    expect(geminiSmokeScript).toContain('packages/adapter-gemini/dist/cli.js')
    expect(opencodeSmokeScript).toContain('packages/adapter-opencode/examples/clipulse.ts')
    expect(opencodeSmokeScript).toContain('CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF')
  })

  it('reminds PR authors that docs closure spans default vitest parity, adapter smoke, and beta/self-hosted checks', () => {
    const content = readFileSync(PULL_REQUEST_TEMPLATE, 'utf8')

    expect(content).toContain('npm run test')
    expect(content).toContain('root docs parity')
    expect(content).toContain('test/**/*.test.ts')
    expect(content).toContain('npm run check:beta')
    expect(content).toContain('npm run smoke:adapters')
    expect(content).toContain('npm run smoke:self-hosted')
    expect(content).toContain('operator/docs contracts')
  })

  it('keeps CI adapter smoke explicit while still running the repo-level beta closure command', () => {
    const content = readFileSync(BETA_CHECKS_WORKFLOW, 'utf8')

    expect(content).toContain('Run adapter smoke')
    expect(content).toContain('npm run smoke:adapters')
    expect(content).toContain('Run beta checks')
    expect(content).toContain('npm run check:beta')
  })
})
