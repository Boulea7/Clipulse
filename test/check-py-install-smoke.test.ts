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
    expect(probe).toContain('/static/view-models.js')
    expect(probe).toContain('/contracts/events-batch.v1.json')
    expect(probe).not.toContain('logout-button')
  })
})

describe('resolveDeploymentSmokeArgs', () => {
  it('skips the extra deployment smoke when the repo does not ship that script yet', () => {
    expect(
      resolveDeploymentSmokeArgs('/Users/jialinli/Clipulse/.worktrees/public-surface-fix'),
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
