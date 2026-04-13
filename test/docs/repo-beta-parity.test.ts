import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const ROOT_PACKAGE_JSON = new URL('../../package.json', import.meta.url)
const BETA_WORKFLOW = new URL('../../.github/workflows/beta-checks.yml', import.meta.url)
const PROJECT_AGENTS = new URL('../../AGENTS.md', import.meta.url)
const BETA_RELEASE_CHECKLIST = new URL('../../docs/beta-release-checklist.md', import.meta.url)
const DASHBOARD_COMPAT_ARTIFACT = new URL('../../contracts/dashboard-compat.v1.json', import.meta.url)

const EXPECTED_CHECK_BETA_SEQUENCE = [
  'npm run build',
  'npm run test',
  'npm run lint:api',
  'npm run smoke:stable',
  'npm run smoke:experimental',
]

const EXPECTED_CHECK_BETA_CI_SEQUENCE = [
  'npm run build',
  'npm run smoke:adapters:stable',
  'npm run smoke:gemini',
  'npm run smoke:opencode',
  'npm run test',
  'npm run lint:api',
  'npm run smoke:self-hosted',
  'npm run smoke:self-hosted:experimental',
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
  const buildIndex = runLines.indexOf('npm run build')

  expect(buildIndex).toBeGreaterThan(-1)

  return runLines.slice(buildIndex, buildIndex + EXPECTED_CHECK_BETA_CI_SEQUENCE.length)
}

function readCompatArtifact(): DashboardCompatArtifact {
  return JSON.parse(readContent(DASHBOARD_COMPAT_ARTIFACT)) as DashboardCompatArtifact
}

describe('repo beta parity', () => {
  it('keeps beta command parity aligned across package scripts, workflow ordering, smoke grouping, and AGENTS summary text', () => {
    const scripts = readScripts()
    const agents = readContent(PROJECT_AGENTS)

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

    expect(agents).toContain(
      '`check:beta` stays `npm run build` -> `npm run test` -> `npm run lint:api` -> `npm run smoke:stable` -> `npm run smoke:experimental`.',
    )
    expect(agents).toContain(
      '`check:beta:ci` stays `npm run build` -> `npm run smoke:adapters:stable` -> `npm run smoke:gemini` -> `npm run smoke:opencode` -> `npm run test` -> `npm run lint:api` -> `npm run smoke:self-hosted` -> `npm run smoke:self-hosted:experimental`.',
    )
    expect(agents).toContain(
      '`smoke:stable` expands to `smoke:adapters:stable` plus `smoke:self-hosted`',
    )
    expect(agents).toContain(
      '`smoke:experimental` expands to `smoke:adapters:experimental` plus `smoke:self-hosted:experimental`',
    )
  })

  it('keeps the beta release checklist aligned to required dashboard compat sections and alias pairs from the checked-in artifact', () => {
    const checklist = readContent(BETA_RELEASE_CHECKLIST)
    const contract = readCompatArtifact()

    for (const section of REQUIRED_COMPAT_SECTIONS) {
      expect(contract._meta.sections).toContain(section)
      expect(checklist).toContain(section)
    }

    for (const section of ['projectTopItem', 'sessionListItem', 'projectDetail', 'sessionDetail'] as const) {
      const compatSection = contract[section] as DashboardCompatArtifactSection

      for (const pair of compatSection.anyNumber ?? []) {
        expect(checklist).toContain(`${section}.anyNumber`)
        expect(checklist).toContain(pair.label)
      }
    }
  })
})
