function trimTrailingSlash(value) {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

function parsePublicReadExpectation(env = process.env) {
  const explicitMode = (env.CLIPULSE_EXPECT_PUBLIC_READS_MODE ?? '').trim().toLowerCase()
  if (explicitMode === '') {
    return ['1', 'true', 'yes', 'on'].includes(
      (env.CLIPULSE_EXPECT_PUBLIC_READS ?? '').trim().toLowerCase(),
    )
      ? 'enabled'
      : null
  }

  if (
    explicitMode === 'enabled'
    || explicitMode === 'disabled'
    || explicitMode === 'misconfigured'
  ) {
    return explicitMode
  }

  throw new Error(
    'CLIPULSE_EXPECT_PUBLIC_READS_MODE must be one of: enabled, disabled, misconfigured.',
  )
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
    publicReadExpectation: parsePublicReadExpectation(env),
  }
}

function normalizeSetCookieHeaders(setCookieHeader) {
  if (Array.isArray(setCookieHeader)) {
    return setCookieHeader.filter(Boolean).map((value) => String(value))
  }
  if (!setCookieHeader) {
    return []
  }
  return [String(setCookieHeader)]
}

function getSetCookieHeaders(response) {
  if (typeof response.headers?.getSetCookie === 'function') {
    return normalizeSetCookieHeaders(response.headers.getSetCookie())
  }
  return normalizeSetCookieHeaders(response.headers?.get?.('set-cookie') ?? null)
}

const DASHBOARD_SESSION_COOKIE_NAMES = [
  '__Host-clipulse_dashboard_session',
  'clipulse_dashboard_session',
]

export function extractCookieHeader(setCookieHeader) {
  const cookiePairs = normalizeSetCookieHeaders(setCookieHeader)
    .flatMap((headerValue) => [...headerValue.matchAll(/(?:^|,\s*)([^=;,\s]+)=([^;,]*)/g)])
    .map((match) => ({
      name: match[1]?.trim() ?? '',
      value: (match[2] ?? '').replace(/^"|"$/g, ''),
    }))
    .filter((cookie) => cookie.name.length > 0)

  for (const preferredName of DASHBOARD_SESSION_COOKIE_NAMES) {
    const preferredCookie = cookiePairs.find((cookie) => cookie.name === preferredName && cookie.value.length > 0)
    if (preferredCookie) {
      return `${preferredCookie.name}=${preferredCookie.value}`
    }
  }

  return null
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

function createJsonHeaders(headers = {}) {
  return {
    'content-type': 'application/json',
    ...headers,
  }
}

function getExpectedCookiePath(baseUrl) {
  const pathname = new URL(baseUrl).pathname
  return pathname && pathname !== '/' ? pathname : '/'
}

function assertDashboardSessionCookie(setCookieHeader, baseUrl) {
  const setCookieHeaders = normalizeSetCookieHeaders(setCookieHeader)
  if (setCookieHeaders.length === 0) {
    throw new Error('/dashboard-login probe failed: missing Set-Cookie header')
  }

  const combinedHeader = setCookieHeaders.join(', ')
  const expectedPath = getExpectedCookiePath(baseUrl)
  if (!/httponly/i.test(combinedHeader)) {
    throw new Error('/dashboard-login probe failed: session cookie must be HttpOnly')
  }
  if (!new RegExp(`path=${expectedPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(combinedHeader)) {
    throw new Error(`/dashboard-login probe failed: session cookie must use Path=${expectedPath}`)
  }
  if (!/samesite=lax/i.test(combinedHeader)) {
    throw new Error('/dashboard-login probe failed: session cookie must use SameSite=Lax')
  }
  if (new URL(baseUrl).protocol === 'https:' && !/secure/i.test(combinedHeader)) {
    throw new Error('/dashboard-login probe failed: HTTPS deployments must set a Secure session cookie')
  }
}

export function assertDashboardLogoutCookie(setCookieHeader, baseUrl) {
  const setCookieHeaders = normalizeSetCookieHeaders(setCookieHeader)
  if (setCookieHeaders.length === 0) {
    throw new Error('/dashboard-logout probe failed: missing Set-Cookie header')
  }

  const expectedPath = getExpectedCookiePath(baseUrl)
  const hasClearingCookieForPath = (cookieName, cookiePath) => setCookieHeaders.some((header) => {
    const namePattern = new RegExp(`(?:^|,\\s*)${cookieName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=`, 'i')
    const pathPattern = new RegExp(`path=${cookiePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:;|,|$)`, 'i')
    return namePattern.test(header) && pathPattern.test(header) && /max-age=0/i.test(header)
  })

  if (!hasClearingCookieForPath('clipulse_dashboard_session', expectedPath)) {
    throw new Error(`/dashboard-logout probe failed: logout cookie must use Path=${expectedPath}`)
  }
  if (expectedPath !== '/' && !hasClearingCookieForPath('clipulse_dashboard_session', '/')) {
    throw new Error('/dashboard-logout probe failed: logout cookie must clear root dashboard session cookies')
  }
  if (!hasClearingCookieForPath('__Host-clipulse_dashboard_session', '/')) {
    throw new Error('/dashboard-logout probe failed: logout cookie must clear root __Host dashboard session cookies')
  }
}

export const DASHBOARD_STATIC_PROBE_PATHS = [
  '/static/app.js',
  '/static/styles.css',
  '/static/dashboard.js',
  '/static/i18n.js',
  '/static/dom.js',
  '/static/formatters.js',
  '/static/routes.js',
  '/static/session-list-paths.js',
  '/static/view-models.js',
]

export const DASHBOARD_CONTRACT_PROBE_PATHS = [
  '/contracts/dashboard-compat.v1.json',
  '/contracts/dashboard-login-copy.v1.json',
  '/contracts/events-batch.v1.json',
]

export const DASHBOARD_DOC_PROBE_PATHS = [
  '/docs',
  '/redoc',
  '/openapi.json',
]

export const PUBLIC_README_PROBE_PATHS = [
  '/api/v1/public/readme/top-language',
  '/api/v1/public/readme/today-time',
  '/api/v1/public/readme/this-week-time',
]

export const PUBLIC_BADGE_PROBE_PATHS = [
  '/api/v1/badges/top-language.svg',
  '/api/v1/badges/today-time.svg',
  '/api/v1/badges/this-week-time.svg',
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

async function assertStatusPayload(response, message) {
  await assertResponseOk(response, message)
  const payload = await response.json().catch(() => null)
  const metadataErrorCountsByState = payload?.spool?.metadata_error_counts_by_state
  const metadataCountsByStateValid = (
    metadataErrorCountsByState
    && typeof metadataErrorCountsByState === 'object'
    && ['ready', 'processing', 'quarantine'].every((state) => (
      metadataErrorCountsByState[state]
      && typeof metadataErrorCountsByState[state] === 'object'
      && typeof metadataErrorCountsByState[state].read_error === 'number'
      && typeof metadataErrorCountsByState[state].parse_error === 'number'
    ))
  )
  const lastAttemptedStateValid = (
    payload?.spool?.last_attempted_state === null
    || ['ready', 'processing', 'quarantine'].includes(payload?.spool?.last_attempted_state)
  )
  if (
    !payload
    || typeof payload !== 'object'
    || payload.api?.status !== 'ok'
    || typeof payload.api?.version !== 'string'
    || typeof payload.auth?.dashboard_auth_required !== 'boolean'
    || typeof payload.auth?.browser_session_enabled !== 'boolean'
    || typeof payload.auth?.browser_session_scope !== 'string'
    || typeof payload.db?.status !== 'string'
    || typeof payload.spool?.status !== 'string'
    || typeof payload.spool?.ready !== 'number'
    || typeof payload.spool?.processing !== 'number'
    || typeof payload.spool?.quarantine !== 'number'
    || typeof payload.spool?.oldest_backlog_age_seconds !== 'number'
    || typeof payload.spool?.oldest_ready_age_seconds !== 'number'
    || typeof payload.spool?.oldest_processing_age_seconds !== 'number'
    || typeof payload.spool?.oldest_quarantine_age_seconds !== 'number'
    || typeof payload.spool?.last_attempted_age_seconds !== 'number'
    || !lastAttemptedStateValid
    || !metadataCountsByStateValid
  ) {
    throw new Error(`${message}: invalid /api/v1/status JSON shape`)
  }
}

async function probePublicReadEndpoints({
  fetchImpl,
  publicProbeBaseUrl,
  publicReadExpectation,
  readmePublicBaseUrl,
}) {
  if (!publicReadExpectation) {
    return
  }

  if (publicReadExpectation === 'enabled') {
    for (const badgePath of PUBLIC_BADGE_PROBE_PATHS) {
      const badgeResponse = await fetchImpl(`${publicProbeBaseUrl}${badgePath}`)
      await assertResponseOk(badgeResponse, `public badge probe failed for ${badgePath}`)
    }

    for (const readmePath of PUBLIC_README_PROBE_PATHS) {
      const readmeResponse = await fetchImpl(`${publicProbeBaseUrl}${readmePath}`)
      await assertResponseOk(readmeResponse, `public README snippet probe failed for ${readmePath}`)
      const snippetPayload = await readmeResponse.json()
      if (snippetPayload.markdown?.includes(readmePublicBaseUrl) !== true) {
        throw new Error(`public README snippet probe failed for ${readmePath}: markdown does not contain the expected public base URL`)
      }
    }
    return
  }

  if (publicReadExpectation === 'misconfigured') {
    for (const badgePath of PUBLIC_BADGE_PROBE_PATHS) {
      await assertResponseOk(
        await fetchImpl(`${publicProbeBaseUrl}${badgePath}`),
        `public badge misconfigured probe failed for ${badgePath}`,
      )
    }
    for (const readmePath of PUBLIC_README_PROBE_PATHS) {
      await assertResponseStatus(
        await fetchImpl(`${publicProbeBaseUrl}${readmePath}`),
        503,
        `public README misconfigured probe failed for ${readmePath}`,
      )
    }
    return
  }

  for (const badgePath of PUBLIC_BADGE_PROBE_PATHS) {
    await assertResponseStatus(
      await fetchImpl(`${publicProbeBaseUrl}${badgePath}`),
      401,
      `public badge ${publicReadExpectation} probe failed for ${badgePath}`,
    )
  }
  for (const readmePath of PUBLIC_README_PROBE_PATHS) {
    await assertResponseStatus(
      await fetchImpl(`${publicProbeBaseUrl}${readmePath}`),
      401,
      `public README ${publicReadExpectation} probe failed for ${readmePath}`,
    )
  }
}

export async function runDeploymentSmoke({
  baseUrl,
  dashboardToken = null,
  apiBearerToken = null,
  publicBaseUrl = null,
  publicProbeUrl = null,
  expectPublicReads = false,
  publicReadExpectation = expectPublicReads ? 'enabled' : null,
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
    await assertStatusPayload(statusResponse, '/api/v1/status probe failed')
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
    for (const contractPath of DASHBOARD_CONTRACT_PROBE_PATHS) {
      await assertResponseOk(
        await fetchImpl(`${baseUrl}${contractPath}`, { headers: unauthenticatedDashboardHeaders }),
        `contract probe failed for ${contractPath}`,
      )
    }
    await probePublicReadEndpoints({
      fetchImpl,
      publicProbeBaseUrl,
      publicReadExpectation,
      readmePublicBaseUrl,
    })
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
  for (const contractPath of DASHBOARD_CONTRACT_PROBE_PATHS) {
    await assertResponseStatus(
      await fetchImpl(`${baseUrl}${contractPath}`, { headers: buildHeaders() }),
      401,
      `anonymous contract probe should be rejected for ${contractPath}`,
    )
  }
  for (const docPath of DASHBOARD_DOC_PROBE_PATHS) {
    await assertResponseStatus(
      await fetchImpl(`${baseUrl}${docPath}`, { headers: buildHeaders() }),
      401,
      `anonymous docs probe should be rejected for ${docPath}`,
    )
  }

  const statusResponse = await fetchImpl(
    `${baseUrl}/api/v1/status`,
    { headers: buildHeaders({ authorization }) },
  )
  await assertStatusPayload(statusResponse, '/api/v1/status probe failed')

  await assertResponseStatus(
    await fetchImpl(`${baseUrl}/dashboard-login`, {
      method: 'POST',
      headers: createJsonHeaders(),
      body: JSON.stringify({ token: `${dashboardToken}-wrong` }),
    }),
    401,
    'wrong dashboard token probe should be rejected',
  )

  const loginResponse = await fetchImpl(`${baseUrl}/dashboard-login`, {
    method: 'POST',
    headers: createJsonHeaders(),
    body: JSON.stringify({ token: dashboardToken }),
  })
  if (loginResponse.status !== 204) {
    const body = await loginResponse.text().catch(() => '')
    throw new Error(`/dashboard-login probe failed: status=${loginResponse.status} body=${body}`)
  }

  const loginSetCookieHeaders = getSetCookieHeaders(loginResponse)
  assertDashboardSessionCookie(loginSetCookieHeaders, baseUrl)
  cookie = extractCookieHeader(loginSetCookieHeaders)
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
  for (const contractPath of DASHBOARD_CONTRACT_PROBE_PATHS) {
    await assertResponseOk(
      await fetchImpl(`${baseUrl}${contractPath}`, { headers: buildHeaders({ cookie }) }),
      `contract probe failed for ${contractPath}`,
    )
  }
  for (const docPath of DASHBOARD_DOC_PROBE_PATHS) {
    await assertResponseOk(
      await fetchImpl(`${baseUrl}${docPath}`, { headers: buildHeaders({ cookie }) }),
      `dashboard docs probe failed for ${docPath}`,
    )
  }
  await assertStatusPayload(
    await fetchImpl(`${baseUrl}/api/v1/status`, { headers: buildHeaders({ cookie }) }),
    'dashboard status probe failed',
  )

  await assertResponseStatus(
    await fetchImpl(`${baseUrl}/api/v1/events/batch`, {
      method: 'POST',
      headers: createJsonHeaders(buildHeaders({ cookie })),
      body: JSON.stringify({ events: [] }),
    }),
    401,
    'dashboard cookie write probe should be rejected',
  )

  const logoutResponse = await fetchImpl(`${baseUrl}/dashboard-logout`, {
    method: 'POST',
    headers: buildHeaders({ cookie }),
  })
  await assertResponseStatus(logoutResponse, 204, 'dashboard logout probe failed')

  const logoutSetCookieHeaders = getSetCookieHeaders(logoutResponse)
  assertDashboardLogoutCookie(logoutSetCookieHeaders, baseUrl)
  for (const staticPath of DASHBOARD_STATIC_PROBE_PATHS) {
    await assertResponseStatus(
      await fetchImpl(`${baseUrl}${staticPath}`, { headers: buildHeaders({ cookie }) }),
      401,
      `dashboard logout must clear access to protected asset ${staticPath}`,
    )
  }
  for (const contractPath of DASHBOARD_CONTRACT_PROBE_PATHS) {
    await assertResponseStatus(
      await fetchImpl(`${baseUrl}${contractPath}`, { headers: buildHeaders({ cookie }) }),
      401,
      `dashboard logout must clear access to protected contract ${contractPath}`,
    )
  }
  for (const docPath of DASHBOARD_DOC_PROBE_PATHS) {
    await assertResponseStatus(
      await fetchImpl(`${baseUrl}${docPath}`, { headers: buildHeaders({ cookie }) }),
      401,
      `dashboard logout must clear access to protected docs ${docPath}`,
    )
  }
  await assertResponseStatus(
    await fetchImpl(`${baseUrl}/api/v1/status`, { headers: buildHeaders({ cookie }) }),
    401,
    'dashboard logout must clear access to protected status',
  )

  await probePublicReadEndpoints({
    fetchImpl,
    publicProbeBaseUrl,
    publicReadExpectation,
    readmePublicBaseUrl,
  })
}

export async function main(env = process.env) {
  await runDeploymentSmoke(parseDeploymentSmokeEnv(env))
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main()
}
