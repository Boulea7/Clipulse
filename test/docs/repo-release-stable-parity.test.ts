import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ROOT_PACKAGE_JSON = new URL('../../package.json', import.meta.url)
const RELEASE_WORKFLOW = new URL('../../.github/workflows/release-skeleton.yml', import.meta.url)
const CHANGELOG = new URL('../../CHANGELOG.md', import.meta.url)
const CONTRIBUTING = new URL('../../CONTRIBUTING.md', import.meta.url)
const CODE_OF_CONDUCT = new URL('../../CODE_OF_CONDUCT.md', import.meta.url)
const SECURITY = new URL('../../SECURITY.md', import.meta.url)
const SUPPORT = new URL('../../SUPPORT.md', import.meta.url)
const ISSUE_TEMPLATE_CONFIG = new URL('../../.github/ISSUE_TEMPLATE/config.yml', import.meta.url)
const BUG_REPORT_TEMPLATE = new URL('../../.github/ISSUE_TEMPLATE/bug_report.yml', import.meta.url)
const PR_TEMPLATE = new URL('../../.github/pull_request_template.md', import.meta.url)
const PUBLIC_AGENTS = new URL('../../AGENTS.md', import.meta.url)
const ENV_EXAMPLE = new URL('../../.env.example', import.meta.url)
const GITIGNORE = new URL('../../.gitignore', import.meta.url)
const DASHBOARD_COMPAT_ARTIFACT = new URL('../../contracts/dashboard-compat.v1.json', import.meta.url)
const UV_LOCK = new URL('../../uv.lock', import.meta.url)

const EXPECTED_RELEASE_PREP_SEQUENCE = [
  'npm run check:release-metadata',
  'npm run smoke:repo-guardrails:stable',
  'npm run build:release:stable',
  'npm run test:release:stable',
  'npm run lint:api',
  'npm run smoke:stable',
  'npm run check:py-build',
  'npm run check:py-install-smoke',
]

const REQUIRED_COMPAT_SECTIONS = [
  'projectTopItem',
  'sessionListItem',
  'projectDetail',
  'sessionDetail',
  'timeseriesItem',
] as const

const EXPECTED_STABLE_DOC_RELEASE_TESTS = [
  'test/docs/repo-release-stable-parity.test.ts',
  'test/docs/repo-release-stable-hygiene.test.ts',
]

interface DashboardCompatArtifactSection {
  anyNumber?: Array<{
    label: string
    fields: string[]
  }>
}

interface DashboardCompatArtifact {
  _meta: {
    sections: string[]
  }
  [section: string]: DashboardCompatArtifactSection | DashboardCompatArtifact['_meta']
}

function fileLabel(file: URL): string {
  return fileURLToPath(file)
}

function readContent(file: URL): string {
  return readFileSync(file, 'utf8')
}

function readScripts(): Record<string, string> {
  const packageJson = JSON.parse(readContent(ROOT_PACKAGE_JSON)) as {
    scripts?: Record<string, string>
  }

  return packageJson.scripts ?? {}
}

function readCompatArtifact(): DashboardCompatArtifact {
  return JSON.parse(readContent(DASHBOARD_COMPAT_ARTIFACT)) as DashboardCompatArtifact
}

function splitCommandChain(command: string): string[] {
  return command
    .split('&&')
    .map((part) => part.trim())
    .filter(Boolean)
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

describe('repo release stable parity', () => {
  it('keeps the stable release-prep chain scoped to stable guardrails and stable hosts', () => {
    const scripts = readScripts()

    expect(splitCommandChain(scripts['check:release:prep'])).toEqual(EXPECTED_RELEASE_PREP_SEQUENCE)
    expect(scripts['smoke:repo-guardrails:stable']).toBe('npm run test:docs:release:stable')
    expect(scripts['test:docs:release:stable']).toBe(
      `vitest run ${EXPECTED_STABLE_DOC_RELEASE_TESTS.join(' ')}`,
    )
    expect(scripts['build:release:stable']).toBe(
      'npm run build --workspace @clipulse/collector-core && npm run build --workspace @clipulse/adapter-claude && npm run build --workspace @clipulse/adapter-codex',
    )
    expect(scripts['test:release:stable']).toBe('npm run test:js:release:stable && npm run test:py')
    expect(scripts['test:js:release:stable']).toBe(
      'vitest run packages/collector-core/test packages/adapter-claude/test packages/adapter-codex/test apps/web test/check-py-install-smoke.test.ts test/docs/repo-release-stable-parity.test.ts test/docs/repo-release-stable-hygiene.test.ts test/smoke-deployment.test.ts test/smoke-shared.test.ts',
    )
    expect(scripts['check:release:prep']).not.toContain('npm run smoke:experimental')
    expect(scripts['test:js:release:stable']).not.toContain('test/docs/repo-beta-parity.test.ts')
    expect(scripts['test:js:release:stable']).not.toContain('test/docs/repo-operator-docs-parity.test.ts')
    expect(scripts['test:js:release:stable']).not.toContain('test/docs/repo-public-surface-parity.test.ts')
    expect(scripts['test:js:release:stable']).not.toContain('test/docs/repo-smoke-contracts.test.ts')
  })

  it('keeps the release workflow pinned to the requested tag and able to refresh draft assets', () => {
    const workflow = readContent(RELEASE_WORKFLOW)

    expect(workflow).toContain('contents: write')
    expect(workflow).toContain('fetch-depth: 0')
    expect(workflow).toContain('Verify requested tag exists')
    expect(workflow).toContain('Check out requested release tag')
    expect(workflow).toContain('ref: refs/tags/v${{ steps.version.outputs.value }}')
    expect(workflow).toContain('Generate release checksums')
    expect(workflow).toContain('gh api -i "repos/${GITHUB_REPOSITORY}/releases/tags/${RELEASE_TAG}"')
    expect(workflow).toContain("grep -q 'HTTP/[^ ]* 404'")
    expect(workflow).toContain('gh release create')
    expect(workflow).toContain('gh release upload')
    expect(workflow).toContain('gh release edit')
    expect(workflow).toContain('--draft')
    expect(workflow).not.toContain('--clobber')
    expect(workflow).toContain('--verify-tag')
    expect(workflow).not.toContain('--target "${GITHUB_SHA}"')
    expect(workflow).toContain('for asset_path in dist/clipulse_api-* "${checksum_asset}"; do')
    expect(workflow).toContain('asset_lookup=')
    expect(workflow).toContain('[ -n "${asset_lookup}" ]')
    expect(workflow).toContain('Draft release asset already exists')
    expect(workflow).not.toContain('gh release delete-asset')
    expect(workflow).toContain('clipulse-python-${{ steps.version.outputs.value }}-sha256.txt')
  })

  it('keeps the packaged dashboard contract and public community docs aligned to the stable release surface', () => {
    const changelog = expectFile(CHANGELOG)
    const contributing = expectFile(CONTRIBUTING)
    const codeOfConduct = expectFile(CODE_OF_CONDUCT)
    const security = expectFile(SECURITY)
    const support = expectFile(SUPPORT)
    const config = expectFile(ISSUE_TEMPLATE_CONFIG)
    const bugReport = expectFile(BUG_REPORT_TEMPLATE)
    const prTemplate = expectFile(PR_TEMPLATE)
    const contract = readCompatArtifact()

    for (const section of REQUIRED_COMPAT_SECTIONS) {
      expect(contract._meta.sections).toContain(section)
    }

    for (const section of ['projectTopItem', 'sessionListItem', 'projectDetail', 'sessionDetail'] as const) {
      const compatSection = contract[section] as DashboardCompatArtifactSection

      for (const pair of compatSection.anyNumber ?? []) {
        expect(pair.label.length).toBeGreaterThan(0)
      }
    }

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
    assertContains(PR_TEMPLATE, prTemplate, 'Public Docs And Community Surface')
    assertContains(PR_TEMPLATE, prTemplate, 'Privacy And Security')
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
    assertContainsLine(GITIGNORE, gitignore, '/AGENTS.md')
    assertContainsLine(GITIGNORE, gitignore, '/CLAUDE.md')
    assertContainsLine(GITIGNORE, gitignore, '/GEMINI.md')
    assertContainsLine(GITIGNORE, gitignore, '/.claude/')
    assertContainsLine(GITIGNORE, gitignore, '/.codex/')
    assertContainsLine(GITIGNORE, gitignore, '/.cursor/')
  })

  it('keeps the uv lockfile on canonical PyPI URLs instead of machine-local mirrors', () => {
    const lockfile = readContent(UV_LOCK)

    expect(lockfile).not.toContain('pypi.tuna.tsinghua.edu.cn')
    expect(lockfile).not.toContain('mirrors.aliyun.com')
    expect(lockfile).not.toContain('mirror.sjtu.edu.cn')
  })
})
