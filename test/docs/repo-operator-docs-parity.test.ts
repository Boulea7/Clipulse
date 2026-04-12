import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

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
const ADAPTER_SMOKE_SCRIPT = new URL('../../scripts/smoke-adapters.mjs', import.meta.url)
const GEMINI_SMOKE_SCRIPT = new URL('../../scripts/smoke-gemini.mjs', import.meta.url)
const OPENCODE_SMOKE_SCRIPT = new URL('../../scripts/smoke-opencode.mjs', import.meta.url)
const SELF_HOSTING_GUIDE = new URL('../../docs/self-hosting-and-integration.md', import.meta.url)

function readCanonicalGeminiBaselineSurface(): string[] {
  const example = JSON.parse(readFileSync(GEMINI_CANONICAL_SETTINGS_PATH, 'utf8')) as {
    hooks: Record<string, unknown>
  }
  return Object.keys(example.hooks)
}

function fileLabel(file: URL): string {
  return fileURLToPath(file)
}

function readContent(file: URL): string {
  return readFileSync(file, 'utf8')
}

function assertContains(file: URL, content: string, needle: string): void {
  if (!content.includes(needle)) {
    throw new Error(`[${fileLabel(file)}] missing required text: ${needle}`)
  }
}

function assertNotContains(file: URL, content: string, needle: string): void {
  if (content.includes(needle)) {
    throw new Error(`[${fileLabel(file)}] unexpectedly contains: ${needle}`)
  }
}

function assertMatches(file: URL, content: string, pattern: RegExp, description: string): void {
  const matcher = new RegExp(pattern.source, pattern.flags)
  if (!matcher.test(content)) {
    throw new Error(`[${fileLabel(file)}] missing ${description}: ${pattern}`)
  }
}

function findRequiredLine(file: URL, content: string, needle: string): string {
  const line = content.split('\n').find((candidate) => candidate.includes(needle))

  if (!line) {
    throw new Error(`[${fileLabel(file)}] no line contains: ${needle}`)
  }

  return line
}

function findRequiredLineContainingAll(file: URL, content: string, needles: string[]): string {
  const line = content
    .split('\n')
    .find((candidate) => needles.every((needle) => candidate.includes(needle)))

  if (!line) {
    throw new Error(
      `[${fileLabel(file)}] no line contains all required fragments: ${needles.join(' | ')}`,
    )
  }

  return line
}

function splitShellSequence(command: string | undefined): string[] {
  expect(command).toBeDefined()
  return (command ?? '')
    .split('&&')
    .map((part) => part.trim())
    .filter(Boolean)
}

function countMatches(content: string, pattern: RegExp): number {
  const globalPattern = pattern.flags.includes('g')
    ? pattern
    : new RegExp(pattern.source, `${pattern.flags}g`)

  return content.match(globalPattern)?.length ?? 0
}

describe('repo operator docs parity', () => {
  it('keeps the first-party dashboard compatibility artifact visible for troubleshooting surfaces', () => {
    for (const file of REPO_OPERATOR_DOCS) {
      const content = readContent(file)
      assertContains(file, content, '/contracts/dashboard-compat.v1.json')
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
      const content = readContent(file)
      const baselineLine = findRequiredLineContainingAll(file, content, [
        'packages/adapter-gemini/dist/cli.js',
        'SessionStart',
      ])

      for (const hookName of canonicalBaselineSurface) {
        expect(
          baselineLine,
          `[${fileLabel(file)}] missing Gemini baseline hook ${hookName} in top-level summary line`,
        ).toContain(`\`${hookName}\``)
      }

      for (const alias of GEMINI_COMPATIBILITY_ALIASES) {
        expect(
          baselineLine,
          `[${fileLabel(file)}] should not surface Gemini compatibility alias ${alias} in top-level summary line`,
        ).not.toContain(`\`${alias}\``)
      }
    }
  })

  it('keeps the Gemini dual-wiring guardrail visible across operator-facing docs', () => {
    for (const { file, snippet } of GEMINI_DUAL_WIRING_GUARDRAILS) {
      const content = readContent(file)
      assertContains(file, content, snippet)
    }
  })

  it('keeps Gemini and OpenCode source-of-truth pointers symmetric across operator-facing docs', () => {
    for (const file of REPO_OPERATOR_DOCS) {
      const content = readContent(file)
      assertContains(file, content, 'packages/adapter-gemini/README.md')
      assertContains(file, content, 'packages/adapter-gemini/examples/.gemini/settings.json')
      assertContains(file, content, 'packages/adapter-opencode/README.md')
      assertContains(file, content, 'packages/adapter-opencode/examples/clipulse.ts')
    }
  })

  it('keeps operator runtime surfaces distinct across operator-facing docs', () => {
    for (const file of REPO_OPERATOR_DOCS) {
      const content = readContent(file)
      assertContains(file, content, '/healthz')
      assertContains(file, content, '/api/v1/status')
      assertContains(file, content, 'doctor')
      assertContains(file, content, 'pending')
    }
  })

  it('keeps README variants summary-first and delegates detailed runtime payload examples to the self-hosting guide', () => {
    for (const file of REPO_TOP_LEVEL_OPERATOR_SUMMARY_DOCS) {
      const content = readContent(file)
      assertContains(file, content, 'docs/self-hosting-and-integration.md')
      assertNotContains(file, content, 'oldest_backlog_age_seconds')
      assertNotContains(file, content, 'ready_bytes')
    }
  })

  it('keeps OpenCode session.diff documented as explicit opt-in across operator-facing docs', () => {
    for (const file of REPO_OPERATOR_DOCS) {
      const content = readContent(file)
      assertContains(file, content, 'session.diff')
      assertContains(file, content, 'CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF=1')
    }
  })

  it('keeps Gemini and OpenCode marked as experimental across repo-level operator docs', () => {
    for (const file of REPO_OPERATOR_DOCS) {
      const content = readContent(file)
      assertContains(file, content, 'Gemini CLI')
      assertContains(file, content, 'OpenCode')
      assertMatches(file, content, /(experimental|实验|實驗|実験)/, 'experimental status wording')
    }
  })

  it('keeps the self-hosting Gemini guide explicit about compatibility-only aliases and lifecycle limits', () => {
    const content = readContent(SELF_HOSTING_GUIDE)
    const canonicalSourceLine = findRequiredLine(
      SELF_HOSTING_GUIDE,
      content,
      'canonical wiring source',
    )

    expect(canonicalSourceLine).not.toContain('AfterToolFailure')
    expect(canonicalSourceLine).not.toContain('UserPromptSubmit')
    assertContains(SELF_HOSTING_GUIDE, content, 'without assuming transcripts or shell parsing')
    assertContains(SELF_HOSTING_GUIDE, content, 'packages/adapter-gemini/README.md')
    assertContains(SELF_HOSTING_GUIDE, content, '`SessionEnd`')
  })

  it('keeps the beta checklist aligned to the repo smoke entrypoints and smoke ownership boundaries', () => {
    const content = readContent(BETA_RELEASE_CHECKLIST)

    assertContains(BETA_RELEASE_CHECKLIST, content, 'npm run build')
    assertContains(BETA_RELEASE_CHECKLIST, content, 'npm run test')
    assertContains(BETA_RELEASE_CHECKLIST, content, 'PYTHONPATH=apps/api uv run ruff check apps/api')
    assertContains(BETA_RELEASE_CHECKLIST, content, 'npm run smoke:adapters')
    assertContains(BETA_RELEASE_CHECKLIST, content, 'npm run smoke:gemini')
    assertContains(BETA_RELEASE_CHECKLIST, content, 'npm run smoke:opencode')
    assertContains(BETA_RELEASE_CHECKLIST, content, 'npm run smoke:self-hosted')
    assertContains(BETA_RELEASE_CHECKLIST, content, 'api.status')
    assertContains(BETA_RELEASE_CHECKLIST, content, 'db.status')
    assertContains(BETA_RELEASE_CHECKLIST, content, 'spool.ready')
    assertContains(BETA_RELEASE_CHECKLIST, content, 'spool.processing')
    assertContains(BETA_RELEASE_CHECKLIST, content, 'spool.quarantine')
    assertContains(BETA_RELEASE_CHECKLIST, content, 'projectTopItem')
    assertContains(BETA_RELEASE_CHECKLIST, content, 'sessionListItem')
    assertContains(BETA_RELEASE_CHECKLIST, content, 'projectDetail')
    assertContains(BETA_RELEASE_CHECKLIST, content, 'sessionDetail')
    assertContains(BETA_RELEASE_CHECKLIST, content, '"host":"gemini-cli"')
    assertContains(BETA_RELEASE_CHECKLIST, content, '"event_name":"post_tool_use"')
    assertContains(BETA_RELEASE_CHECKLIST, content, '"privacy_mode":"hashed"')
    assertContains(BETA_RELEASE_CHECKLIST, content, '"host":"opencode"')
    assertContains(BETA_RELEASE_CHECKLIST, content, '"event_name":"session_start"')
    assertContains(BETA_RELEASE_CHECKLIST, content, '"event_name":"pre_tool_use"')
    assertContains(BETA_RELEASE_CHECKLIST, content, '"event_name":"file_edited"')
    assertContains(BETA_RELEASE_CHECKLIST, content, 'packages/adapter-gemini/README.md')
    assertContains(BETA_RELEASE_CHECKLIST, content, 'packages/adapter-gemini/examples/.gemini/settings.json')
    assertContains(BETA_RELEASE_CHECKLIST, content, 'packages/adapter-opencode/README.md')
    assertContains(BETA_RELEASE_CHECKLIST, content, 'packages/adapter-opencode/examples/clipulse.ts')
    assertContains(BETA_RELEASE_CHECKLIST, content, 'CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF=1')
    assertMatches(
      BETA_RELEASE_CHECKLIST,
      content,
      /single JSON batch line on stdout|one JSON batch line on stdout/i,
      'Gemini smoke stdout summary',
    )
    assertMatches(
      BETA_RELEASE_CHECKLIST,
      content,
      /manual probes.*diagnostic/i,
      'manual-probe diagnostic note',
    )
    assertMatches(
      BETA_RELEASE_CHECKLIST,
      content,
      /stdout contract|machine-readable/i,
      'smoke ownership wording',
    )
    assertMatches(
      BETA_RELEASE_CHECKLIST,
      content,
      /wrapper.*smoke|experimental-strip-types/i,
      'OpenCode wrapper-runtime note',
    )
  })

  it('keeps repo-level beta scripts anchored to distinct local and CI closures plus the default vitest surface', () => {
    const packageJson = JSON.parse(readFileSync(ROOT_PACKAGE_JSON, 'utf8')) as {
      scripts?: Record<string, string>
    }
    const selfHostedScript = readContent(SELF_HOSTED_SMOKE_SCRIPT)
    const adapterSmokeScript = readContent(ADAPTER_SMOKE_SCRIPT)
    const geminiSmokeScript = readContent(GEMINI_SMOKE_SCRIPT)
    const opencodeSmokeScript = readContent(OPENCODE_SMOKE_SCRIPT)

    expect(packageJson.scripts?.['smoke:adapters']).toContain('scripts/smoke-adapters.mjs')
    expect(packageJson.scripts?.['smoke:gemini']).toContain('scripts/smoke-gemini.mjs')
    expect(packageJson.scripts?.['smoke:opencode']).toContain('scripts/smoke-opencode.mjs')
    expect(packageJson.scripts?.['smoke:self-hosted']).toContain('scripts/smoke-self-hosted.mjs')
    expect(packageJson.scripts?.['test:js']).toBe('vitest run')
    expect(splitShellSequence(packageJson.scripts?.['check:beta'])).toEqual([
      'npm run build',
      'npm run test',
      'npm run lint:api',
      'npm run smoke:adapters',
      'npm run smoke:self-hosted',
    ])
    expect(splitShellSequence(packageJson.scripts?.['check:beta:ci'])).toEqual([
      'npm run test',
      'npm run lint:api',
      'npm run smoke:self-hosted',
    ])
    expect(packageJson.scripts?.['check:beta:ci']).not.toContain('npm run build')
    expect(packageJson.scripts?.['check:beta:ci']).not.toContain('npm run smoke:adapters')
    expect(selfHostedScript).toContain('smoke/self-hosted-wiring.test.ts')
    expect(adapterSmokeScript).toContain("import { runSmokeCommand } from './smoke-shared.mjs'")
    expect(countMatches(adapterSmokeScript, /args: \['scripts\/smoke-gemini\.mjs'\]/)).toBe(1)
    expect(countMatches(adapterSmokeScript, /args: \['scripts\/smoke-opencode\.mjs'\]/)).toBe(1)
    expect(adapterSmokeScript.indexOf("args: ['scripts/smoke-gemini.mjs']")).toBeLessThan(
      adapterSmokeScript.indexOf("args: ['scripts/smoke-opencode.mjs']"),
    )
    expect(adapterSmokeScript).not.toContain("args: ['scripts/smoke-self-hosted.mjs']")
    expect(adapterSmokeScript).not.toContain("args: ['scripts/smoke-adapters.mjs']")
    expect(geminiSmokeScript).toContain('packages/adapter-gemini/examples/after-tool.write-file.json')
    expect(geminiSmokeScript).toContain('packages/adapter-gemini/dist/cli.js')
    expect(geminiSmokeScript).toContain('process.stdout.write(result.stdout)')
    expect(opencodeSmokeScript).toContain('packages/adapter-opencode/examples/clipulse.ts')
    expect(opencodeSmokeScript).toContain('CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF')
    expect(opencodeSmokeScript).toContain('process.stdout.write(result.stdout)')
  })

  it('reminds PR authors that docs closure spans default vitest parity, adapter smoke, and beta/self-hosted checks', () => {
    const content = readContent(PULL_REQUEST_TEMPLATE)

    expect(content).toContain('npm run test')
    expect(content).toContain('root docs parity')
    expect(content).toContain('test/**/*.test.ts')
    expect(content).toContain('npm run check:beta')
    expect(content).toContain('npm run smoke:adapters')
    expect(content).toContain('npm run smoke:self-hosted')
    expect(content).toContain('operator/docs contracts')
  })

  it('keeps CI build and adapter smoke explicit, ordered, and non-duplicated', () => {
    const content = readContent(BETA_CHECKS_WORKFLOW)
    const buildStepIndex = content.indexOf('- name: Run build')
    const adapterSmokeStepIndex = content.indexOf('- name: Run adapter smoke')
    const betaChecksStepIndex = content.indexOf('- name: Run beta checks')

    assertContains(BETA_CHECKS_WORKFLOW, content, '- name: Run build')
    assertContains(BETA_CHECKS_WORKFLOW, content, 'run: npm run build')
    assertContains(BETA_CHECKS_WORKFLOW, content, '- name: Run adapter smoke')
    assertContains(BETA_CHECKS_WORKFLOW, content, 'run: npm run smoke:adapters')
    assertContains(BETA_CHECKS_WORKFLOW, content, '- name: Run beta checks')
    assertContains(BETA_CHECKS_WORKFLOW, content, 'run: npm run check:beta:ci')
    expect(content).not.toContain('npm run check:beta\n')
    expect(countMatches(content, /- name: Run build/)).toBe(1)
    expect(countMatches(content, /run: npm run build/)).toBe(1)
    expect(countMatches(content, /- name: Run adapter smoke/)).toBe(1)
    expect(countMatches(content, /run: npm run smoke:adapters/)).toBe(1)
    expect(countMatches(content, /- name: Run beta checks/)).toBe(1)
    expect(countMatches(content, /run: npm run check:beta:ci/)).toBe(1)
    expect(buildStepIndex).toBeGreaterThan(-1)
    expect(adapterSmokeStepIndex).toBeGreaterThan(-1)
    expect(betaChecksStepIndex).toBeGreaterThan(-1)
    expect(buildStepIndex).toBeLessThan(adapterSmokeStepIndex)
    expect(adapterSmokeStepIndex).toBeLessThan(betaChecksStepIndex)
  })
})
