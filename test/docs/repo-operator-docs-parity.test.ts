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

const BETA_RELEASE_CHECKLIST = new URL('../../docs/beta-release-checklist.md', import.meta.url)
const BETA_CHECKS_WORKFLOW = new URL('../../.github/workflows/beta-checks.yml', import.meta.url)
const SELF_HOSTING_GUIDE = new URL('../../docs/self-hosting-and-integration.md', import.meta.url)

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

function countMatches(content: string, pattern: RegExp): number {
  const globalPattern = pattern.flags.includes('g')
    ? pattern
    : new RegExp(pattern.source, `${pattern.flags}g`)

  return content.match(globalPattern)?.length ?? 0
}

function assertGeminiDualWiringGuardrail(file: URL, content: string): void {
  const line = findRequiredLineContainingAll(file, content, ['`BeforeAgent`', '`UserPromptSubmit`'])
  assertMatches(
    file,
    line,
    /(not both|不应.*同时|不應.*同時|同時.*しない)/i,
    'Gemini dual-wiring guardrail',
  )
}

describe('repo operator docs parity', () => {
  it('keeps the first-party dashboard compatibility artifact visible for troubleshooting surfaces', () => {
    for (const file of REPO_OPERATOR_DOCS) {
      const content = readContent(file)
      assertContains(file, content, '/contracts/dashboard-compat.v1.json')
    }
  })

  it('keeps top-level Gemini summaries anchored to the checked-in example and official lifecycle surface', () => {
    for (const file of REPO_TOP_LEVEL_OPERATOR_SUMMARY_DOCS) {
      const content = readContent(file)
      assertContains(file, content, 'packages/adapter-gemini/dist/cli.js')
      for (const hookName of [
        'SessionStart',
        'BeforeTool',
        'AfterTool',
        'BeforeAgent',
        'AfterAgent',
        'SessionEnd',
      ]) {
        assertContains(file, content, `\`${hookName}\``)
      }
    }
  })

  it('keeps the Gemini dual-wiring guardrail visible across operator-facing docs', () => {
    for (const file of REPO_OPERATOR_DOCS) {
      const content = readContent(file)
      assertGeminiDualWiringGuardrail(file, content)
    }
  })

  it('keeps Gemini and OpenCode source-of-truth pointers symmetric across operator-facing docs', () => {
    for (const file of REPO_OPERATOR_DOCS) {
      const content = readContent(file)
      assertContains(file, content, 'packages/adapter-claude/README.md')
      assertContains(file, content, 'packages/adapter-claude/hooks/hooks.json')
      assertContains(file, content, 'packages/adapter-codex/README.md')
      assertContains(file, content, 'packages/adapter-codex/examples/hooks.json')
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
    assertContains(SELF_HOSTING_GUIDE, content, 'without assuming transcripts or shell parsing')
    assertContains(SELF_HOSTING_GUIDE, content, 'packages/adapter-gemini/README.md')
    assertContains(
      SELF_HOSTING_GUIDE,
      content,
      'packages/adapter-gemini/examples/.gemini/settings.json',
    )
    assertContains(SELF_HOSTING_GUIDE, content, '`SessionEnd`')
    assertGeminiDualWiringGuardrail(SELF_HOSTING_GUIDE, content)
  })

  it('keeps the beta checklist aligned to stable versus experimental smoke ownership', () => {
    const content = readContent(BETA_RELEASE_CHECKLIST)

    assertContains(BETA_RELEASE_CHECKLIST, content, 'npm run build')
    assertContains(BETA_RELEASE_CHECKLIST, content, 'npm run test')
    assertContains(BETA_RELEASE_CHECKLIST, content, 'PYTHONPATH=apps/api uv run ruff check apps/api')
    assertContains(BETA_RELEASE_CHECKLIST, content, 'npm run smoke:stable')
    assertContains(BETA_RELEASE_CHECKLIST, content, 'npm run smoke:experimental')
    assertContains(BETA_RELEASE_CHECKLIST, content, 'npm run smoke:claude')
    assertContains(BETA_RELEASE_CHECKLIST, content, 'npm run smoke:codex')
    assertContains(BETA_RELEASE_CHECKLIST, content, 'npm run smoke:gemini')
    assertContains(BETA_RELEASE_CHECKLIST, content, 'npm run smoke:opencode')
    assertNotContains(BETA_RELEASE_CHECKLIST, content, '`npm run smoke:adapters`')
    assertContains(BETA_RELEASE_CHECKLIST, content, 'packages/adapter-gemini/README.md')
    assertContains(BETA_RELEASE_CHECKLIST, content, 'packages/adapter-gemini/examples/.gemini/settings.json')
    assertContains(BETA_RELEASE_CHECKLIST, content, 'packages/adapter-opencode/README.md')
    assertContains(BETA_RELEASE_CHECKLIST, content, 'packages/adapter-opencode/examples/clipulse.ts')
    assertContains(BETA_RELEASE_CHECKLIST, content, 'CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF=1')
    assertMatches(
      BETA_RELEASE_CHECKLIST,
      content,
      /stable smoke|stable gate/i,
      'stable smoke summary',
    )
    assertMatches(
      BETA_RELEASE_CHECKLIST,
      content,
      /experimental smoke.*diagnostic|focused diagnostics/i,
      'experimental smoke summary',
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
      /stdout contract|machine-readable|source of truth/i,
      'smoke ownership wording',
    )
    assertMatches(
      BETA_RELEASE_CHECKLIST,
      content,
      /wrapper.*smoke|experimental-strip-types/i,
      'OpenCode wrapper-runtime note',
    )
  })

  it('keeps the self-hosting guide summary aligned to the stable versus experimental smoke split', () => {
    const content = readContent(SELF_HOSTING_GUIDE)

    assertContains(SELF_HOSTING_GUIDE, content, 'npm run smoke:stable')
    assertContains(SELF_HOSTING_GUIDE, content, 'npm run smoke:experimental')
    assertContains(SELF_HOSTING_GUIDE, content, 'npm run smoke:self-hosted')
    assertContains(SELF_HOSTING_GUIDE, content, 'npm run smoke:self-hosted:experimental')
    assertNotContains(SELF_HOSTING_GUIDE, content, '`npm run smoke:adapters`')
    assertContains(SELF_HOSTING_GUIDE, content, 'Manual probes')
    assertMatches(SELF_HOSTING_GUIDE, content, /diagnostic/i, 'manual-probe diagnostic note')
  })

  it('keeps CI build, stable smoke, experimental smoke, tests, lint, and self-hosted smoke explicit, ordered, and non-duplicated', () => {
    const content = readContent(BETA_CHECKS_WORKFLOW)
    const buildStepIndex = content.indexOf('- name: Build repo workspaces')
    const stableAdapterSmokeStepIndex = content.indexOf('- name: Run stable adapter smoke')
    const geminiSmokeStepIndex = content.indexOf('- name: Run experimental smoke (Gemini CLI)')
    const opencodeSmokeStepIndex = content.indexOf('- name: Run experimental smoke (OpenCode)')
    const repoTestsStepIndex = content.indexOf('- name: Run repo tests')
    const apiLintStepIndex = content.indexOf('- name: Run API lint')
    const selfHostedStepIndex = content.indexOf('- name: Run stable self-hosted smoke')

    assertContains(BETA_CHECKS_WORKFLOW, content, '- name: Build repo workspaces')
    assertContains(BETA_CHECKS_WORKFLOW, content, 'run: npm run build')
    assertContains(BETA_CHECKS_WORKFLOW, content, '- name: Run stable adapter smoke')
    assertContains(BETA_CHECKS_WORKFLOW, content, 'run: npm run smoke:adapters:stable')
    assertContains(BETA_CHECKS_WORKFLOW, content, '- name: Run experimental smoke (Gemini CLI)')
    assertContains(BETA_CHECKS_WORKFLOW, content, 'run: npm run smoke:gemini')
    assertContains(BETA_CHECKS_WORKFLOW, content, '- name: Run experimental smoke (OpenCode)')
    assertContains(BETA_CHECKS_WORKFLOW, content, 'run: npm run smoke:opencode')
    assertContains(BETA_CHECKS_WORKFLOW, content, '- name: Run repo tests')
    assertContains(BETA_CHECKS_WORKFLOW, content, 'run: npm run test')
    assertContains(BETA_CHECKS_WORKFLOW, content, '- name: Run API lint')
    assertContains(BETA_CHECKS_WORKFLOW, content, 'run: npm run lint:api')
    assertContains(BETA_CHECKS_WORKFLOW, content, '- name: Run stable self-hosted smoke')
    assertContains(BETA_CHECKS_WORKFLOW, content, 'run: npm run smoke:self-hosted')
    expect(content).not.toContain('npm run check:beta\n')
    expect(content).not.toContain('run: npm run smoke:experimental')
    expect(countMatches(content, /- name: Build repo workspaces/)).toBe(1)
    expect(countMatches(content, /run: npm run build/)).toBe(1)
    expect(countMatches(content, /- name: Run stable adapter smoke/)).toBe(1)
    expect(countMatches(content, /run: npm run smoke:adapters:stable/)).toBe(1)
    expect(countMatches(content, /- name: Run experimental smoke \(Gemini CLI\)/)).toBe(1)
    expect(countMatches(content, /run: npm run smoke:gemini/)).toBe(1)
    expect(countMatches(content, /- name: Run experimental smoke \(OpenCode\)/)).toBe(1)
    expect(countMatches(content, /run: npm run smoke:opencode/)).toBe(1)
    expect(countMatches(content, /- name: Run repo tests/)).toBe(1)
    expect(countMatches(content, /run: npm run test/)).toBe(1)
    expect(countMatches(content, /- name: Run API lint/)).toBe(1)
    expect(countMatches(content, /run: npm run lint:api/)).toBe(1)
    expect(countMatches(content, /- name: Run stable self-hosted smoke/)).toBe(1)
    expect(countMatches(content, /run: npm run smoke:self-hosted/)).toBe(1)
    expect(buildStepIndex).toBeGreaterThan(-1)
    expect(stableAdapterSmokeStepIndex).toBeGreaterThan(-1)
    expect(geminiSmokeStepIndex).toBeGreaterThan(-1)
    expect(opencodeSmokeStepIndex).toBeGreaterThan(-1)
    expect(repoTestsStepIndex).toBeGreaterThan(-1)
    expect(apiLintStepIndex).toBeGreaterThan(-1)
    expect(selfHostedStepIndex).toBeGreaterThan(-1)
    expect(buildStepIndex).toBeLessThan(stableAdapterSmokeStepIndex)
    expect(stableAdapterSmokeStepIndex).toBeLessThan(geminiSmokeStepIndex)
    expect(geminiSmokeStepIndex).toBeLessThan(opencodeSmokeStepIndex)
    expect(opencodeSmokeStepIndex).toBeLessThan(repoTestsStepIndex)
    expect(repoTestsStepIndex).toBeLessThan(apiLintStepIndex)
    expect(apiLintStepIndex).toBeLessThan(selfHostedStepIndex)
  })
})
