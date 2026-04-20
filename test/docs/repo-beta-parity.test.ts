import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const ROOT_PACKAGE_JSON = new URL('../../package.json', import.meta.url)
const BETA_WORKFLOW = new URL('../../.github/workflows/beta-checks.yml', import.meta.url)
const CHANGELOG = new URL('../../CHANGELOG.md', import.meta.url)
const DASHBOARD_COMPAT_ARTIFACT = new URL('../../contracts/dashboard-compat.v1.json', import.meta.url)
const UV_LOCK = new URL('../../uv.lock', import.meta.url)
const FEATURE_REQUEST_TEMPLATE = new URL('../../.github/ISSUE_TEMPLATE/feature_request.yml', import.meta.url)

const EXPECTED_CHECK_BETA_SEQUENCE = [
  'npm run build',
  'npm run test',
  'npm run lint:api',
  'npm run smoke:stable',
  'npm run smoke:experimental',
]

const EXPECTED_CHECK_BETA_CI_SEQUENCE = [
  'npm run smoke:repo-guardrails',
  'npm run build',
  'npm run test',
  'npm run lint:api',
  'npm run smoke:stable',
  'npm run smoke:experimental',
]

const EXPECTED_RELEASE_PREP_SEQUENCE = [
  'npm run check:release-metadata:stable',
  'npm run smoke:repo-guardrails:stable',
  'npm run build:release:stable',
  'npm run test:release:stable',
  'npm run lint:api',
  'npm run smoke:stable',
  'npm run check:py-build',
  'npm run check:py-install-smoke',
  'npm run check:package:stable',
]

const REQUIRED_COMPAT_SECTIONS = [
  'projectTopItem',
  'sessionListItem',
  'projectDetail',
  'sessionDetail',
  'timeseriesItem',
] as const

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

const EXPECTED_STABLE_REPO_GUARDRAILS = ['npm run test:docs:release:stable']
const EXPECTED_STABLE_DOC_RELEASE_TESTS = [
  'test/docs/repo-release-stable-parity.test.ts',
  'test/docs/repo-release-stable-hygiene.test.ts',
]

function readContent(file: URL): string {
  return readFileSync(file, 'utf8')
}

function readScripts(): Record<string, string> {
  const packageJson = JSON.parse(readContent(ROOT_PACKAGE_JSON)) as {
    scripts?: Record<string, string>
  }

  return packageJson.scripts ?? {}
}

function splitCommandChain(command: string): string[] {
  return command
    .split('&&')
    .map((part) => part.trim())
    .filter(Boolean)
}

function readWorkflowBlockingRunLines(): string[] {
  const workflow = readContent(BETA_WORKFLOW)
  const runLines = Array.from(workflow.matchAll(/^ {8}run: (.+)$/gm), ([, command]) => command.trim())
  const guardrailIndex = runLines.indexOf('npm run smoke:repo-guardrails')

  expect(guardrailIndex).toBeGreaterThan(-1)

  return runLines.slice(guardrailIndex, guardrailIndex + EXPECTED_CHECK_BETA_CI_SEQUENCE.length)
}

function readWorkflowStepIndex(stepName: string): number {
  return readContent(BETA_WORKFLOW).indexOf(`- name: ${stepName}`)
}

function readCompatArtifact(): DashboardCompatArtifact {
  return JSON.parse(readContent(DASHBOARD_COMPAT_ARTIFACT)) as DashboardCompatArtifact
}

describe('repo beta parity', () => {
  it('keeps beta command parity aligned across package scripts, workflow ordering, and smoke grouping', () => {
    const scripts = readScripts()

    expect(splitCommandChain(scripts['smoke:stable'])).toEqual([
      'npm run smoke:adapters:stable',
      'npm run smoke:self-hosted',
    ])
    expect(splitCommandChain(scripts['smoke:experimental'])).toEqual([
      'npm run smoke:adapters:experimental',
      'npm run smoke:self-hosted:experimental',
    ])
    expect(splitCommandChain(scripts['check:beta'])).toEqual(EXPECTED_CHECK_BETA_SEQUENCE)
    expect(splitCommandChain(scripts['check:beta:ci'])).toEqual(EXPECTED_CHECK_BETA_CI_SEQUENCE)
    expect(readWorkflowBlockingRunLines()).toEqual(EXPECTED_CHECK_BETA_CI_SEQUENCE)
    expect(readContent(BETA_WORKFLOW)).toContain('uv sync --frozen --group dev')
  })

  it('keeps the public release surface aligned to required dashboard compat sections and alias pairs from the checked-in artifact', () => {
    const changelog = readContent(CHANGELOG)
    const contract = readCompatArtifact()

    for (const section of REQUIRED_COMPAT_SECTIONS) {
      expect(contract._meta.sections).toContain(section)
    }

    expect(changelog).toContain('## [Unreleased]')
    expect(changelog).toContain('beta')

    for (const section of ['projectTopItem', 'sessionListItem', 'projectDetail', 'sessionDetail'] as const) {
      const compatSection = contract[section] as DashboardCompatArtifactSection

      for (const pair of compatSection.anyNumber ?? []) {
        expect(pair.label.length).toBeGreaterThan(0)
      }
    }
  })

  it('keeps public issue templates inside repository-managed support routes without a general contact email', () => {
    const featureRequest = readContent(FEATURE_REQUEST_TEMPLATE)

    expect(featureRequest).toContain('SECURITY.md')
    expect(featureRequest).not.toContain('opensource@lnzai.com')
  })

  it('keeps repo guardrail smoke explicit, cheap, and ahead of the heavy CI steps', () => {
    const scripts = readScripts()
    const workflow = readContent(BETA_WORKFLOW)
    const guardrailStepIndex = readWorkflowStepIndex('Run repo smoke guardrails')
    const buildStepIndex = readWorkflowStepIndex('Build repo workspaces')

    expect(scripts['smoke:repo-guardrails']).toBe(
      'vitest run test/docs smoke/self-hosted-launchers.test.ts',
    )
    expect(workflow).toContain('- name: Run repo smoke guardrails')
    expect(workflow).toContain('run: npm run smoke:repo-guardrails')
    expect(guardrailStepIndex).toBeGreaterThan(-1)
    expect(buildStepIndex).toBeGreaterThan(-1)
    expect(guardrailStepIndex).toBeLessThan(buildStepIndex)
  })

  it('keeps the release-ready gate scoped to the stable self-hosted surface', () => {
    const scripts = readScripts()

    expect(splitCommandChain(scripts['check:release:prep'])).toEqual(EXPECTED_RELEASE_PREP_SEQUENCE)
    expect(splitCommandChain(scripts['check:release:prep'])).not.toContain('npm run smoke:experimental')
    expect(splitCommandChain(scripts['smoke:repo-guardrails:stable'])).toEqual(
      EXPECTED_STABLE_REPO_GUARDRAILS,
    )
    expect(scripts['test:docs:release:stable']).toBe(
      `vitest run ${EXPECTED_STABLE_DOC_RELEASE_TESTS.join(' ')}`,
    )
    expect(scripts['build:release:stable']).toBe(
      'npm run build --workspace @clipulse/collector-core && npm run build --workspace @clipulse/adapter-claude && npm run build --workspace @clipulse/adapter-codex',
    )
    expect(scripts['bundle:stable']).toBe('node scripts/stable-packaging.mjs bundle')
    expect(scripts['check:package:stable']).toBe('node scripts/stable-packaging.mjs check')
    expect(scripts['test:release:stable']).toBe('npm run test:js:release:stable && npm run test:py')
    expect(scripts['test:js:release:stable']).toBe(
      'vitest run packages/collector-core/test packages/adapter-claude/test packages/adapter-codex/test apps/web test/check-py-install-smoke.test.ts test/stable-packaging.test.ts test/docs/repo-release-stable-parity.test.ts test/docs/repo-release-stable-hygiene.test.ts test/smoke-deployment.test.ts test/smoke-shared.test.ts',
    )
    expect(scripts['test:js:release:stable']).not.toContain('test/docs/repo-beta-parity.test.ts')
    expect(scripts['test:js:release:stable']).not.toContain('test/docs/repo-operator-docs-parity.test.ts')
    expect(scripts['test:js:release:stable']).not.toContain('test/docs/repo-public-surface-parity.test.ts')
    expect(scripts['test:js:release:stable']).not.toContain('test/docs/repo-smoke-contracts.test.ts')
  })

  it('keeps the release workflow ready to create or refresh a draft GitHub release with artifacts', () => {
    const workflow = readContent(new URL('../../.github/workflows/release-skeleton.yml', import.meta.url))

    expect(workflow).toContain('contents: write')
    expect(workflow).toContain('fetch-depth: 0')
    expect(workflow).toContain('Verify requested tag exists')
    expect(workflow).toContain('Check out requested release tag')
    expect(workflow).toContain('ref: refs/tags/v${{ steps.version.outputs.value }}')
    expect(workflow).toContain('Generate release checksums')
    expect(workflow).toContain('Bundle stable adapter artifacts')
    expect(workflow).toContain('npm run bundle:stable')
    expect(workflow).toContain('dist/stable-bundles/*')
    expect(workflow).toContain('gh api -i "repos/${GITHUB_REPOSITORY}/releases/tags/${RELEASE_TAG}"')
    expect(workflow).toContain("grep -q 'HTTP/[^ ]* 404'")
    expect(workflow).toContain('gh release create')
    expect(workflow).toContain('gh release upload')
    expect(workflow).toContain('gh release edit')
    expect(workflow).toContain('--draft')
    expect(workflow).toContain('--verify-tag')
    expect(workflow).not.toContain('--target "${GITHUB_SHA}"')
    expect(workflow).not.toContain('shasum -a 256 dist/*')
    expect(workflow).toContain('dist/stable-bundles/*.tar.gz')
    expect(workflow).toContain('dist/npm-packages/*.tgz')
    expect(workflow).toContain('gh release delete-asset')
    expect(workflow).toContain('asset_id=')
    expect(workflow).toContain('[ -n "${asset_id}" ]')
    expect(workflow).toContain('clipulse-python-${{ steps.version.outputs.value }}-sha256.txt')
  })

  it('keeps the uv lockfile on canonical PyPI URLs instead of machine-local mirrors', () => {
    const lockfile = readContent(UV_LOCK)

    expect(lockfile).not.toContain('pypi.tuna.tsinghua.edu.cn')
    expect(lockfile).not.toContain('mirrors.aliyun.com')
    expect(lockfile).not.toContain('mirror.sjtu.edu.cn')
  })
})
