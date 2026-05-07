import { execFileSync } from 'node:child_process'
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
const PUBLIC_AGENTS = new URL('../../AGENTS.md', import.meta.url)
const ENV_EXAMPLE = new URL('../../.env.example', import.meta.url)
const GITIGNORE = new URL('../../.gitignore', import.meta.url)
const SETUP_PY = new URL('../../setup.py', import.meta.url)

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

function assertNoActiveEnvAssignment(file: URL, content: string, key: string): void {
  const assignmentPattern = new RegExp(`^\\s*${escapeRegExp(key)}=`, 'm')
  if (assignmentPattern.test(content)) {
    throw new Error(`[${fileLabel(file)}] unexpectedly exposes active env assignment: ${key}=`)
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isTrackedByGit(file: URL): boolean {
  const repoRelativePath = fileURLToPath(file).replace(`${process.cwd()}/`, '')

  try {
    execFileSync('git', ['ls-files', '--error-unmatch', repoRelativePath], {
      cwd: process.cwd(),
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

describe('repo release stable hygiene', () => {
  it('keeps release-facing public docs and templates aligned to the stable support surface', () => {
    const contributing = expectFile(CONTRIBUTING)
    const codeOfConduct = expectFile(CODE_OF_CONDUCT)
    const security = expectFile(SECURITY)
    const support = expectFile(SUPPORT)
    const changelog = expectFile(CHANGELOG)
    const config = expectFile(ISSUE_TEMPLATE_CONFIG)
    const bugReport = expectFile(BUG_REPORT_TEMPLATE)
    const featureRequest = expectFile(FEATURE_REQUEST_TEMPLATE)
    const prTemplate = expectFile(PR_TEMPLATE)

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
    assertContains(ISSUE_TEMPLATE_CONFIG, config, 'Security policy')
    assertContains(ISSUE_TEMPLATE_CONFIG, config, 'Contribution guide')
    assertContains(ISSUE_TEMPLATE_CONFIG, config, 'SUPPORT.md')
    assertContains(BUG_REPORT_TEMPLATE, bugReport, 'SECURITY.md')
    assertContains(BUG_REPORT_TEMPLATE, bugReport, 'Checks already run')
    assertContains(FEATURE_REQUEST_TEMPLATE, featureRequest, 'SECURITY.md')
    assertContains(PR_TEMPLATE, prTemplate, 'Public Docs And Community Surface')
    assertContains(PR_TEMPLATE, prTemplate, 'Privacy And Security')
    expect(bugReport).not.toContain('opensource@lnzai.com')
    expect(featureRequest).not.toContain('opensource@lnzai.com')
  })

  it('keeps private-only files untracked and the sample environment private-by-default', () => {
    const envExample = expectFile(ENV_EXAMPLE)
    const gitignore = expectFile(GITIGNORE)

    expect(isTrackedByGit(PUBLIC_AGENTS)).toBe(false)
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
    assertContainsLine(GITIGNORE, gitignore, '**/.clipulse-private/')
    assertContainsLine(GITIGNORE, gitignore, '/AGENTS.md')
    assertContainsLine(GITIGNORE, gitignore, '**/AGENTS.md')
    assertContainsLine(GITIGNORE, gitignore, '/CLAUDE.md')
    assertContainsLine(GITIGNORE, gitignore, '**/CLAUDE.md')
    assertContainsLine(GITIGNORE, gitignore, '/GEMINI.md')
    assertContainsLine(GITIGNORE, gitignore, '**/GEMINI.md')
    assertContainsLine(GITIGNORE, gitignore, '/.claude/')
    assertContainsLine(GITIGNORE, gitignore, '**/.claude/')
    assertContainsLine(GITIGNORE, gitignore, '/.codex/')
    assertContainsLine(GITIGNORE, gitignore, '**/.codex/')
    assertContainsLine(GITIGNORE, gitignore, '/.cursor/')
    assertContainsLine(GITIGNORE, gitignore, '**/.cursor/')
  })

  it('fails Python package builds when explicit bundled web assets are missing', () => {
    const setupPy = expectFile(SETUP_PY)

    assertContains(SETUP_PY, setupPy, 'WEB_BUNDLE_FILES')
    assertContains(SETUP_PY, setupPy, 'raise FileNotFoundError')
    assertContains(SETUP_PY, setupPy, 'Required bundle file is missing')
  })
})
