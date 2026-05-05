import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  DASHBOARD_CONTRACT_PROBE_PATHS,
  DASHBOARD_STATIC_PROBE_PATHS,
} from '../scripts/smoke-deployment.mjs'
import {
  buildPackageSmokeProbe,
  resolveDeploymentSmokeArgs,
  selectReleaseArtifacts,
} from '../scripts/check-py-install-smoke.mjs'

const REPO_ROOT = path.resolve(new URL('..', import.meta.url).pathname)
const ROOT_GITIGNORE = readFileSync(path.join(REPO_ROOT, '.gitignore'), 'utf8')
const GEMINI_README = readFileSync(path.join(REPO_ROOT, 'packages/adapter-gemini/README.md'), 'utf8')
const CLAUDE_README = readFileSync(path.join(REPO_ROOT, 'packages/adapter-claude/README.md'), 'utf8')
const PACKAGE_README = readFileSync(path.join(REPO_ROOT, 'README.package.md'), 'utf8')

describe('buildPackageSmokeProbe', () => {
  it('checks bundled shell markers instead of hydrated dashboard controls', () => {
    const probe = buildPackageSmokeProbe()

    expect(probe).toContain('assert root.status_code == 200')
    expect(probe).toContain('assert "Clipulse dashboard assets are not bundled" not in root.text')
    expect(probe).toContain('assert "id=\\"overview\\"" in root.text')
    expect(probe).toContain('assert "./static/styles.css" in root.text')
    expect(probe).toContain('assert "./static/app.js" in root.text')
    for (const staticPath of DASHBOARD_STATIC_PROBE_PATHS) {
      expect(probe).toContain(staticPath)
    }
    for (const contractPath of DASHBOARD_CONTRACT_PROBE_PATHS) {
      expect(probe).toContain(contractPath)
    }
    expect(probe).not.toContain('logout-button')
  })

  it('uses installed console scripts instead of python -m uvicorn for the package smoke lane', () => {
    const script = readFileSync(new URL('../scripts/check-py-install-smoke.mjs', import.meta.url), 'utf8')

    expect(script).toContain('clipulse-migrate')
    expect(script).toContain('clipulse-api')
    expect(script).not.toContain("['-m', 'uvicorn'")
    expect(script).not.toContain('python -m uvicorn')
  })

  it('adds a protected subpath deployment smoke lane for package installs', () => {
    const script = readFileSync(new URL('../scripts/check-py-install-smoke.mjs', import.meta.url), 'utf8')

    expect(script).toContain('CLIPULSE_FORCE_SECURE_SESSION_COOKIE')
    expect(script).toContain('CLIPULSE_TRUSTED_PROXY_CIDRS')
    expect(script).toContain('/clipulse')
    expect(script).toContain('x-forwarded-for')
    expect(script).toContain('runProtectedSubpathDeploymentSmoke')
    expect(script).toContain('publicBaseUrl: upstreamBaseUrl')
  })

  it('creates the temp environment with uv and pins the package-smoke helper dependency', () => {
    const script = readFileSync(new URL('../scripts/check-py-install-smoke.mjs', import.meta.url), 'utf8')

    expect(script).toContain("runCommand('uv', ['venv'")
    expect(script).toContain("runCommand('uv', ['pip', 'install', '--python', venvPython")
    expect(script).toContain('UV_CACHE_DIR')
    expect(script).toContain('uvSmokeEnv')
    expect(script).toContain('httpx==0.28.1')
    expect(script).not.toContain("runCommand(hostPython, ['-m', 'venv'")
    expect(script).not.toContain("'httpx>=0.28,<1'")
  })

  it('names the Python release selection after both wheel and sdist coverage', () => {
    const script = readFileSync(new URL('../scripts/check-py-install-smoke.mjs', import.meta.url), 'utf8')

    expect(script).toContain('async function resolvePythonArtifactPaths(repoRoot)')
    expect(script).not.toContain('async function resolveWheelPath(repoRoot)')
    expect(script).toContain('No Python release artifacts found in dist/. Run npm run check:py-build first.')
  })

  it('pins the packaged dashboard-login-copy contract check to the published login title', () => {
    const probe = buildPackageSmokeProbe()

    expect(probe).toContain(
      'contract_payload = client.get("/contracts/dashboard-login-copy.v1.json").json()',
    )
    expect(probe).toContain(
      'assert contract_payload["locales"]["en"]["title"] == "Clipulse Dashboard Login"',
    )
  })

  it('covers protected package-install auth negative paths and logout cleanup', () => {
    const probe = buildPackageSmokeProbe()

    expect(probe).toContain('protected = create_app(')
    expect(probe).toContain('wrong_login = protected_client.post("/dashboard-login", json={"token": "clipulse-smoke-dashboard-token-wrong"})')
    expect(probe).toContain('assert wrong_login.status_code == 401')
    expect(probe).toContain('write_attempt = protected_client.post("/api/v1/events/batch", json={"events": []})')
    expect(probe).toContain('assert write_attempt.status_code == 401')
    expect(probe).toContain('logout = protected_client.post("/dashboard-logout")')
    expect(probe).toContain('assert logout.status_code == 204')
    expect(probe).toContain('assert protected_client.get("/docs").status_code == 401')
  })

  it('covers packaged public-read negative states for disabled and misconfigured deployments', () => {
    const probe = buildPackageSmokeProbe()

    expect(probe).toContain('disabled_public = create_app(')
    expect(probe).toContain('assert disabled_public_client.get("/api/v1/public/readme/top-language").status_code == 401')
    expect(probe).toContain('assert disabled_public_client.get("/api/v1/badges/top-language.svg").status_code == 401')
    expect(probe).toContain('misconfigured_public = create_app(')
    expect(probe).toContain('raise AssertionError("Expected CLIPULSE_PUBLIC_BASE_URL validation to reject misconfigured public reads.")')
    expect(probe).toContain('except RuntimeError as exc:')
    expect(probe).toContain('assert "CLIPULSE_ENABLE_PUBLIC_READS=1 requires CLIPULSE_PUBLIC_BASE_URL" in str(exc)')
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
  it('skips the extra deployment smoke for a synthetic repo path that does not ship that script yet', () => {
    const syntheticRepoRoot = path.join('/tmp', 'clipulse-fixture-repo-without-deployment-smoke')

    expect(resolveDeploymentSmokeArgs(syntheticRepoRoot)).toBeNull()
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

describe('repo privacy guardrails', () => {
  it('ignores a repo-root Gemini settings directory without blocking the checked-in example wiring', () => {
    expect(ROOT_GITIGNORE).toContain('/.gemini/')
    expect(ROOT_GITIGNORE).toContain('!/packages/adapter-gemini/examples/.gemini/')
    expect(ROOT_GITIGNORE).toContain('!/packages/adapter-gemini/examples/.gemini/settings.json')
  })
})

describe('fixture documentation', () => {
  it('labels the checked-in Gemini lifecycle examples as synthetic fixtures', () => {
    expect(GEMINI_README).toContain('synthetic lifecycle fixtures')
    expect(GEMINI_README).toContain('not real user workspace settings')
  })

  it('labels the checked-in Claude transcript smoke fixtures as synthetic transcript fixtures', () => {
    expect(CLAUDE_README).toContain('synthetic transcript fixture')
    expect(CLAUDE_README).toContain('not a real user transcript')
  })

  it('keeps the Python package README explicit about package-only versus optional Node-side diagnostics', () => {
    expect(PACKAGE_README).toContain('The Python package does not install the Node-side collector CLI.')
    expect(PACKAGE_README).toContain('If you also install the stable Node tarballs, then these optional local diagnostics become available:')
    expect(PACKAGE_README).toContain('clipulse-collector-core doctor')
    expect(PACKAGE_README).toContain('clipulse-collector-core pending')
    expect(PACKAGE_README).toContain('node ./clipulse-adapter-codex-<version>/dist/cli.js')
    expect(PACKAGE_README).toContain('node ./clipulse-adapter-claude-<version>/dist/cli.js')
    expect(PACKAGE_README).not.toContain('node ./adapter-codex/dist/cli.js')
    expect(PACKAGE_README).not.toContain('node ./adapter-claude/dist/cli.js')
  })
})
