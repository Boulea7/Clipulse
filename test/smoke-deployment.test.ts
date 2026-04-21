import { describe, expect, it } from 'vitest'

import {
  DASHBOARD_CONTRACT_PROBE_PATHS,
  DASHBOARD_STATIC_PROBE_PATHS,
  PUBLIC_BADGE_PROBE_PATHS,
  PUBLIC_README_PROBE_PATHS,
  extractCookieHeader,
  parseDeploymentSmokeEnv,
  runDeploymentSmoke,
} from '../scripts/smoke-deployment.mjs'

function toAbsoluteProbeUrls(baseUrl: string, paths: string[]): string[] {
  return paths.map((path) => `${baseUrl}${path}`)
}

function matchesProbePath(url: string, paths: string[]): boolean {
  return paths.some((suffix) => url.endsWith(suffix))
}

describe('deployment smoke env parsing', () => {
  it('normalizes trailing slashes and optional auth/public flags', () => {
    expect(parseDeploymentSmokeEnv({
      CLIPULSE_BASE_URL: 'https://clipulse.example/root/',
      CLIPULSE_DASHBOARD_TOKEN: 'dashboard-token',
      CLIPULSE_API_BEARER_TOKEN: 'api-token',
      CLIPULSE_PUBLIC_BASE_URL: 'https://public.example',
      CLIPULSE_PUBLIC_PROBE_URL: 'https://public-probe.example/root/',
      CLIPULSE_EXPECT_PUBLIC_READS: 'true',
    })).toEqual({
      baseUrl: 'https://clipulse.example/root',
      dashboardToken: 'dashboard-token',
      apiBearerToken: 'api-token',
      publicBaseUrl: 'https://public.example',
      publicProbeUrl: 'https://public-probe.example/root',
      publicReadExpectation: 'enabled',
    })
  })

  it('falls back to the legacy single token when split auth env vars are unset', () => {
    expect(parseDeploymentSmokeEnv({
      CLIPULSE_BASE_URL: 'https://clipulse.example',
      CLIPULSE_SERVER_TOKEN: 'legacy-token',
    })).toEqual({
      baseUrl: 'https://clipulse.example',
      dashboardToken: 'legacy-token',
      apiBearerToken: 'legacy-token',
      publicBaseUrl: null,
      publicProbeUrl: null,
      publicReadExpectation: null,
    })
  })

  it('fails fast when split auth env is only partially configured', () => {
    expect(() => parseDeploymentSmokeEnv({
      CLIPULSE_BASE_URL: 'https://clipulse.example',
      CLIPULSE_DASHBOARD_TOKEN: 'dashboard-token',
    })).toThrow('CLIPULSE_DASHBOARD_TOKEN and CLIPULSE_API_BEARER_TOKEN')
  })

  it('supports explicit public failure expectations for deployment probes', () => {
    expect(parseDeploymentSmokeEnv({
      CLIPULSE_BASE_URL: 'https://clipulse.example',
      CLIPULSE_EXPECT_PUBLIC_READS_MODE: 'misconfigured',
    })).toEqual({
      baseUrl: 'https://clipulse.example',
      dashboardToken: null,
      apiBearerToken: null,
      publicBaseUrl: null,
      publicProbeUrl: null,
      publicReadExpectation: 'misconfigured',
    })
  })
})

describe('deployment smoke helpers', () => {
  it('extracts the first cookie pair from a Set-Cookie header', () => {
    expect(extractCookieHeader('clipulse_api_token=signed; HttpOnly; Path=/')).toBe(
      'clipulse_api_token=signed',
    )
  })

  it('prefers the non-empty dashboard session cookie when legacy cleanup cookies share the same header', () => {
    expect(
      extractCookieHeader(
        'clipulse_api_token=; Max-Age=0; Path=/, clipulse_dashboard_session=signed; HttpOnly; Path=/; SameSite=Lax',
      ),
    ).toBe('clipulse_dashboard_session=signed')
  })
})

describe('deployment smoke runner', () => {
  it('probes protected deployments in the expected order and reuses the login cookie', async () => {
    const calls: Array<{ url: string, method: string, headers: Record<string, string> }> = []
    let loggedOut = false

    await runDeploymentSmoke({
      baseUrl: 'https://clipulse.example/root',
      dashboardToken: 'dashboard-token',
      apiBearerToken: 'api-token',
      fetchImpl: async (input, init) => {
        const url = String(input)
        const method = init?.method ?? 'GET'
        const headers = Object.fromEntries(
          Object.entries(init?.headers ?? {}).map(([key, value]) => [key, String(value)]),
        )
        calls.push({ url, method, headers })

        if (url.endsWith('/healthz')) {
          return new Response(null, { status: 204 })
        }

        if (url.endsWith('/api/v1/status')) {
          if (headers.Cookie) {
            expect(headers.Cookie).toBe('clipulse_api_token=signed')
            expect(headers.Authorization).toBeUndefined()
            return Response.json({ api: { status: 'ok', version: '0.1.0' } }, { status: 200 })
          }
          if (!headers.Authorization) {
            return Response.json({
              detail: {
                code: 'authentication_required',
              },
            }, { status: 401 })
          }
          expect(headers.Authorization).toBe('Bearer api-token')
          return Response.json({ api: { status: 'ok', version: '0.1.0' } }, { status: 200 })
        }

        if (url.endsWith('/docs')) {
          if (!headers.Cookie || loggedOut) {
            return Response.json({ detail: { code: 'authentication_required' } }, { status: 401 })
          }
          expect(headers.Cookie).toBe('clipulse_api_token=signed')
          expect(headers.Authorization).toBeUndefined()
          return new Response('<html>docs</html>', { status: 200 })
        }

        if (url.endsWith('/openapi.json')) {
          if (!headers.Cookie || loggedOut) {
            return Response.json({ detail: { code: 'authentication_required' } }, { status: 401 })
          }
          expect(headers.Cookie).toBe('clipulse_api_token=signed')
          expect(headers.Authorization).toBeUndefined()
          return Response.json({ openapi: '3.1.0' }, { status: 200 })
        }

        if (url.endsWith('/dashboard-login')) {
          expect(method).toBe('POST')
          expect(headers['content-type']).toBe('application/json')
          if (init?.body === JSON.stringify({ token: 'dashboard-token-wrong' })) {
            return Response.json({ detail: { code: 'dashboard_authentication_failed' } }, { status: 401 })
          }
          expect(init?.body).toBe(JSON.stringify({ token: 'dashboard-token' }))
          return new Response(null, {
            status: 204,
            headers: { 'set-cookie': 'clipulse_api_token=signed; HttpOnly; Path=/root; SameSite=Lax; Secure' },
          })
        }

        if (url.endsWith('/dashboard-logout')) {
          expect(method).toBe('POST')
          expect(headers.Cookie).toBe('clipulse_api_token=signed')
          expect(headers.Authorization).toBeUndefined()
          loggedOut = true
          return new Response(null, {
            status: 204,
            headers: { 'set-cookie': 'clipulse_api_token=; Max-Age=0; Path=/root; SameSite=Lax' },
          })
        }

        if (url.endsWith('/api/v1/events/batch')) {
          expect(method).toBe('POST')
          expect(headers.Cookie).toBe('clipulse_api_token=signed')
          expect(headers.Authorization).toBeUndefined()
          expect(headers['content-type']).toBe('application/json')
          expect(init?.body).toBe(JSON.stringify({ events: [] }))
          return Response.json({ detail: { code: 'authentication_required' } }, { status: 401 })
        }

        if (url.endsWith('/')) {
          if (!headers.Cookie) {
            return new Response('<html><h1>Protected Clipulse dashboard</h1></html>', { status: 200 })
          }
          expect(headers.Cookie).toBe('clipulse_api_token=signed')
          expect(headers.Authorization).toBeUndefined()
          return new Response('<html></html>', { status: 200 })
        }

        if (matchesProbePath(url, DASHBOARD_STATIC_PROBE_PATHS)) {
          if (!headers.Cookie) {
            return Response.json({ detail: { code: 'authentication_required' } }, { status: 401 })
          }
          expect(headers.Cookie).toBe('clipulse_api_token=signed')
          expect(headers.Authorization).toBeUndefined()
          return new Response(url.endsWith('.css') ? '.page{}' : 'export {}', { status: 200 })
        }

        if (matchesProbePath(url, DASHBOARD_CONTRACT_PROBE_PATHS)) {
          if (!headers.Cookie) {
            return Response.json({ detail: { code: 'authentication_required' } }, { status: 401 })
          }
          expect(headers.Cookie).toBe('clipulse_api_token=signed')
          expect(headers.Authorization).toBeUndefined()
          if (url.endsWith('/contracts/dashboard-login-copy.v1.json')) {
            return Response.json({ _meta: { version: 'v1' }, locales: { en: { title: 'Clipulse Dashboard Login' } } }, { status: 200 })
          }
          return Response.json({ _meta: { version: 'v1' } }, { status: 200 })
        }

        throw new Error(`unexpected request: ${url}`)
      },
    })

    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'GET https://clipulse.example/root/healthz',
      'GET https://clipulse.example/root/api/v1/status',
      'GET https://clipulse.example/root/',
      ...toAbsoluteProbeUrls('https://clipulse.example/root', DASHBOARD_STATIC_PROBE_PATHS).map((url) => `GET ${url}`),
      ...toAbsoluteProbeUrls('https://clipulse.example/root', DASHBOARD_CONTRACT_PROBE_PATHS).map((url) => `GET ${url}`),
      'GET https://clipulse.example/root/docs',
      'GET https://clipulse.example/root/openapi.json',
      'GET https://clipulse.example/root/api/v1/status',
      'POST https://clipulse.example/root/dashboard-login',
      'POST https://clipulse.example/root/dashboard-login',
      'GET https://clipulse.example/root/',
      ...toAbsoluteProbeUrls('https://clipulse.example/root', DASHBOARD_STATIC_PROBE_PATHS).map((url) => `GET ${url}`),
      ...toAbsoluteProbeUrls('https://clipulse.example/root', DASHBOARD_CONTRACT_PROBE_PATHS).map((url) => `GET ${url}`),
      'GET https://clipulse.example/root/docs',
      'GET https://clipulse.example/root/openapi.json',
      'GET https://clipulse.example/root/api/v1/status',
      'POST https://clipulse.example/root/api/v1/events/batch',
      'POST https://clipulse.example/root/dashboard-logout',
      'GET https://clipulse.example/root/docs',
    ])
  })

  it('probes optional public routes when explicitly enabled', async () => {
    const seenUrls: string[] = []

    await runDeploymentSmoke({
      baseUrl: 'https://clipulse.example',
      publicBaseUrl: 'https://public.example/clipulse',
      publicProbeUrl: 'https://public-probe.example/root',
      publicReadExpectation: 'enabled',
      fetchImpl: async (input) => {
        const url = String(input)
        seenUrls.push(url)

        if (url.endsWith('/healthz')) {
          return new Response(null, { status: 204 })
        }
        if (url.endsWith('/api/v1/status')) {
          return Response.json({ api: { status: 'ok', version: '0.1.0' } }, { status: 200 })
        }
        if (url.endsWith('/')) {
          return new Response('<html></html>', { status: 200 })
        }
        if (matchesProbePath(url, DASHBOARD_STATIC_PROBE_PATHS)) {
          return new Response(url.endsWith('.css') ? '.page{}' : 'export {}', { status: 200 })
        }
        if (matchesProbePath(url, DASHBOARD_CONTRACT_PROBE_PATHS)) {
          if (url.endsWith('/contracts/dashboard-login-copy.v1.json')) {
            return Response.json({ _meta: { version: 'v1' }, locales: { en: { title: 'Clipulse Dashboard Login' } } }, { status: 200 })
          }
          return Response.json({ _meta: { version: 'v1' } }, { status: 200 })
        }
        if (url === 'https://public-probe.example/root/api/v1/public/readme/top-language') {
          return Response.json({
            markdown: '![Clipulse Top Language](https://public.example/clipulse/api/v1/badges/top-language.svg)',
          }, { status: 200 })
        }
        if (url === 'https://public-probe.example/root/api/v1/public/readme/today-time') {
          return Response.json({
            markdown: '![Clipulse Today Time](https://public.example/clipulse/api/v1/badges/today-time.svg)',
          }, { status: 200 })
        }
        if (url === 'https://public-probe.example/root/api/v1/public/readme/this-week-time') {
          return Response.json({
            markdown: '![Clipulse This Week Time](https://public.example/clipulse/api/v1/badges/this-week-time.svg)',
          }, { status: 200 })
        }
        if (url === 'https://public-probe.example/root/api/v1/badges/top-language.svg') {
          return new Response('<svg></svg>', { status: 200 })
        }
        if (url === 'https://public-probe.example/root/api/v1/badges/today-time.svg') {
          return new Response('<svg></svg>', { status: 200 })
        }
        if (url === 'https://public-probe.example/root/api/v1/badges/this-week-time.svg') {
          return new Response('<svg></svg>', { status: 200 })
        }

        throw new Error(`unexpected request: ${url}`)
      },
    })

    for (const path of PUBLIC_README_PROBE_PATHS) {
      expect(seenUrls).toContain(`https://public-probe.example/root${path}`)
    }
    for (const path of PUBLIC_BADGE_PROBE_PATHS) {
      expect(seenUrls).toContain(`https://public-probe.example/root${path}`)
    }
    expect(seenUrls).toContain('https://clipulse.example/')
    for (const url of toAbsoluteProbeUrls('https://clipulse.example', DASHBOARD_STATIC_PROBE_PATHS)) {
      expect(seenUrls).toContain(url)
    }
    for (const url of toAbsoluteProbeUrls('https://clipulse.example', DASHBOARD_CONTRACT_PROBE_PATHS)) {
      expect(seenUrls).toContain(url)
    }
  })

  it('rejects wrong dashboard tokens, blocks cookie writes, and revokes dashboard access after logout', async () => {
    const calls: Array<{ url: string, method: string, headers: Record<string, string> }> = []
    let loggedOut = false

    await runDeploymentSmoke({
      baseUrl: 'https://clipulse.example/root',
      dashboardToken: 'dashboard-token',
      apiBearerToken: 'api-token',
      fetchImpl: async (input, init) => {
        const url = String(input)
        const method = init?.method ?? 'GET'
        const headers = Object.fromEntries(
          Object.entries(init?.headers ?? {}).map(([key, value]) => [key, String(value)]),
        )
        calls.push({ url, method, headers })

        if (url.endsWith('/healthz')) {
          return new Response(null, { status: 204 })
        }

        if (url.endsWith('/api/v1/status')) {
          if (headers.Cookie) {
            expect(headers.Cookie).toBe('clipulse_api_token=signed')
            expect(headers.Authorization).toBeUndefined()
            return Response.json({ api: { status: 'ok', version: '0.1.0' } }, { status: 200 })
          }
          if (!headers.Authorization) {
            return Response.json({ detail: { code: 'authentication_required' } }, { status: 401 })
          }
          expect(headers.Authorization).toBe('Bearer api-token')
          return Response.json({ api: { status: 'ok', version: '0.1.0' } }, { status: 200 })
        }

        if (url.endsWith('/dashboard-login')) {
          expect(method).toBe('POST')
          expect(headers['content-type']).toBe('application/json')
          if (init?.body === JSON.stringify({ token: 'dashboard-token-wrong' })) {
            return Response.json({ detail: { code: 'dashboard_authentication_failed' } }, { status: 401 })
          }
          expect(init?.body).toBe(JSON.stringify({ token: 'dashboard-token' }))
          return new Response(null, {
            status: 204,
            headers: { 'set-cookie': 'clipulse_api_token=signed; HttpOnly; Path=/root; SameSite=Lax; Secure' },
          })
        }

        if (url.endsWith('/dashboard-logout')) {
          expect(method).toBe('POST')
          expect(headers.Cookie).toBe('clipulse_api_token=signed')
          expect(headers.Authorization).toBeUndefined()
          loggedOut = true
          return new Response(null, {
            status: 204,
            headers: { 'set-cookie': 'clipulse_api_token=; Max-Age=0; Path=/root; SameSite=Lax' },
          })
        }

        if (url.endsWith('/api/v1/events/batch')) {
          expect(method).toBe('POST')
          expect(headers.Cookie).toBe('clipulse_api_token=signed')
          expect(init?.body).toBe(JSON.stringify({ events: [] }))
          return Response.json({ detail: { code: 'authentication_required' } }, { status: 401 })
        }

        if (url.endsWith('/docs') || url.endsWith('/openapi.json')) {
          if (!headers.Cookie || loggedOut) {
            return Response.json({ detail: { code: 'authentication_required' } }, { status: 401 })
          }
          expect(headers.Cookie).toBe('clipulse_api_token=signed')
          expect(headers.Authorization).toBeUndefined()
          return url.endsWith('/docs')
            ? new Response('<html>docs</html>', { status: 200 })
            : Response.json({ openapi: '3.1.0' }, { status: 200 })
        }

        if (url.endsWith('/')) {
          if (!headers.Cookie) {
            return new Response('<html><h1>Protected Clipulse dashboard</h1></html>', { status: 200 })
          }
          if (loggedOut) {
            return new Response('<html><h1>Protected Clipulse dashboard</h1></html>', { status: 200 })
          }
          expect(headers.Cookie).toBe('clipulse_api_token=signed')
          expect(headers.Authorization).toBeUndefined()
          return new Response('<html></html>', { status: 200 })
        }

        if (matchesProbePath(url, DASHBOARD_STATIC_PROBE_PATHS)) {
          if (!headers.Cookie || loggedOut) {
            return Response.json({ detail: { code: 'authentication_required' } }, { status: 401 })
          }
          expect(headers.Cookie).toBe('clipulse_api_token=signed')
          expect(headers.Authorization).toBeUndefined()
          return new Response(url.endsWith('.css') ? '.page{}' : 'export {}', { status: 200 })
        }

        if (matchesProbePath(url, DASHBOARD_CONTRACT_PROBE_PATHS)) {
          if (!headers.Cookie || loggedOut) {
            return Response.json({ detail: { code: 'authentication_required' } }, { status: 401 })
          }
          expect(headers.Cookie).toBe('clipulse_api_token=signed')
          expect(headers.Authorization).toBeUndefined()
          return Response.json({ _meta: { version: 'v1' } }, { status: 200 })
        }

        throw new Error(`unexpected request: ${url}`)
      },
    })

    expect(calls.map((call) => `${call.method} ${call.url}`)).toContain(
      'POST https://clipulse.example/root/api/v1/events/batch',
    )
    expect(calls.map((call) => `${call.method} ${call.url}`)).toContain(
      'POST https://clipulse.example/root/dashboard-logout',
    )
    expect(calls.filter((call) => call.url.endsWith('/dashboard-login'))).toHaveLength(2)
    expect(calls.filter((call) => call.url.endsWith('/docs'))).toHaveLength(3)
  })

  it.each([
    {
      expectation: 'disabled',
      expectedBadgeStatus: 401,
      expectedReadmeStatus: 401,
    },
    {
      expectation: 'misconfigured',
      expectedBadgeStatus: 200,
      expectedReadmeStatus: 503,
    },
  ])('treats public %s deployments as explicit negative probes', async ({
    expectation,
    expectedBadgeStatus,
    expectedReadmeStatus,
  }) => {
    const seenUrls: string[] = []

    await runDeploymentSmoke({
      baseUrl: 'https://clipulse.example',
      publicReadExpectation: expectation as 'disabled' | 'misconfigured',
      fetchImpl: async (input) => {
        const url = String(input)
        seenUrls.push(url)

        if (url.endsWith('/healthz')) {
          return new Response(null, { status: 204 })
        }
        if (url.endsWith('/api/v1/status')) {
          return Response.json({ api: { status: 'ok', version: '0.1.0' } }, { status: 200 })
        }
        if (url.endsWith('/')) {
          return new Response('<html></html>', { status: 200 })
        }
        if (matchesProbePath(url, DASHBOARD_STATIC_PROBE_PATHS)) {
          return new Response(url.endsWith('.css') ? '.page{}' : 'export {}', { status: 200 })
        }
        if (matchesProbePath(url, DASHBOARD_CONTRACT_PROBE_PATHS)) {
          return Response.json({ _meta: { version: 'v1' } }, { status: 200 })
        }
        if (matchesProbePath(url, PUBLIC_README_PROBE_PATHS)) {
          return Response.json({ detail: { code: 'public_probe_negative_path' } }, { status: expectedReadmeStatus })
        }
        if (matchesProbePath(url, PUBLIC_BADGE_PROBE_PATHS)) {
          return new Response('<svg></svg>', { status: expectedBadgeStatus })
        }

        throw new Error(`unexpected request: ${url}`)
      },
    })

    for (const path of PUBLIC_README_PROBE_PATHS) {
      expect(seenUrls).toContain(`https://clipulse.example${path}`)
    }
    for (const path of PUBLIC_BADGE_PROBE_PATHS) {
      expect(seenUrls).toContain(`https://clipulse.example${path}`)
    }
  })

  it('still probes dashboard shell assets on unprotected deployments', async () => {
    const seenUrls: string[] = []

    await runDeploymentSmoke({
      baseUrl: 'https://clipulse.example',
      fetchImpl: async (input) => {
        const url = String(input)
        seenUrls.push(url)

        if (url.endsWith('/healthz')) {
          return new Response(null, { status: 204 })
        }
        if (url.endsWith('/api/v1/status')) {
          return Response.json({ api: { status: 'ok', version: '0.1.0' } }, { status: 200 })
        }
        if (url.endsWith('/')) {
          return new Response('<html></html>', { status: 200 })
        }
        if (matchesProbePath(url, DASHBOARD_STATIC_PROBE_PATHS)) {
          return new Response(url.endsWith('.css') ? '.page{}' : 'export {}', { status: 200 })
        }
        if (matchesProbePath(url, DASHBOARD_CONTRACT_PROBE_PATHS)) {
          if (url.endsWith('/contracts/dashboard-login-copy.v1.json')) {
            return Response.json({ _meta: { version: 'v1' }, locales: { en: { title: 'Clipulse Dashboard Login' } } }, { status: 200 })
          }
          return Response.json({ _meta: { version: 'v1' } }, { status: 200 })
        }

        throw new Error(`unexpected request: ${url}`)
      },
    })

    expect(seenUrls).toEqual([
      'https://clipulse.example/healthz',
      'https://clipulse.example/api/v1/status',
      'https://clipulse.example/',
      ...toAbsoluteProbeUrls('https://clipulse.example', DASHBOARD_STATIC_PROBE_PATHS),
      ...toAbsoluteProbeUrls('https://clipulse.example', DASHBOARD_CONTRACT_PROBE_PATHS),
    ])
  })
})
