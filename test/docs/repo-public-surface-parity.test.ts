import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const CONTRIBUTING = new URL('../../CONTRIBUTING.md', import.meta.url)
const CODE_OF_CONDUCT = new URL('../../CODE_OF_CONDUCT.md', import.meta.url)
const SECURITY = new URL('../../SECURITY.md', import.meta.url)
const SUPPORT = new URL('../../SUPPORT.md', import.meta.url)
const CHANGELOG = new URL('../../CHANGELOG.md', import.meta.url)
const ISSUE_TEMPLATE_CONFIG = new URL('../../.github/ISSUE_TEMPLATE/config.yml', import.meta.url)
const BUG_REPORT_TEMPLATE = new URL('../../.github/ISSUE_TEMPLATE/bug_report.yml', import.meta.url)
const FEATURE_REQUEST_TEMPLATE = new URL('../../.github/ISSUE_TEMPLATE/feature_request.yml', import.meta.url)
const PR_TEMPLATE = new URL('../../.github/pull_request_template.md', import.meta.url)
const DEPENDABOT = new URL('../../.github/dependabot.yml', import.meta.url)
const BETA_WORKFLOW = new URL('../../.github/workflows/beta-checks.yml', import.meta.url)
const DEPENDENCY_REVIEW_WORKFLOW = new URL(
  '../../.github/workflows/dependency-review.yml',
  import.meta.url,
)
const PUBLIC_AGENTS = new URL('../../AGENTS.md', import.meta.url)
const PUBLIC_BETA_CHECKLIST = new URL('../../docs/beta-release-checklist.md', import.meta.url)
const PACKAGE_JSON = new URL('../../package.json', import.meta.url)
const ENV_EXAMPLE = new URL('../../.env.example', import.meta.url)
const GITIGNORE = new URL('../../.gitignore', import.meta.url)

function fileLabel(file: URL): string {
  return fileURLToPath(file)
}

function readContent(file: URL): string {
  return readFileSync(file, 'utf8')
}

function expectFile(file: URL): string {
  expect(existsSync(file)).toBe(true)
  return readContent(file)
}

function assertContains(file: URL, content: string, needle: string): void {
  if (!content.includes(needle)) {
    throw new Error(`[${fileLabel(file)}] missing required text: ${needle}`)
  }
}

function assertContainsLine(file: URL, content: string, line: string): void {
  const pattern = new RegExp(`^${escapeRegExp(line)}$`, 'm')
  if (!pattern.test(content)) {
    throw new Error(`[${fileLabel(file)}] missing required full line: ${line}`)
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function assertNoActiveEnvAssignment(file: URL, content: string, key: string): void {
  const assignmentPattern = new RegExp(`^\\s*${escapeRegExp(key)}=`, 'm')
  if (assignmentPattern.test(content)) {
    throw new Error(`[${fileLabel(file)}] unexpectedly exposes active env assignment: ${key}=`)
  }
}

describe('repo public surface parity', () => {
  it('ships the core public community documents and keeps them cross-linked', () => {
    const contributing = expectFile(CONTRIBUTING)
    const codeOfConduct = expectFile(CODE_OF_CONDUCT)
    const security = expectFile(SECURITY)
    const support = expectFile(SUPPORT)
    const changelog = expectFile(CHANGELOG)

    assertContains(CONTRIBUTING, contributing, 'CODE_OF_CONDUCT.md')
    assertContains(CONTRIBUTING, contributing, 'SECURITY.md')
    assertContains(CONTRIBUTING, contributing, 'SUPPORT.md')
    assertContains(CONTRIBUTING, contributing, 'smoke:repo-guardrails')
    assertContains(CODE_OF_CONDUCT, codeOfConduct, 'CONTRIBUTING.md')
    assertContains(CODE_OF_CONDUCT, codeOfConduct, 'SECURITY.md')
    assertContains(SECURITY, security, 'security/advisories/new')
    assertContains(SUPPORT, support, 'GitHub Discussions')
    assertContains(SUPPORT, support, 'SECURITY.md')
    assertContains(SUPPORT, support, 'CONTRIBUTING.md')
    assertContains(SUPPORT, support, 'self-hosting-and-integration.md')
    assertContains(CHANGELOG, changelog, 'Keep a Changelog')
    assertContains(CHANGELOG, changelog, '## [Unreleased]')
    assertContains(CHANGELOG, changelog, 'beta')
  })

  it('keeps issue and PR templates aligned to the public support and security routes', () => {
    const config = expectFile(ISSUE_TEMPLATE_CONFIG)
    const bugReport = expectFile(BUG_REPORT_TEMPLATE)
    const featureRequest = expectFile(FEATURE_REQUEST_TEMPLATE)
    const prTemplate = expectFile(PR_TEMPLATE)

    assertContains(ISSUE_TEMPLATE_CONFIG, config, 'Security policy')
    assertContains(ISSUE_TEMPLATE_CONFIG, config, 'Contribution guide')
    assertContains(ISSUE_TEMPLATE_CONFIG, config, 'SUPPORT.md')
    assertContains(BUG_REPORT_TEMPLATE, bugReport, 'SECURITY.md')
    assertContains(BUG_REPORT_TEMPLATE, bugReport, 'Checks already run')
    assertContains(FEATURE_REQUEST_TEMPLATE, featureRequest, 'summary-first docs')
    assertContains(FEATURE_REQUEST_TEMPLATE, featureRequest, 'experimental hosts')
    assertContains(PR_TEMPLATE, prTemplate, 'Public Docs And Community Surface')
    assertContains(PR_TEMPLATE, prTemplate, 'Privacy And Security')
  })

  it('pins dependency hygiene to dependabot, dependency review, and the documented runtime floor', () => {
    const dependabot = expectFile(DEPENDABOT)
    const dependencyReview = expectFile(DEPENDENCY_REVIEW_WORKFLOW)
    const betaWorkflow = expectFile(BETA_WORKFLOW)
    const packageJson = JSON.parse(readContent(PACKAGE_JSON)) as {
      engines?: Record<string, string>
    }

    assertContains(DEPENDABOT, dependabot, 'package-ecosystem: "github-actions"')
    assertContains(DEPENDABOT, dependabot, 'package-ecosystem: "npm"')
    assertContains(DEPENDABOT, dependabot, 'package-ecosystem: "pip"')
    assertContains(DEPENDABOT, dependabot, 'directory: "/"')
    assertContains(DEPENDENCY_REVIEW_WORKFLOW, dependencyReview, 'dependency-review-action')
    assertContains(DEPENDENCY_REVIEW_WORKFLOW, dependencyReview, 'pull_request')
    assertContains(BETA_WORKFLOW, betaWorkflow, 'node-version: 22.12.0')
    expect(packageJson.engines).toEqual({
      node: '>=22.12.0',
      npm: '>=10',
    })
  })

  it('keeps agent-only and maintainer-only docs out of the public tracked surface', () => {
    expect(existsSync(PUBLIC_AGENTS)).toBe(false)
    expect(existsSync(PUBLIC_BETA_CHECKLIST)).toBe(false)
  })

  it('keeps the sample environment private-by-default and preserves local cache ignore rules', () => {
    const envExample = expectFile(ENV_EXAMPLE)
    const gitignore = expectFile(GITIGNORE)

    assertContains(ENV_EXAMPLE, envExample, 'CLIPULSE_DATABASE_URL=')
    assertContains(ENV_EXAMPLE, envExample, 'before enabling protected mode')
    assertNoActiveEnvAssignment(ENV_EXAMPLE, envExample, 'CLIPULSE_DASHBOARD_TOKEN')
    assertNoActiveEnvAssignment(ENV_EXAMPLE, envExample, 'CLIPULSE_API_BEARER_TOKEN')
    assertNoActiveEnvAssignment(ENV_EXAMPLE, envExample, 'CLIPULSE_SESSION_SECRET')
    assertNoActiveEnvAssignment(ENV_EXAMPLE, envExample, 'CLIPULSE_ENABLE_PUBLIC_READS')
    assertNoActiveEnvAssignment(ENV_EXAMPLE, envExample, 'CLIPULSE_PUBLIC_BASE_URL')
    assertNoActiveEnvAssignment(ENV_EXAMPLE, envExample, 'CLIPULSE_BASE_URL')
    assertNoActiveEnvAssignment(ENV_EXAMPLE, envExample, 'CLIPULSE_EXPECT_PUBLIC_READS')
    assertNoActiveEnvAssignment(ENV_EXAMPLE, envExample, 'CLIPULSE_PUBLIC_PROBE_URL')
    assertContainsLine(GITIGNORE, gitignore, '!.env.example')
    assertContainsLine(GITIGNORE, gitignore, '.npm-cache/')
    assertContainsLine(GITIGNORE, gitignore, '/.worktrees/')
    assertContainsLine(GITIGNORE, gitignore, '/worktrees/')
    assertContainsLine(GITIGNORE, gitignore, '/AGENTS.md')
    assertContainsLine(GITIGNORE, gitignore, '/CLAUDE.md')
    assertContainsLine(GITIGNORE, gitignore, '/GEMINI.md')
    assertContainsLine(GITIGNORE, gitignore, '/.claude/')
    assertContainsLine(GITIGNORE, gitignore, '/.codex/')
    assertContainsLine(GITIGNORE, gitignore, '/.cursor/')
  })
})
