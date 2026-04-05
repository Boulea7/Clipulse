const SECOND_MS = 1_000
const MINUTE_MS = 60 * SECOND_MS
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

function formatUnit(value, singular, plural) {
  return `${value} ${value === 1 ? singular : plural}`
}

export function formatDuration(durationMs) {
  const safeDuration = Math.max(durationMs, 0)

  if (safeDuration >= DAY_MS) {
    const days = Math.floor(safeDuration / DAY_MS)
    const hours = Math.floor((safeDuration % DAY_MS) / HOUR_MS)
    return `${formatUnit(days, 'day', 'days')} ${formatUnit(hours, 'hr', 'hr')}`
  }

  if (safeDuration >= HOUR_MS) {
    const hours = Math.floor(safeDuration / HOUR_MS)
    const minutes = Math.floor((safeDuration % HOUR_MS) / MINUTE_MS)
    return `${formatUnit(hours, 'hr', 'hr')} ${formatUnit(minutes, 'min', 'min')}`
  }

  if (safeDuration >= MINUTE_MS) {
    const minutes = Math.floor(safeDuration / MINUTE_MS)
    const seconds = Math.floor((safeDuration % MINUTE_MS) / SECOND_MS)
    return `${formatUnit(minutes, 'min', 'min')} ${formatUnit(seconds, 'sec', 'sec')}`
  }

  const seconds = Math.floor(safeDuration / SECOND_MS)
  return formatUnit(seconds, 'sec', 'sec')
}

export function formatDayLabel(dateString) {
  const date = new Date(`${dateString}T00:00:00Z`)

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

export function formatTimestampLabel(timestamp) {
  const date = new Date(timestamp)

  return (
    new Intl.DateTimeFormat('en-US', {
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
