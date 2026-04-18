import { describe, expect, it } from 'vitest'

import {
  DASHBOARD_CONTRACT_PROBE_PATHS,
  DASHBOARD_STATIC_PROBE_PATHS,
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
      expectPublicReads: true,
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
      expectPublicReads: false,
    })
  })

  it('fails fast when split auth env is only partially configured', () => {
    expect(() => parseDeploymentSmokeEnv({
      CLIPULSE_BASE_URL: 'https://clipulse.example',
      CLIPULSE_DASHBOARD_TOKEN: 'dashboard-token',
    })).toThrow('CLIPULSE_DASHBOARD_TOKEN and CLIPULSE_API_BEARER_TOKEN')
  })
})

describe('deployment smoke helpers', () => {
  it('extracts the first cookie pair from a Set-Cookie header', () => {
    expect(extractCookieHeader('clipulse_api_token=signed; HttpOnly; Path=/')).toBe(
      'clipulse_api_token=signed',
    )
  })
})

describe('deployment smoke runner', () => {
  it('probes protected deployments in the expected order and reuses the login cookie', async () => {
    const calls: Array<{ url: string, method: string, headers: Record<string, string> }> = []

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
          if (!headers.Cookie) {
            return Response.json({ detail: { code: 'authentication_required' } }, { status: 401 })
          }
          expect(headers.Cookie).toBe('clipulse_api_token=signed')
          return new Response('<html>docs</html>', { status: 200 })
        }

        if (url.endsWith('/openapi.json')) {
          if (!headers.Cookie) {
            return Response.json({ detail: { code: 'authentication_required' } }, { status: 401 })
          }
          expect(headers.Cookie).toBe('clipulse_api_token=signed')
          return Response.json({ openapi: '3.1.0' }, { status: 200 })
        }

        if (url.endsWith('/dashboard-login')) {
          expect(method).toBe('POST')
          expect(headers['content-type']).toBe('application/json')
          expect(init?.body).toBe(JSON.stringify({ token: 'dashboard-token' }))
          return new Response(null, {
            status: 204,
            headers: { 'set-cookie': 'clipulse_api_token=signed; HttpOnly; Path=/' },
          })
        }

        if (url.endsWith('/')) {
          if (!headers.Cookie) {
            return new Response('<html><h1>Protected Clipulse dashboard</h1></html>', { status: 200 })
          }
          expect(headers.Cookie).toBe('clipulse_api_token=signed')
          return new Response('<html></html>', { status: 200 })
        }

        if (matchesProbePath(url, DASHBOARD_STATIC_PROBE_PATHS)) {
          if (!headers.Cookie) {
            return Response.json({ detail: { code: 'authentication_required' } }, { status: 401 })
          }
          expect(headers.Cookie).toBe('clipulse_api_token=signed')
          return new Response(url.endsWith('.css') ? '.page{}' : 'export {}', { status: 200 })
        }

        if (matchesProbePath(url, DASHBOARD_CONTRACT_PROBE_PATHS)) {
          if (!headers.Cookie) {
            return Response.json({ detail: { code: 'authentication_required' } }, { status: 401 })
          }
          expect(headers.Cookie).toBe('clipulse_api_token=signed')
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
      'GET https://clipulse.example/root/',
      ...toAbsoluteProbeUrls('https://clipulse.example/root', DASHBOARD_STATIC_PROBE_PATHS).map((url) => `GET ${url}`),
      ...toAbsoluteProbeUrls('https://clipulse.example/root', DASHBOARD_CONTRACT_PROBE_PATHS).map((url) => `GET ${url}`),
      'GET https://clipulse.example/root/docs',
      'GET https://clipulse.example/root/openapi.json',
    ])
  })

  it('probes optional public routes when explicitly enabled', async () => {
    const seenUrls: string[] = []

    await runDeploymentSmoke({
      baseUrl: 'https://clipulse.example',
      publicBaseUrl: 'https://public.example',
      publicProbeUrl: 'https://public-probe.example',
      expectPublicReads: true,
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
        if (url === 'https://public-probe.example/api/v1/public/readme/top-language') {
          return Response.json({
            markdown: '![Clipulse Top Language](https://public.example/api/v1/badges/top-language.svg)',
          }, { status: 200 })
        }
        if (url === 'https://public-probe.example/api/v1/badges/top-language.svg') {
          return new Response('<svg></svg>', { status: 200 })
        }

        throw new Error(`unexpected request: ${url}`)
      },
    })

    expect(seenUrls).toContain('https://public-probe.example/api/v1/public/readme/top-language')
    expect(seenUrls).toContain('https://public-probe.example/api/v1/badges/top-language.svg')
    expect(seenUrls).toContain('https://clipulse.example/')
    for (const url of toAbsoluteProbeUrls('https://clipulse.example', DASHBOARD_STATIC_PROBE_PATHS)) {
      expect(seenUrls).toContain(url)
    }
    for (const url of toAbsoluteProbeUrls('https://clipulse.example', DASHBOARD_CONTRACT_PROBE_PATHS)) {
      expect(seenUrls).toContain(url)
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
