import { getCurrentLocale, translateText } from './i18n.js'

const SECOND_MS = 1_000
const MINUTE_MS = 60 * SECOND_MS
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const NOT_RECORDED_YET_TEXT = 'Not recorded yet'
const LOCALE_DURATION_UNITS = {
  en: { day: ['day', 'days'], hr: ['hr', 'hr'], min: ['min', 'min'], sec: ['sec', 'sec'] },
  'zh-CN': { day: ['天', '天'], hr: ['小时', '小时'], min: ['分', '分'], sec: ['秒', '秒'] },
  'zh-TW': { day: ['天', '天'], hr: ['小時', '小時'], min: ['分', '分'], sec: ['秒', '秒'] },
  es: { day: ['día', 'días'], hr: ['h', 'h'], min: ['min', 'min'], sec: ['s', 's'] },
  'pt-BR': { day: ['dia', 'dias'], hr: ['h', 'h'], min: ['min', 'min'], sec: ['s', 's'] },
  ja: { day: ['日', '日'], hr: ['時間', '時間'], min: ['分', '分'], sec: ['秒', '秒'] },
  ko: { day: ['일', '일'], hr: ['시간', '시간'], min: ['분', '분'], sec: ['초', '초'] },
  de: { day: ['Tag', 'Tage'], hr: ['Std', 'Std'], min: ['Min', 'Min'], sec: ['Sek', 'Sek'] },
  fr: { day: ['jour', 'jours'], hr: ['h', 'h'], min: ['min', 'min'], sec: ['s', 's'] },
  ru: { day: ['день', 'дней'], hr: ['ч', 'ч'], min: ['мин', 'мин'], sec: ['с', 'с'] },
  hi: { day: ['दिन', 'दिन'], hr: ['घं', 'घं'], min: ['मि', 'मि'], sec: ['से', 'से'] },
  id: { day: ['hari', 'hari'], hr: ['jam', 'jam'], min: ['mnt', 'mnt'], sec: ['dtk', 'dtk'] },
  tr: { day: ['gün', 'gün'], hr: ['sa', 'sa'], min: ['dk', 'dk'], sec: ['sn', 'sn'] },
  it: { day: ['giorno', 'giorni'], hr: ['h', 'h'], min: ['min', 'min'], sec: ['s', 's'] },
  nl: { day: ['dag', 'dagen'], hr: ['u', 'u'], min: ['min', 'min'], sec: ['s', 's'] },
}

function getSafeLocale(locale) {
  if (typeof locale === 'string' && locale.trim().length > 0) {
    return locale.trim()
  }

  return getCurrentLocale()
}

function formatUnit(value, singular, plural, locale = 'en') {
  const formatter = new Intl.NumberFormat(getSafeLocale(locale))
  return `${formatter.format(value)} ${value === 1 ? singular : plural}`
}

export function formatDuration(durationMs, locale = 'en') {
  const safeDuration = Math.max(durationMs, 0)
  const units = LOCALE_DURATION_UNITS[getSafeLocale(locale)] ?? LOCALE_DURATION_UNITS.en

  if (safeDuration >= DAY_MS) {
    const days = Math.floor(safeDuration / DAY_MS)
    const hours = Math.floor((safeDuration % DAY_MS) / HOUR_MS)
    return `${formatUnit(days, units.day[0], units.day[1], locale)} ${formatUnit(hours, units.hr[0], units.hr[1], locale)}`
  }

  if (safeDuration >= HOUR_MS) {
    const hours = Math.floor(safeDuration / HOUR_MS)
    const minutes = Math.floor((safeDuration % HOUR_MS) / MINUTE_MS)
    return `${formatUnit(hours, units.hr[0], units.hr[1], locale)} ${formatUnit(minutes, units.min[0], units.min[1], locale)}`
  }

  if (safeDuration >= MINUTE_MS) {
    const minutes = Math.floor(safeDuration / MINUTE_MS)
    const seconds = Math.floor((safeDuration % MINUTE_MS) / SECOND_MS)
    return `${formatUnit(minutes, units.min[0], units.min[1], locale)} ${formatUnit(seconds, units.sec[0], units.sec[1], locale)}`
  }

  const seconds = Math.floor(safeDuration / SECOND_MS)
  return formatUnit(seconds, units.sec[0], units.sec[1], locale)
}

export function formatDayLabel(dateString, locale = 'en') {
  const date = new Date(`${dateString}T00:00:00Z`)

  return new Intl.DateTimeFormat(getSafeLocale(locale), {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

export function formatTimestampLabel(timestamp, locale = 'en') {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) {
    return translateText(NOT_RECORDED_YET_TEXT, getSafeLocale(locale))
  }

  return (
    new Intl.DateTimeFormat(getSafeLocale(locale), {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'UTC',
    }).format(date) + ' UTC'
  )
}
