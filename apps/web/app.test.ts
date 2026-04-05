import { describe, expect, it } from 'vitest'

import {
  buildOverviewLines,
  buildProjectLines,
  buildRecentSessionLines,
  formatDuration,
} from './app.js'

describe('dashboard formatters', () => {
  it('formats duration in a compact human-readable form', () => {
    expect(formatDuration(65_000)).toBe('1m 5s')
    expect(formatDuration(3_600_000)).toBe('1h 0m')
  })

  it('builds overview lines with total, today, and week metrics', () => {
    expect(
      buildOverviewLines({
        totals: { events: 8, active_ms: 180_000, wait_ms: 45_000 },
        today: { events: 3, active_ms: 60_000, wait_ms: 10_000 },
        this_week: { events: 6, active_ms: 120_000, wait_ms: 20_000 },
      }),
    ).toEqual([
      'Total events: 8',
      'Total active: 3m 0s',
      'Total wait: 45s',
      'Today active: 1m 0s',
      'This week active: 2m 0s',
    ])
  })

  it('renders project and session fallback lines when no data exists', () => {
    expect(buildProjectLines([])).toEqual(['No project data yet.'])
    expect(buildRecentSessionLines([])).toEqual(['No recent sessions yet.'])
  })
})
