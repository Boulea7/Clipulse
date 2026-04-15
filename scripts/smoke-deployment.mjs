function trimTrailingSlash(value) {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

export function parseDeploymentSmokeEnv(env = process.env) {
  const baseUrl = trimTrailingSlash((env.CLIPULSE_BASE_URL ?? '').trim())
  if (!baseUrl) {
    throw new Error('CLIPULSE_BASE_URL is required')
  }

  const legacyServerToken = (env.CLIPULSE_SERVER_TOKEN ?? '').trim() || null
  const configuredDashboardToken = (env.CLIPULSE_DASHBOARD_TOKEN ?? '').trim() || null
  const configuredApiBearerToken = (env.CLIPULSE_API_BEARER_TOKEN ?? '').trim() || null
  const hasExplicitSplitAuth = Boolean(configuredDashboardToken || configuredApiBearerToken)

  if (hasExplicitSplitAuth && (!configuredDashboardToken || !configuredApiBearerToken)) {
    throw new Error(
      'Split auth deployment smoke requires both CLIPULSE_DASHBOARD_TOKEN and CLIPULSE_API_BEARER_TOKEN.',
    )
  }

  const dashboardToken = configuredDashboardToken || legacyServerToken
  const apiBearerToken = configuredApiBearerToken || legacyServerToken

  return {
    baseUrl,
    dashboardToken,
    apiBearerToken,
    publicBaseUrl: (env.CLIPULSE_PUBLIC_BASE_URL ?? '').trim() || null,
    publicProbeUrl: trimTrailingSlash((env.CLIPULSE_PUBLIC_PROBE_URL ?? '').trim()) || null,
    expectPublicReads: ['1', 'true', 'yes', 'on'].includes(
      (env.CLIPULSE_EXPECT_PUBLIC_READS ?? '').trim().toLowerCase(),
    ),
  }
}

export function extractCookieHeader(setCookieHeader) {
  if (!setCookieHeader) {
    return null
  }

  return String(setCookieHeader).split(';')[0]?.trim() || null
}

function buildHeaders({ authorization, cookie } = {}) {
  const headers = {}
  if (authorization) {
    headers.Authorization = authorization
  }
  if (cookie) {
    headers.Cookie = cookie
  }
  return headers
}

const DASHBOARD_STATIC_PROBE_PATHS = [
  '/static/app.js',
  '/static/styles.css',
  '/static/dashboard.js',
  '/static/dom.js',
  '/static/formatters.js',
  '/static/routes.js',
  '/static/session-list-paths.js',
  '/static/view-models.js',
]

async function assertResponseOk(response, message) {
  if (response.ok) {
    return response
  }

  const body = await response.text().catch(() => '')
  throw new Error(`${message}: status=${response.status} body=${body}`)
}

async function assertResponseStatus(response, expectedStatus, message) {
  if (response.status === expectedStatus) {
    return response
  }

  const body = await response.text().catch(() => '')
  throw new Error(`${message}: status=${response.status} expected=${expectedStatus} body=${body}`)
}

export async function runDeploymentSmoke({
  baseUrl,
  dashboardToken = null,
  apiBearerToken = null,
  publicBaseUrl = null,
  publicProbeUrl = null,
  expectPublicReads = false,
  fetchImpl = fetch,
}) {
  const authorization = apiBearerToken ? `Bearer ${apiBearerToken}` : null
  const readmePublicBaseUrl = publicBaseUrl ?? baseUrl
  const publicProbeBaseUrl = publicProbeUrl ?? baseUrl

  const healthz = await fetchImpl(`${baseUrl}/healthz`)
  if (healthz.status !== 204) {
    throw new Error(`/healthz probe failed: status=${healthz.status}`)
  }

  const unauthenticatedDashboardHeaders = buildHeaders({ authorization, cookie: null })
  if (!dashboardToken && !apiBearerToken) {
    const statusResponse = await fetchImpl(
      `${baseUrl}/api/v1/status`,
      { headers: unauthenticatedDashboardHeaders },
    )
    await assertResponseOk(statusResponse, '/api/v1/status probe failed')
    await assertResponseOk(
      await fetchImpl(`${baseUrl}/`, { headers: unauthenticatedDashboardHeaders }),
      'dashboard shell probe failed',
    )
    await assertResponseOk(
      await fetchImpl(`${baseUrl}${DASHBOARD_STATIC_PROBE_PATHS[0]}`, { headers: unauthenticatedDashboardHeaders }),
      'dashboard static asset probe failed',
    )
    for (const staticPath of DASHBOARD_STATIC_PROBE_PATHS.slice(1)) {
      await assertResponseOk(
        await fetchImpl(`${baseUrl}${staticPath}`, { headers: unauthenticatedDashboardHeaders }),
        `dashboard asset probe failed for ${staticPath}`,
      )
    }
    await assertResponseOk(
      await fetchImpl(
        `${baseUrl}/contracts/dashboard-compat.v1.json`,
        { headers: unauthenticatedDashboardHeaders },
      ),
      'dashboard compat contract probe failed',
    )
    await assertResponseOk(
      await fetchImpl(
        `${baseUrl}/contracts/events-batch.v1.json`,
        { headers: unauthenticatedDashboardHeaders },
      ),
      'events batch contract probe failed',
    )
    if (expectPublicReads) {
      const badgeResponse = await fetchImpl(`${publicProbeBaseUrl}/api/v1/badges/top-language.svg`)
      await assertResponseOk(badgeResponse, 'public badge probe failed')
      const readmeResponse = await fetchImpl(`${publicProbeBaseUrl}/api/v1/public/readme/top-language`)
      await assertResponseOk(readmeResponse, 'public README snippet probe failed')
      const snippetPayload = await readmeResponse.json()
      if (snippetPayload.markdown?.includes(readmePublicBaseUrl) !== true) {
        throw new Error('public README snippet probe failed: markdown does not contain the expected public base URL')
      }
    }
    return
  }

  let cookie = null
  await assertResponseStatus(
    await fetchImpl(`${baseUrl}/api/v1/status`, { headers: buildHeaders() }),
    401,
    'anonymous status probe should be rejected',
  )
  const loginPage = await fetchImpl(`${baseUrl}/`, { headers: buildHeaders() })
  await assertResponseOk(loginPage, 'anonymous dashboard shell probe failed')
  const loginPageBody = await loginPage.text()
  if (!loginPageBody.includes('Protected Clipulse dashboard')) {
    throw new Error('anonymous dashboard shell probe failed: expected protected login page copy')
  }
  for (const staticPath of DASHBOARD_STATIC_PROBE_PATHS) {
    await assertResponseStatus(
      await fetchImpl(`${baseUrl}${staticPath}`, { headers: buildHeaders() }),
      401,
      `anonymous dashboard asset probe should be rejected for ${staticPath}`,
    )
  }
  await assertResponseStatus(
    await fetchImpl(`${baseUrl}/contracts/dashboard-compat.v1.json`, { headers: buildHeaders() }),
    401,
    'anonymous dashboard compat contract probe should be rejected',
  )
  await assertResponseStatus(
    await fetchImpl(`${baseUrl}/contracts/events-batch.v1.json`, { headers: buildHeaders() }),
    401,
    'anonymous events batch contract probe should be rejected',
  )
  await assertResponseStatus(
    await fetchImpl(`${baseUrl}/docs`, { headers: buildHeaders() }),
    401,
    'anonymous docs probe should be rejected',
  )
  await assertResponseStatus(
    await fetchImpl(`${baseUrl}/openapi.json`, { headers: buildHeaders() }),
    401,
    'anonymous openapi probe should be rejected',
  )

  const statusResponse = await fetchImpl(
    `${baseUrl}/api/v1/status`,
    { headers: buildHeaders({ authorization }) },
  )
  await assertResponseOk(statusResponse, '/api/v1/status probe failed')

  const loginResponse = await fetchImpl(`${baseUrl}/dashboard-login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ token: dashboardToken }),
  })
  if (loginResponse.status !== 204) {
    const body = await loginResponse.text().catch(() => '')
    throw new Error(`/dashboard-login probe failed: status=${loginResponse.status} body=${body}`)
  }

  cookie = extractCookieHeader(loginResponse.headers.get('set-cookie'))
  if (!cookie) {
    throw new Error('/dashboard-login probe failed: missing dashboard session cookie')
  }

  await assertResponseOk(
    await fetchImpl(`${baseUrl}/`, { headers: buildHeaders({ cookie }) }),
    'dashboard shell probe failed',
  )
  for (const staticPath of DASHBOARD_STATIC_PROBE_PATHS) {
    await assertResponseOk(
      await fetchImpl(`${baseUrl}${staticPath}`, { headers: buildHeaders({ cookie }) }),
      `dashboard asset probe failed for ${staticPath}`,
    )
  }
  await assertResponseOk(
    await fetchImpl(`${baseUrl}/contracts/dashboard-compat.v1.json`, { headers: buildHeaders({ cookie }) }),
    'dashboard compat contract probe failed',
  )
  await assertResponseOk(
    await fetchImpl(`${baseUrl}/contracts/events-batch.v1.json`, { headers: buildHeaders({ cookie }) }),
    'events batch contract probe failed',
  )
  await assertResponseOk(
    await fetchImpl(`${baseUrl}/docs`, { headers: buildHeaders({ cookie }) }),
    'dashboard docs probe failed',
  )
  await assertResponseOk(
    await fetchImpl(`${baseUrl}/openapi.json`, { headers: buildHeaders({ cookie }) }),
    'dashboard openapi probe failed',
  )

  if (expectPublicReads) {
    const badgeResponse = await fetchImpl(`${publicProbeBaseUrl}/api/v1/badges/top-language.svg`)
    await assertResponseOk(badgeResponse, 'public badge probe failed')

    const readmeResponse = await fetchImpl(`${publicProbeBaseUrl}/api/v1/public/readme/top-language`)
    await assertResponseOk(readmeResponse, 'public README snippet probe failed')
    const snippetPayload = await readmeResponse.json()
    if (snippetPayload.markdown?.includes(readmePublicBaseUrl) !== true) {
      throw new Error('public README snippet probe failed: markdown does not contain the expected public base URL')
    }
  }
}

export async function main(env = process.env) {
  await runDeploymentSmoke(parseDeploymentSmokeEnv(env))
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main()
}
