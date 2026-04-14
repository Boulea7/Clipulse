import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const ROOT_PACKAGE_JSON = new URL('../../package.json', import.meta.url)
const BETA_WORKFLOW = new URL('../../.github/workflows/beta-checks.yml', import.meta.url)
const CHANGELOG = new URL('../../CHANGELOG.md', import.meta.url)
const DASHBOARD_COMPAT_ARTIFACT = new URL('../../contracts/dashboard-compat.v1.json', import.meta.url)

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
})
