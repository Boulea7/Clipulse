import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  buildPackageSmokeProbe,
  resolveDeploymentSmokeArgs,
  selectReleaseArtifacts,
} from '../scripts/check-py-install-smoke.mjs'

describe('buildPackageSmokeProbe', () => {
  it('checks bundled shell markers instead of hydrated dashboard controls', () => {
    const probe = buildPackageSmokeProbe()

    expect(probe).toContain('assert root.status_code == 200')
    expect(probe).toContain('assert "Clipulse dashboard assets are not bundled" not in root.text')
    expect(probe).toContain('assert "id=\\"overview\\"" in root.text')
    expect(probe).toContain('assert "./static/styles.css" in root.text')
    expect(probe).toContain('assert "./static/app.js" in root.text')
    expect(probe).toContain('/static/dashboard.js')
    expect(probe).toContain('/static/dom.js')
    expect(probe).toContain('/static/formatters.js')
    expect(probe).toContain('/static/routes.js')
    expect(probe).toContain('/static/session-list-paths.js')
    expect(probe).toContain('/static/view-models.js')
    expect(probe).toContain('/contracts/events-batch.v1.json')
    expect(probe).not.toContain('logout-button')
  })

  it('pins the packaged events-batch contract checks to the current outbound v1 contract', () => {
    const probe = buildPackageSmokeProbe()
    const eventsBatchContract = JSON.parse(
      readFileSync(new URL('../contracts/events-batch.v1.json', import.meta.url), 'utf8'),
    ) as {
      _meta: { version: string }
      event: {
        project_root: { pattern: string }
        event_id: { pattern: string }
        privacy_mode: { allowed: string[] }
      }
    }

    expect(eventsBatchContract._meta.version).toBe('v1')
    expect(eventsBatchContract.event.project_root.pattern).toBe('^[0-9a-f]{12}$')
    expect(eventsBatchContract.event.event_id.pattern).toBe('^[0-9a-f]{64}$')
    expect(eventsBatchContract.event.privacy_mode.allowed).toEqual(['hashed'])

    expect(probe).toContain('assert contract_payload["_meta"]["version"] == "v1"')
    expect(probe).toContain(
      'assert contract_payload["event"]["project_root"]["pattern"] == "^[0-9a-f]{12}$"',
    )
    expect(probe).toContain(
      'assert contract_payload["event"]["event_id"]["pattern"] == "^[0-9a-f]{64}$"',
    )
    expect(probe).toContain(
      'assert contract_payload["event"]["privacy_mode"]["allowed"] == ["hashed"]',
    )
  })
})

describe('resolveDeploymentSmokeArgs', () => {
  it('skips the extra deployment smoke when the repo does not ship that script yet', () => {
    expect(
      resolveDeploymentSmokeArgs('/workspace/clipulse/.worktrees/public-surface-fix'),
    ).toBeNull()
  })
})

describe('selectReleaseArtifacts', () => {
  it('keeps both the wheel and sdist in the install smoke coverage', () => {
    expect(
      selectReleaseArtifacts(
        [
          'clipulse_api-0.0.9.tar.gz',
          'clipulse_api-0.0.9-py3-none-any.whl',
          'clipulse_api-0.1.0.tar.gz',
          'clipulse_api-0.1.0-py3-none-any.whl',
          'notes.txt',
        ],
        '/tmp/dist',
        '0.1.0',
      ),
    ).toEqual([
      '/tmp/dist/clipulse_api-0.1.0-py3-none-any.whl',
      '/tmp/dist/clipulse_api-0.1.0.tar.gz',
    ])
  })
})
