import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const REPO_OPERATOR_DOCS = [
  new URL('../../README.md', import.meta.url),
  new URL('../../README.en.md', import.meta.url),
  new URL('../../README.zh-TW.md', import.meta.url),
  new URL('../../README.ja.md', import.meta.url),
  new URL('../../README.es.md', import.meta.url),
  new URL('../../README.fr.md', import.meta.url),
  new URL('../../README.ko.md', import.meta.url),
  new URL('../../docs/self-hosting-and-integration.md', import.meta.url),
]

const REPO_TOP_LEVEL_OPERATOR_SUMMARY_DOCS = [
  new URL('../../README.md', import.meta.url),
  new URL('../../README.en.md', import.meta.url),
  new URL('../../README.zh-TW.md', import.meta.url),
  new URL('../../README.ja.md', import.meta.url),
  new URL('../../README.es.md', import.meta.url),
  new URL('../../README.fr.md', import.meta.url),
  new URL('../../README.ko.md', import.meta.url),
]

const BETA_CHECKS_WORKFLOW = new URL('../../.github/workflows/beta-checks.yml', import.meta.url)
const SELF_HOSTING_GUIDE = new URL('../../docs/self-hosting-and-integration.md', import.meta.url)
const PACKAGE_README = new URL('../../README.package.md', import.meta.url)
const PACKAGE_JSON = new URL('../../package.json', import.meta.url)

function fileLabel(file: URL): string {
  return fileURLToPath(file)
}

function readContent(file: URL): string {
  return readFileSync(file, 'utf8')
}

function readPackageScripts(): Record<string, string> {
  const packageJson = JSON.parse(readContent(PACKAGE_JSON)) as {
    scripts?: Record<string, string>
  }

  return packageJson.scripts ?? {}
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

function splitCommandChain(command: string): string[] {
  return command
    .split('&&')
    .map((part) => part.trim())
    .filter(Boolean)
}

function assertGeminiDualWiringGuardrail(file: URL, content: string): void {
  const line = findRequiredLineContainingAll(file, content, ['`BeforeAgent`', '`UserPromptSubmit`'])
  assertMatches(
    file,
    line,
    /(not both|不应.*同时|不應.*同時|同時.*しない|no deben.*mismo tiempo|ne doivent pas.*meme temps|동시에.*안 됩니다)/i,
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

  it('keeps split auth and deployment probe variables visible across operator-facing docs', () => {
    for (const file of REPO_OPERATOR_DOCS) {
      const content = readContent(file)
      assertContains(file, content, 'CLIPULSE_DASHBOARD_TOKEN')
      assertContains(file, content, 'CLIPULSE_API_BEARER_TOKEN')
      assertContains(file, content, 'CLIPULSE_SESSION_SECRET')
      assertContains(file, content, 'CLIPULSE_PUBLIC_PROBE_URL')
    }
  })

  it('keeps README variants summary-first and delegates detailed runtime payload examples to the self-hosting guide', () => {
    for (const file of REPO_TOP_LEVEL_OPERATOR_SUMMARY_DOCS) {
      const content = readContent(file)
      assertContains(file, content, 'docs/self-hosting-and-integration.md')
      assertContains(file, content, 'smoke:stable')
      assertContains(file, content, 'smoke:experimental')
      assertMatches(file, content, /diagnostic|diagnostico|diagnostique|诊断|診斷|診断|진단/i, 'quick-check diagnostic note')
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

  it('keeps README tier membership explicit for stable and experimental hosts', () => {
    const stableTierMatcher = /First-class support today|当前一等支持|當前一等支援|現在の一級対応|Soporte principal hoy|Prise en charge principale aujourd'hui|현재 정식 지원/i
    const experimentalTierMatcher = /experimental|experimentales|experimentales|experimentale|experimentation|实验|實驗|実験|실험/i

    for (const file of REPO_TOP_LEVEL_OPERATOR_SUMMARY_DOCS) {
      const content = readContent(file)
      const stableLine = content
        .split('\n')
        .find(
          (candidate) =>
            candidate.includes('`Claude Code`') &&
            candidate.includes('`Codex`') &&
            stableTierMatcher.test(candidate),
        )
      const experimentalLine = content
        .split('\n')
        .find(
          (candidate) =>
            candidate.includes('`Gemini CLI`') &&
            candidate.includes('`OpenCode`') &&
            experimentalTierMatcher.test(candidate),
        )

      if (!stableLine) {
        throw new Error(`[${fileLabel(file)}] missing stable tier line for Claude Code/Codex`)
      }

      if (!experimentalLine) {
        throw new Error(
          `[${fileLabel(file)}] missing experimental tier line for Gemini CLI/OpenCode`,
        )
      }
    }
  })

  it('keeps package script composition aligned to stable and experimental smoke ownership', () => {
    const scripts = readPackageScripts()

    expect(splitCommandChain(scripts['smoke:stable'])).toEqual([
      'npm run smoke:adapters:stable',
      'npm run smoke:self-hosted',
    ])
    expect(splitCommandChain(scripts['smoke:experimental'])).toEqual([
      'npm run smoke:adapters:experimental',
      'npm run smoke:self-hosted:experimental',
    ])
    expect(splitCommandChain(scripts['check:beta'])).toEqual([
      'npm run build',
      'npm run test',
      'npm run lint:api',
      'npm run smoke:stable',
      'npm run smoke:experimental',
    ])
    expect(splitCommandChain(scripts['check:beta:ci'])).toEqual([
      'npm run smoke:repo-guardrails',
      'npm run build',
      'npm run test',
      'npm run lint:api',
      'npm run smoke:stable',
      'npm run smoke:experimental',
    ])
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

  it('keeps the self-hosting guide summary aligned to the stable versus experimental smoke split', () => {
    const content = readContent(SELF_HOSTING_GUIDE)

    assertContains(SELF_HOSTING_GUIDE, content, 'npm run smoke:stable')
    assertContains(SELF_HOSTING_GUIDE, content, 'npm run smoke:experimental')
    assertContains(SELF_HOSTING_GUIDE, content, 'npm run smoke:self-hosted')
    assertContains(SELF_HOSTING_GUIDE, content, 'npm run smoke:self-hosted:experimental')
    assertNotContains(SELF_HOSTING_GUIDE, content, '`npm run smoke:adapters`')
    assertContains(SELF_HOSTING_GUIDE, content, 'Manual probes')
    assertMatches(SELF_HOSTING_GUIDE, content, /diagnostic/i, 'manual-probe diagnostic note')
    assertContains(SELF_HOSTING_GUIDE, content, 'node packages/collector-core/dist/cli.js doctor')
    assertContains(SELF_HOSTING_GUIDE, content, 'clipulse-collector-core doctor')
    assertContains(SELF_HOSTING_GUIDE, content, 'terminal-finalizers/')
    assertContains(SELF_HOSTING_GUIDE, content, 'terminal-finalizer-locks/')
    assertContains(SELF_HOSTING_GUIDE, content, 'flush-success.json')
    assertContains(SELF_HOSTING_GUIDE, content, 'terminal finalizer marker and lock directories are also capped')
    assertContains(SELF_HOSTING_GUIDE, content, '"host_version":"<version>"')
  })

  it('keeps package install docs scoped to packaged runtime checks and delegates Node diagnostics', () => {
    const content = readContent(PACKAGE_README)

    assertContains(PACKAGE_README, content, 'clipulse-api')
    assertContains(PACKAGE_README, content, 'clipulse-migrate')
    assertContains(PACKAGE_README, content, 'npm run smoke:deployment')
    assertContains(PACKAGE_README, content, 'The Python package does not install the Node-side collector CLI.')
    assertContains(PACKAGE_README, content, 'If you also install the stable Node tarballs, then these optional local diagnostics become available:')
    assertContains(PACKAGE_README, content, 'From a source checkout, run the same diagnostics through the built workspace entrypoint instead:')
    assertContains(PACKAGE_README, content, 'node packages/collector-core/dist/cli.js doctor')
    assertContains(PACKAGE_README, content, 'docs/self-hosting-and-integration.md')
    assertContains(PACKAGE_README, content, 'docs/release-and-packaging.md')
  })

  it('keeps CI guardrails, canonical smoke lanes, and focused experimental diagnostics explicit, ordered, and non-duplicated', () => {
    const content = readContent(BETA_CHECKS_WORKFLOW)
    const scripts = readPackageScripts()
    const guardrailStepIndex = content.indexOf('- name: Run repo smoke guardrails')
    const buildStepIndex = content.indexOf('- name: Build repo workspaces')
    const repoTestsStepIndex = content.indexOf('- name: Run repo tests')
    const apiLintStepIndex = content.indexOf('- name: Run API lint')
    const stableSmokeStepIndex = content.indexOf('- name: Run stable smoke lane')
    const experimentalSmokeStepIndex = content.indexOf('- name: Run experimental smoke lane')
    const geminiSmokeStepIndex = content.indexOf('- name: Run Gemini smoke diagnostic')
    const opencodeSmokeStepIndex = content.indexOf('- name: Run OpenCode smoke diagnostic')
    const experimentalFailureStepIndex = content.indexOf('- name: Fail when the experimental smoke lane fails')

    assertContains(BETA_CHECKS_WORKFLOW, content, '- name: Run repo smoke guardrails')
    assertContains(BETA_CHECKS_WORKFLOW, content, 'run: npm run smoke:repo-guardrails')
    assertContains(BETA_CHECKS_WORKFLOW, content, '- name: Build repo workspaces')
    assertContains(BETA_CHECKS_WORKFLOW, content, 'run: npm run build')
    assertContains(BETA_CHECKS_WORKFLOW, content, '- name: Run repo tests')
    assertContains(BETA_CHECKS_WORKFLOW, content, 'run: npm run test')
    assertContains(BETA_CHECKS_WORKFLOW, content, '- name: Run API lint')
    assertContains(BETA_CHECKS_WORKFLOW, content, 'run: npm run lint:api')
    assertContains(BETA_CHECKS_WORKFLOW, content, '- name: Run stable smoke lane')
    assertContains(BETA_CHECKS_WORKFLOW, content, 'run: npm run smoke:stable')
    assertContains(BETA_CHECKS_WORKFLOW, content, '- name: Run experimental smoke lane')
    assertContains(BETA_CHECKS_WORKFLOW, content, 'run: npm run smoke:experimental')
    assertContains(BETA_CHECKS_WORKFLOW, content, '- name: Run Gemini smoke diagnostic')
    assertContains(BETA_CHECKS_WORKFLOW, content, 'run: npm run smoke:gemini')
    assertContains(BETA_CHECKS_WORKFLOW, content, '- name: Run OpenCode smoke diagnostic')
    assertContains(BETA_CHECKS_WORKFLOW, content, 'run: npm run smoke:opencode')
    assertContains(BETA_CHECKS_WORKFLOW, content, '- name: Fail when the experimental smoke lane fails')
    expect(content).not.toContain('npm run check:beta\n')
    expect(content).not.toContain('npm run check:beta:ci\n')
    expect(countMatches(content, /- name: Run repo smoke guardrails/)).toBe(1)
    expect(countMatches(content, /^ {8}run: npm run smoke:repo-guardrails$/m)).toBe(1)
    expect(countMatches(content, /- name: Build repo workspaces/)).toBe(1)
    expect(countMatches(content, /run: npm run build/)).toBe(1)
    expect(countMatches(content, /- name: Run repo tests/)).toBe(1)
    expect(countMatches(content, /run: npm run test/)).toBe(1)
    expect(countMatches(content, /- name: Run API lint/)).toBe(1)
    expect(countMatches(content, /run: npm run lint:api/)).toBe(1)
    expect(countMatches(content, /- name: Run stable smoke lane/)).toBe(1)
    expect(countMatches(content, /^ {8}run: npm run smoke:stable$/m)).toBe(1)
    expect(countMatches(content, /- name: Run experimental smoke lane/)).toBe(1)
    expect(countMatches(content, /^ {8}run: npm run smoke:experimental$/m)).toBe(1)
    expect(countMatches(content, /- name: Run Gemini smoke diagnostic/)).toBe(1)
    expect(countMatches(content, /run: npm run smoke:gemini/)).toBe(1)
    expect(countMatches(content, /- name: Run OpenCode smoke diagnostic/)).toBe(1)
    expect(countMatches(content, /run: npm run smoke:opencode/)).toBe(1)
    expect(countMatches(content, /- name: Fail when the experimental smoke lane fails/)).toBe(1)
    expect(countMatches(content, /run: exit 1/)).toBe(1)
    expect(content).not.toContain('run: npm run smoke:adapters:stable')
    expect(content).not.toContain('run: npm run smoke:self-hosted\n')
    expect(content).not.toContain('run: npm run smoke:self-hosted:experimental')
    expect(content).toContain("if: ${{ steps.experimental_smoke.outcome == 'failure' }}")
    expect(buildStepIndex).toBeGreaterThan(-1)
    expect(repoTestsStepIndex).toBeGreaterThan(-1)
    expect(apiLintStepIndex).toBeGreaterThan(-1)
    expect(stableSmokeStepIndex).toBeGreaterThan(-1)
    expect(experimentalSmokeStepIndex).toBeGreaterThan(-1)
    expect(geminiSmokeStepIndex).toBeGreaterThan(-1)
    expect(opencodeSmokeStepIndex).toBeGreaterThan(-1)
    expect(experimentalFailureStepIndex).toBeGreaterThan(-1)
    expect(guardrailStepIndex).toBeLessThan(buildStepIndex)
    expect(buildStepIndex).toBeLessThan(repoTestsStepIndex)
    expect(repoTestsStepIndex).toBeLessThan(apiLintStepIndex)
    expect(apiLintStepIndex).toBeLessThan(stableSmokeStepIndex)
    expect(stableSmokeStepIndex).toBeLessThan(experimentalSmokeStepIndex)
    expect(experimentalSmokeStepIndex).toBeLessThan(geminiSmokeStepIndex)
    expect(geminiSmokeStepIndex).toBeLessThan(opencodeSmokeStepIndex)
    expect(opencodeSmokeStepIndex).toBeLessThan(experimentalFailureStepIndex)
    expect(splitCommandChain(scripts['check:beta:ci'])).toEqual([
      'npm run smoke:repo-guardrails',
      'npm run build',
      'npm run test',
      'npm run lint:api',
      'npm run smoke:stable',
      'npm run smoke:experimental',
    ])
  })
})
