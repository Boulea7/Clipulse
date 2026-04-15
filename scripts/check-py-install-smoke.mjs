import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, readdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

function runCommand(command, args, options = {}) {
  execFileSync(command, args, {
    stdio: 'inherit',
    ...options,
  })
}

async function resolveWheelPath(repoRoot) {
  const distDir = path.join(repoRoot, 'dist')
  const distFiles = await readdir(distDir)
  const artifactPaths = selectReleaseArtifacts(
    distFiles,
    distDir,
    readCurrentReleaseVersion(repoRoot),
  )

  if (!artifactPaths.length) {
    throw new Error('No release artifacts found in dist/. Run npm run check:py-build first.')
  }

  return artifactPaths
}

function resolveVenvPython(venvDir) {
  return path.join(venvDir, 'bin', 'python')
}

function readCurrentReleaseVersion(repoRoot) {
  const pyprojectPath = path.join(repoRoot, 'pyproject.toml')
  const pyprojectBody = readFileSync(pyprojectPath, 'utf8')
  const match = pyprojectBody.match(/^version = "([^"]+)"$/m)
  if (!match?.[1]) {
    throw new Error('Could not determine the current release version from pyproject.toml')
  }

  return match[1]
}

export function selectReleaseArtifacts(fileNames, distDir, version) {
  const versionPrefix = version ? `clipulse_api-${version}` : null
  const wheelFiles = fileNames
    .filter((fileName) => fileName.endsWith('.whl'))
    .filter((fileName) => !versionPrefix || fileName.startsWith(versionPrefix))
    .sort()
  const sdistFiles = fileNames
    .filter((fileName) => fileName.endsWith('.tar.gz'))
    .filter((fileName) => !versionPrefix || fileName.startsWith(versionPrefix))
    .sort()

  const selectedFiles = []
  if (wheelFiles.length) {
    selectedFiles.push(wheelFiles[wheelFiles.length - 1])
  }
  if (sdistFiles.length) {
    selectedFiles.push(sdistFiles[sdistFiles.length - 1])
  }

  return selectedFiles.map((fileName) => path.join(distDir, fileName))
}

export function buildPackageSmokeProbe() {
  return [
    'from fastapi.testclient import TestClient',
    'from clipulse_api.app import create_app',
    'app = create_app("sqlite+pysqlite:///:memory:", allow_insecure_no_auth=True)',
    'client = TestClient(app)',
    'root = client.get("/")',
    'assert root.status_code == 200',
    'assert "Clipulse dashboard assets are not bundled" not in root.text',
    'assert "id=\\"overview\\"" in root.text',
    'assert "./static/styles.css" in root.text',
    'assert "./static/app.js" in root.text',
    'for path in ["/static/app.js", "/static/styles.css", "/static/dashboard.js", "/static/dom.js", "/static/formatters.js", "/static/routes.js", "/static/session-list-paths.js", "/static/view-models.js"]:',
    '    static = client.get(path)',
    '    assert static.status_code == 200, path',
    'app_js = client.get("/static/app.js")',
    'assert "bootstrapDashboard" in app_js.text',
    'for contract_path in ["/contracts/dashboard-compat.v1.json"]:',
    '    contract = client.get(contract_path)',
    '    assert contract.status_code == 200, contract_path',
    '    assert contract.json()["_meta"]["version"] == "v1"',
    'contract = client.get("/contracts/events-batch.v1.json")',
    'assert contract.status_code == 200, "/contracts/events-batch.v1.json"',
    'contract_payload = contract.json()',
    'assert contract_payload["_meta"]["version"] == "v1"',
    'assert contract_payload["event"]["project_root"]["pattern"] == "^[0-9a-f]{12}$"',
    'assert contract_payload["event"]["event_id"]["pattern"] == "^[0-9a-f]{64}$"',
    'assert contract_payload["event"]["privacy_mode"]["allowed"] == ["hashed"]',
  ].join('\n')
}

export function resolveDeploymentSmokeArgs(repoRoot) {
  const smokeScriptPath = path.join(repoRoot, 'scripts', 'smoke-deployment.mjs')
  if (!existsSync(smokeScriptPath)) {
    return null
  }

  return ['scripts/smoke-deployment.mjs']
}

async function waitForServer(baseUrl, timeoutMs = 15000) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/healthz`)
      if (response.status === 204) {
        return
      }
    } catch {
      // Keep polling until the server is ready.
    }

    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  throw new Error(`Timed out waiting for ${baseUrl}/healthz`)
}

function requireCookie(response, cookieName) {
  const setCookieHeader = response.headers.get('set-cookie') ?? ''
  const cookie = setCookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`))

  if (!cookie) {
    throw new Error(`Expected ${cookieName} cookie in response headers`)
  }

  return cookie
}

async function runFallbackDeploymentSmoke(baseUrl, dashboardToken) {
  const rootResponse = await fetch(`${baseUrl}/`)
  if (rootResponse.status !== 200) {
    throw new Error(`Expected GET / to return 200, got ${rootResponse.status}`)
  }

  const loginResponse = await fetch(`${baseUrl}/dashboard-login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ token: dashboardToken }),
  })
  if (loginResponse.status !== 204) {
    throw new Error(`Expected POST /dashboard-login to return 204, got ${loginResponse.status}`)
  }

  const dashboardCookie = requireCookie(loginResponse, 'clipulse_api_token')

  const authedRootResponse = await fetch(`${baseUrl}/`, {
    headers: {
      cookie: dashboardCookie,
    },
  })
  if (authedRootResponse.status !== 200) {
    throw new Error(`Expected authenticated GET / to return 200, got ${authedRootResponse.status}`)
  }

  const authedRootHtml = await authedRootResponse.text()
  if (!authedRootHtml.includes('./static/app.js')) {
    throw new Error('Expected authenticated dashboard shell to reference ./static/app.js')
  }

  const staticResponse = await fetch(`${baseUrl}/static/app.js`, {
    headers: {
      cookie: dashboardCookie,
    },
  })
  if (staticResponse.status !== 200) {
    throw new Error(`Expected GET /static/app.js to return 200, got ${staticResponse.status}`)
  }

  const staticText = await staticResponse.text()
  if (!staticText.includes('bootstrapDashboard')) {
    throw new Error('Expected bundled dashboard app.js to include bootstrapDashboard')
  }

  const contractResponse = await fetch(`${baseUrl}/contracts/dashboard-compat.v1.json`, {
    headers: {
      cookie: dashboardCookie,
    },
  })
  if (contractResponse.status !== 200) {
    throw new Error(
      `Expected GET /contracts/dashboard-compat.v1.json to return 200, got ${contractResponse.status}`,
    )
  }
}

async function main() {
  const repoRoot = path.resolve(new URL('..', import.meta.url).pathname)
  const artifactPaths = await resolveWheelPath(repoRoot)
  const hostPython = process.env.PYTHON ?? 'python3'

  for (const [artifactIndex, artifactPath] of artifactPaths.entries()) {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'clipulse-py-install-'))
    const venvDir = path.join(tempRoot, 'venv')
    const venvPython = resolveVenvPython(venvDir)
    const deploymentPort = 8765 + artifactIndex
    const deploymentBaseUrl = `http://127.0.0.1:${deploymentPort}`
    const deploymentEnv = {
      ...process.env,
      CLIPULSE_DATABASE_URL: `sqlite+pysqlite:///${path.join(tempRoot, 'clipulse.sqlite3')}`,
      CLIPULSE_ENABLE_PUBLIC_READS: '1',
      CLIPULSE_PUBLIC_BASE_URL: deploymentBaseUrl,
      CLIPULSE_DASHBOARD_TOKEN: 'clipulse-smoke-dashboard-token',
      CLIPULSE_API_BEARER_TOKEN: 'clipulse-smoke-api-token',
      CLIPULSE_SESSION_SECRET: 'clipulse-smoke-session-secret',
    }

    runCommand(hostPython, ['-m', 'venv', venvDir], { cwd: repoRoot })
    runCommand(venvPython, ['-m', 'pip', 'install', artifactPath, 'httpx>=0.28,<1'], { cwd: repoRoot })
    runCommand(
      venvPython,
      [
        '-c',
        buildPackageSmokeProbe(),
      ],
      { cwd: repoRoot },
    )

    const server = spawn(
      venvPython,
      ['-m', 'uvicorn', 'clipulse_api.app:create_app', '--factory', '--host', '127.0.0.1', '--port', String(deploymentPort)],
      {
        cwd: tempRoot,
        env: deploymentEnv,
        stdio: 'inherit',
      },
    )

    try {
      await waitForServer(deploymentBaseUrl)
      const deploymentSmokeArgs = resolveDeploymentSmokeArgs(repoRoot)
      if (deploymentSmokeArgs) {
        runCommand('node', deploymentSmokeArgs, {
          cwd: repoRoot,
          env: {
            ...process.env,
            CLIPULSE_BASE_URL: deploymentBaseUrl,
            CLIPULSE_EXPECT_PUBLIC_READS: '1',
            CLIPULSE_PUBLIC_BASE_URL: deploymentBaseUrl,
            CLIPULSE_DASHBOARD_TOKEN: deploymentEnv.CLIPULSE_DASHBOARD_TOKEN,
            CLIPULSE_API_BEARER_TOKEN: deploymentEnv.CLIPULSE_API_BEARER_TOKEN,
            CLIPULSE_PUBLIC_PROBE_URL: deploymentBaseUrl,
          },
        })
      } else {
        await runFallbackDeploymentSmoke(deploymentBaseUrl, deploymentEnv.CLIPULSE_DASHBOARD_TOKEN)
      }
    } finally {
      server.kill('SIGTERM')
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
