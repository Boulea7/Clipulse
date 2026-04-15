import { execFileSync, spawn } from 'node:child_process'
import { mkdtemp, readdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

function runCommand(command, args, options = {}) {
  execFileSync(command, args, {
    stdio: 'inherit',
    ...options,
  })
}

async function resolveWheelPath(repoRoot) {
  const distDir = path.join(repoRoot, 'dist')
  const wheelFiles = (await readdir(distDir))
    .filter((fileName) => fileName.endsWith('.whl'))
    .sort()

  if (!wheelFiles.length) {
    throw new Error('No wheel found in dist/. Run npm run check:py-build first.')
  }

  return path.join(distDir, wheelFiles[wheelFiles.length - 1] ?? '')
}

function resolveVenvPython(venvDir) {
  return path.join(venvDir, 'bin', 'python')
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

async function main() {
  const repoRoot = path.resolve(new URL('..', import.meta.url).pathname)
  const wheelPath = await resolveWheelPath(repoRoot)
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'clipulse-py-install-'))
  const venvDir = path.join(tempRoot, 'venv')
  const hostPython = process.env.PYTHON ?? 'python3'
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
  runCommand(venvPython, ['-m', 'pip', 'install', wheelPath, 'httpx>=0.28,<1'], { cwd: repoRoot })
  runCommand(
    venvPython,
    [
      '-c',
      [
        'from fastapi.testclient import TestClient',
        'from clipulse_api.app import create_app',
        'app = create_app("sqlite+pysqlite:///:memory:")',
        'client = TestClient(app)',
        'root = client.get("/")',
        'assert root.status_code == 200',
        'assert "Clipulse dashboard assets are not bundled" not in root.text',
        'assert "id=\\"logout-button\\"" in root.text',
        'static = client.get("/static/app.js")',
        'assert static.status_code == 200',
        'assert "bootstrapDashboard" in static.text',
        'contract = client.get("/contracts/dashboard-compat.v1.json")',
        'assert contract.status_code == 200',
        'assert contract.json()["_meta"]["version"] == "v1"',
      ].join('; '),
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
    runCommand(
      'node',
      ['scripts/smoke-deployment.mjs'],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          CLIPULSE_BASE_URL: deploymentBaseUrl,
          CLIPULSE_EXPECT_PUBLIC_READS: '1',
          CLIPULSE_PUBLIC_BASE_URL: deploymentBaseUrl,
          CLIPULSE_SERVER_TOKEN: 'clipulse-smoke-token',
        },
      },
    )
  } finally {
    server.kill('SIGTERM')
  }
}

await main()
