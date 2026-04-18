import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_LOCALE,
  DASHBOARD_LOGIN_TRANSLATIONS,
  LOCALE_COOKIE_NAME,
  buildLocaleCookieWrites,
  getLocaleOptions,
  readLocaleCookie,
  resolveDashboardLocale,
} from './i18n.js'

const DASHBOARD_LOGIN_COPY_CONTRACT = JSON.parse(
  readFileSync(new URL('../../contracts/dashboard-login-copy.v1.json', import.meta.url), 'utf8'),
) as {
  locales: Record<string, Record<string, string>>
}

describe('dashboard i18n locale resolution', () => {
  it('prefers a supported locale stored in the locale cookie', () => {
    const locale = resolveDashboardLocale({
      cookieHeader: `${LOCALE_COOKIE_NAME}=ja; theme=light`,
      navigatorLanguages: ['de-DE', 'en-US'],
    })

    expect(locale).toBe('ja')
  })

  it('falls back to the browser locale when the cookie is missing', () => {
    const locale = resolveDashboardLocale({
      cookieHeader: '',
      navigatorLanguages: ['pt-BR', 'en-US'],
    })

    expect(locale).toBe('pt-BR')
  })

  it('falls back to english when neither cookie nor browser language matches', () => {
    const locale = resolveDashboardLocale({
      cookieHeader: `${LOCALE_COOKIE_NAME}=xx`,
      navigatorLanguages: ['pl-PL'],
    })

    expect(locale).toBe(DEFAULT_LOCALE)
  })

  it('normalizes locale cookies to the supported dashboard locale list', () => {
    expect(readLocaleCookie(`${LOCALE_COOKIE_NAME}=zh-Hant-TW`)).toBe('zh-TW')
    expect(readLocaleCookie(`${LOCALE_COOKIE_NAME}=es-MX`)).toBe('es')
    expect(readLocaleCookie(`${LOCALE_COOKIE_NAME}=xx`)).toBe(null)
  })

  it('returns switcher options for every supported locale', () => {
    const options = getLocaleOptions()

    expect(options.map((option) => option.value)).toEqual([
      'en',
      'zh-CN',
      'zh-TW',
      'es',
      'pt-BR',
      'ja',
      'ko',
      'de',
      'fr',
      'ru',
      'hi',
      'id',
      'tr',
      'it',
      'nl',
    ])
  })

  it('builds deterministic locale cookie writes for subpath deployments', () => {
    expect(buildLocaleCookieWrites('de', '/clipulse')).toEqual([
      'clipulse_dashboard_locale=de; Path=/clipulse; Max-Age=31536000; SameSite=Lax',
      'clipulse_dashboard_locale=; Path=/; Max-Age=0; SameSite=Lax',
      'clipulse_locale=; Path=/; Max-Age=0; SameSite=Lax',
    ])
  })

  it('keeps locale cookie writes as raw cookie strings before any JS escaping', () => {
    expect(buildLocaleCookieWrites('de', '/clipulse</script>&"quoted')).toEqual([
      'clipulse_dashboard_locale=de; Path=/clipulse</script>&"quoted; Max-Age=31536000; SameSite=Lax',
      'clipulse_dashboard_locale=; Path=/; Max-Age=0; SameSite=Lax',
      'clipulse_locale=; Path=/; Max-Age=0; SameSite=Lax',
    ])
  })

  it('clears the legacy root cookie while keeping the root-scoped locale cookie active', () => {
    expect(buildLocaleCookieWrites('ja', '/')).toEqual([
      'clipulse_dashboard_locale=ja; Path=/; Max-Age=31536000; SameSite=Lax',
      'clipulse_locale=; Path=/; Max-Age=0; SameSite=Lax',
    ])
  })

  it('exposes non-english login translations from the shared asset', () => {
    expect(DASHBOARD_LOGIN_TRANSLATIONS.ja?.heading).toBe('保護された Clipulse ダッシュボード')
    expect(DASHBOARD_LOGIN_TRANSLATIONS['zh-CN']?.submit).toBe('打开 dashboard')
    expect(DASHBOARD_LOGIN_TRANSLATIONS.de?.submit).not.toBe(
      DASHBOARD_LOGIN_TRANSLATIONS.en?.submit,
    )
  })

  it('keeps embedded login translations aligned with the published contract', () => {
    expect(DASHBOARD_LOGIN_TRANSLATIONS).toEqual(DASHBOARD_LOGIN_COPY_CONTRACT.locales)
  })

  it('does not reference the published login-copy contract from the browser bundle', () => {
    const source = readFileSync(new URL('./i18n.js', import.meta.url), 'utf8')

    expect(source).not.toMatch(/dashboard-login-copy\.v1\.json/)
  })
})
