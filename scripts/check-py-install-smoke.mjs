import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
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
  const artifactPaths = selectReleaseArtifacts(distFiles, distDir)

  if (!artifactPaths.length) {
    throw new Error('No release artifacts found in dist/. Run npm run check:py-build first.')
  }

  return artifactPaths
}

function resolveVenvPython(venvDir) {
  return path.join(venvDir, 'bin', 'python')
}

export function selectReleaseArtifacts(fileNames, distDir) {
  const wheelFiles = fileNames.filter((fileName) => fileName.endsWith('.whl')).sort()
  const sdistFiles = fileNames.filter((fileName) => fileName.endsWith('.tar.gz')).sort()

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
    'app = create_app("sqlite+pysqlite:///:memory:")',
    'client = TestClient(app)',
    'root = client.get("/")',
    'assert root.status_code == 200',
    'assert "Clipulse dashboard assets are not bundled" not in root.text',
    'assert "id=\\"overview\\"" in root.text',
    'assert "./static/app.js" in root.text',
    'static = client.get("/static/app.js")',
    'assert static.status_code == 200',
    'assert "bootstrapDashboard" in static.text',
    'contract = client.get("/contracts/dashboard-compat.v1.json")',
    'assert contract.status_code == 200',
    'assert contract.json()["_meta"]["version"] == "v1"',
  ].join('; ')
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

async function runFallbackDeploymentSmoke(baseUrl, serverToken) {
  const rootResponse = await fetch(`${baseUrl}/`)
  if (rootResponse.status !== 200) {
    throw new Error(`Expected GET / to return 200, got ${rootResponse.status}`)
  }

  const loginResponse = await fetch(`${baseUrl}/dashboard-login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ token: serverToken }),
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

  for (const artifactPath of artifactPaths) {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'clipulse-py-install-'))
    const venvDir = path.join(tempRoot, 'venv')
    const venvPython = resolveVenvPython(venvDir)
    const deploymentPort = 8765
    const deploymentBaseUrl = `http://127.0.0.1:${deploymentPort}`
    const deploymentEnv = {
      ...process.env,
      CLIPULSE_DATABASE_URL: `sqlite+pysqlite:///${path.join(tempRoot, 'clipulse.sqlite3')}`,
      CLIPULSE_ENABLE_PUBLIC_READS: '1',
      CLIPULSE_PUBLIC_BASE_URL: deploymentBaseUrl,
      CLIPULSE_SERVER_TOKEN: 'clipulse-smoke-token',
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
            CLIPULSE_SERVER_TOKEN: 'clipulse-smoke-token',
          },
        })
      } else {
        await runFallbackDeploymentSmoke(deploymentBaseUrl, deploymentEnv.CLIPULSE_SERVER_TOKEN)
      }
    } finally {
      server.kill('SIGTERM')
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
