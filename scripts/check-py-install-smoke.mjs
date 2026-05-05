import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, readdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  DASHBOARD_CONTRACT_PROBE_PATHS,
  DASHBOARD_STATIC_PROBE_PATHS,
  runDeploymentSmoke,
} from './smoke-deployment.mjs'
import { resolveStableReleaseAssetEntries } from './release-assets.mjs'

const PACKAGE_SMOKE_HELPER_DEPENDENCIES = [
  'httpx==0.28.1',
]

function runCommand(command, args, options = {}) {
  execFileSync(command, args, {
    stdio: 'inherit',
    ...options,
  })
}

function toPythonListLiteral(values) {
  return `[${values.map((value) => JSON.stringify(value)).join(', ')}]`
}

async function resolvePythonArtifactPaths(repoRoot) {
  const distDir = path.join(repoRoot, 'dist')
  const distFiles = await readdir(distDir)
  const artifactPaths = selectReleaseArtifacts(
    distFiles,
    distDir,
    readCurrentReleaseVersion(repoRoot),
  )

  if (!artifactPaths.length) {
    throw new Error('No Python release artifacts found in dist/. Run npm run check:py-build first.')
  }

  return artifactPaths
}

function resolveVenvPython(venvDir) {
  return process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python')
}

function resolveConsoleScriptPath(venvDir, commandName) {
  // Python virtualenv console scripts live under Scripts/*.exe on Windows.
  return process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', `${commandName}.exe`)
    : path.join(venvDir, 'bin', commandName)
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
  const assetEntries = resolveStableReleaseAssetEntries(path.resolve(distDir, '..'), version)
  const availableFiles = new Set(fileNames)

  return assetEntries
    .filter((asset) => asset.kind === 'python-wheel' || asset.kind === 'python-sdist')
    .map((asset) => path.basename(asset.absolutePath))
    .filter((fileName) => availableFiles.has(fileName))
    .map((fileName) => path.join(distDir, fileName))
}

export function buildPackageSmokeProbe() {
  const staticProbePaths = toPythonListLiteral(DASHBOARD_STATIC_PROBE_PATHS)
  const contractProbePaths = toPythonListLiteral(
    DASHBOARD_CONTRACT_PROBE_PATHS.filter((contractPath) => contractPath !== '/contracts/events-batch.v1.json'),
  )

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
    `for path in ${staticProbePaths}:`,
    '    static = client.get(path)',
    '    assert static.status_code == 200, path',
    'app_js = client.get("/static/app.js")',
    'assert "bootstrapDashboard" in app_js.text',
    `for contract_path in ${contractProbePaths}:`,
    '    contract = client.get(contract_path)',
    '    assert contract.status_code == 200, contract_path',
    '    assert contract.json()["_meta"]["version"] == "v1"',
    'contract_payload = client.get("/contracts/dashboard-login-copy.v1.json").json()',
    'assert contract_payload["locales"]["en"]["title"] == "Clipulse Dashboard Login"',
    'contract = client.get("/contracts/events-batch.v1.json")',
    'assert contract.status_code == 200, "/contracts/events-batch.v1.json"',
    'contract_payload = contract.json()',
    'assert contract_payload["_meta"]["version"] == "v1"',
    'assert contract_payload["event"]["project_root"]["pattern"] == "^[0-9a-f]{12}$"',
    'assert contract_payload["event"]["event_id"]["pattern"] == "^[0-9a-f]{64}$"',
    'assert contract_payload["event"]["privacy_mode"]["allowed"] == ["hashed"]',
    'protected = create_app(',
    '    "sqlite+pysqlite:///:memory:",',
    '    dashboard_token="clipulse-smoke-dashboard-token",',
    '    api_bearer_token="clipulse-smoke-api-token",',
    '    session_secret="clipulse-smoke-session-secret",',
    ')',
    'protected_client = TestClient(protected)',
    'wrong_login = protected_client.post("/dashboard-login", json={"token": "clipulse-smoke-dashboard-token-wrong"})',
    'assert wrong_login.status_code == 401',
    'login = protected_client.post("/dashboard-login", json={"token": "clipulse-smoke-dashboard-token"})',
    'assert login.status_code == 204',
    'assert protected_client.get("/docs").status_code == 200',
    'write_attempt = protected_client.post("/api/v1/events/batch", json={"events": []})',
    'assert write_attempt.status_code == 401',
    'logout = protected_client.post("/dashboard-logout")',
    'assert logout.status_code == 204',
    'assert protected_client.get("/docs").status_code == 401',
    'disabled_public = create_app(',
    '    "sqlite+pysqlite:///:memory:",',
    '    server_token="clipulse-smoke-server-token",',
    '    enable_public_reads=False,',
    ')',
    'disabled_public_client = TestClient(disabled_public)',
    'assert disabled_public_client.get("/api/v1/public/readme/top-language").status_code == 401',
    'assert disabled_public_client.get("/api/v1/badges/top-language.svg").status_code == 401',
    'try:',
    '    misconfigured_public = create_app(',
    '        "sqlite+pysqlite:///:memory:",',
    '        server_token="clipulse-smoke-server-token",',
    '        enable_public_reads=True,',
    '        public_base_url="",',
    '    )',
    '    raise AssertionError("Expected CLIPULSE_PUBLIC_BASE_URL validation to reject misconfigured public reads.")',
    'except RuntimeError as exc:',
    '    assert "CLIPULSE_ENABLE_PUBLIC_READS=1 requires CLIPULSE_PUBLIC_BASE_URL" in str(exc)',
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
  const cookieNames = [
    cookieName,
    '__Host-clipulse_dashboard_session',
    'clipulse_dashboard_session',
  ]
  const cookieParts = setCookieHeader
    .split(';')
    .map((part) => part.trim())
  const matchedCookieName = cookieNames.find((name) => cookieParts.some((part) => part.startsWith(`${name}=`)))
  const cookie = matchedCookieName
    ? cookieParts.find((part) => part.startsWith(`${matchedCookieName}=`))
    : null

  if (!cookie) {
    throw new Error(`Expected one of ${cookieNames.join(', ')} cookies in response headers`)
  }

  return cookie
}

function collectNodeRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    request.on('end', () => resolve(Buffer.concat(chunks)))
    request.on('error', reject)
  })
}

function getSetCookieHeaders(headers) {
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie()
  }

  const value = headers.get('set-cookie')
  return value ? [value] : []
}

function rewriteCookiePath(setCookieValue, cookiePath) {
  if (!setCookieValue) {
    return setCookieValue
  }

  if (/;\s*path=/i.test(setCookieValue)) {
    return setCookieValue.replace(/;\s*path=([^;]+)/i, `; Path=${cookiePath}`)
  }

  return `${setCookieValue}; Path=${cookiePath}`
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Could not determine proxy address'))
        return
      }
      resolve(address)
    })
  })
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

export async function runProtectedSubpathDeploymentSmoke({
  upstreamBaseUrl,
  dashboardToken,
  apiBearerToken,
}) {
  const proxyPrefix = '/clipulse'
  const proxyServer = createServer(async (request, response) => {
    try {
      const incomingUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)
      if (!incomingUrl.pathname.startsWith(proxyPrefix)) {
        response.statusCode = 404
        response.end('Not Found')
        return
      }

      const upstreamPathname = incomingUrl.pathname.slice(proxyPrefix.length) || '/'
      const upstreamUrl = new URL(upstreamBaseUrl)
      upstreamUrl.pathname = upstreamPathname
      upstreamUrl.search = incomingUrl.search

      const requestHeaders = new Headers()
      for (const [headerName, headerValue] of Object.entries(request.headers)) {
        if (headerValue === undefined || headerName === 'host') {
          continue
        }
        if (Array.isArray(headerValue)) {
          requestHeaders.set(headerName, headerValue.join(', '))
        } else {
          requestHeaders.set(headerName, String(headerValue))
        }
      }
      requestHeaders.set('x-forwarded-for', '198.51.100.77, 127.0.0.1')
      requestHeaders.set('x-forwarded-proto', 'https')

      const body = await collectNodeRequestBody(request)
      const upstreamResponse = await fetch(upstreamUrl, {
        method: request.method,
        headers: requestHeaders,
        body: body.length > 0 ? body : undefined,
      })

      response.statusCode = upstreamResponse.status
      for (const [headerName, headerValue] of upstreamResponse.headers.entries()) {
        if (headerName.toLowerCase() === 'set-cookie') {
          continue
        }
        response.setHeader(headerName, headerValue)
      }

      const setCookieHeaders = getSetCookieHeaders(upstreamResponse.headers)
      if (setCookieHeaders.length > 0) {
        response.setHeader(
          'set-cookie',
          setCookieHeaders.map((value) => rewriteCookiePath(value, proxyPrefix)),
        )
      }

      const responseBody = Buffer.from(await upstreamResponse.arrayBuffer())
      response.end(responseBody)
    } catch (error) {
      response.statusCode = 502
      response.end(error instanceof Error ? error.message : 'Proxy error')
    }
  })

  const { port } = await listen(proxyServer)
  const syntheticBaseUrl = `https://clipulse.example${proxyPrefix}`
  const proxyBaseUrl = `http://127.0.0.1:${port}${proxyPrefix}`

  try {
    await runDeploymentSmoke({
      baseUrl: syntheticBaseUrl,
      dashboardToken,
      apiBearerToken,
      publicBaseUrl: upstreamBaseUrl,
      publicProbeUrl: syntheticBaseUrl,
      publicReadExpectation: 'enabled',
      fetchImpl: async (input, init) => {
        const requestedUrl = new URL(String(input))
        const proxiedUrl = new URL(proxyBaseUrl)
        proxiedUrl.pathname = requestedUrl.pathname
        proxiedUrl.search = requestedUrl.search
        return fetch(proxiedUrl, init)
      },
    })
  } finally {
    await closeServer(proxyServer)
  }
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

  const dashboardCookie = requireCookie(loginResponse, 'clipulse_dashboard_session')

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
  const artifactPaths = await resolvePythonArtifactPaths(repoRoot)

  for (const [artifactIndex, artifactPath] of artifactPaths.entries()) {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'clipulse-py-install-'))
    const venvDir = path.join(tempRoot, 'venv')
    const venvPython = resolveVenvPython(venvDir)
    const migrateCli = resolveConsoleScriptPath(venvDir, 'clipulse-migrate')
    const apiCli = resolveConsoleScriptPath(venvDir, 'clipulse-api')
    const deploymentPort = 8765 + artifactIndex
    const deploymentBaseUrl = `http://127.0.0.1:${deploymentPort}`
    const deploymentEnv = {
      ...process.env,
      CLIPULSE_DATABASE_URL: `sqlite+pysqlite:///${path.join(tempRoot, 'clipulse.sqlite3')}`,
      CLIPULSE_ENABLE_PUBLIC_READS: '1',
      CLIPULSE_PUBLIC_BASE_URL: deploymentBaseUrl,
      CLIPULSE_FORCE_SECURE_SESSION_COOKIE: '1',
      CLIPULSE_TRUSTED_PROXY_CIDRS: '127.0.0.1/32',
      CLIPULSE_DASHBOARD_TOKEN: 'clipulse-smoke-dashboard-token',
      CLIPULSE_API_BEARER_TOKEN: 'clipulse-smoke-api-token',
      CLIPULSE_SESSION_SECRET: 'clipulse-smoke-session-secret',
    }

    runCommand('uv', ['venv', venvDir], { cwd: repoRoot })
    runCommand('uv', ['pip', 'install', '--python', venvPython, artifactPath, ...PACKAGE_SMOKE_HELPER_DEPENDENCIES], {
      cwd: repoRoot,
    })
    runCommand(migrateCli, ['upgrade', deploymentEnv.CLIPULSE_DATABASE_URL], {
      cwd: tempRoot,
      env: deploymentEnv,
    })
    runCommand(
      venvPython,
      [
        '-c',
        buildPackageSmokeProbe(),
      ],
      { cwd: repoRoot },
    )

    const server = spawn(
      apiCli,
      [],
      {
        cwd: tempRoot,
        env: {
          ...deploymentEnv,
          CLIPULSE_API_HOST: '127.0.0.1',
          CLIPULSE_API_PORT: String(deploymentPort),
        },
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
        await runProtectedSubpathDeploymentSmoke({
          upstreamBaseUrl: deploymentBaseUrl,
          dashboardToken: deploymentEnv.CLIPULSE_DASHBOARD_TOKEN,
          apiBearerToken: deploymentEnv.CLIPULSE_API_BEARER_TOKEN,
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
