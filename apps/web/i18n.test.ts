import { describe, expect, it } from 'vitest'

import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  getLocaleOptions,
  readLocaleCookie,
  resolveDashboardLocale,
} from './i18n.js'

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
})
