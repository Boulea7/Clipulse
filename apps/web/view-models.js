import { formatDayLabel, formatDuration, formatTimestampLabel } from './formatters.js'
import { buildProjectHash, buildSessionHash } from './routes.js'

function buildNamedDurationLines(items, emptyLine) {
  if (!items.length) {
    return [emptyLine]
  }

  return items.map((item) => `${item.name}: ${formatDuration(item.active_ms)}`)
}

export function buildOverviewLines(overview) {
  return [
    `Total events: ${overview.totals.events}`,
    `Total active: ${formatDuration(overview.totals.active_ms)}`,
    `Total wait: ${formatDuration(overview.totals.wait_ms)}`,
    `Today active: ${formatDuration(overview.today.active_ms)}`,
    `This week active: ${formatDuration(overview.this_week.active_ms)}`,
  ]
}

export function buildLanguageLines(items) {
  if (!items.length) {
    return ['No language data yet.']
  }

  return items.map((item) => `${item.name}: ${item.changed}`)
}

export function buildModelLines(items) {
  return buildNamedDurationLines(items, 'No model data yet.')
}

export function buildHostLines(items) {
  return buildNamedDurationLines(items, 'No host data yet.')
}

export function buildProjectListItems(items) {
  if (!items.length) {
    return []
  }

  return items.map((item) => ({
    href: buildProjectHash(item.project_ref),
    label: item.project_name,
    meta: `${formatDuration(item.active_ms)} active . ${item.events} events`,
  }))
}

export function buildRecentSessionItems(items) {
  if (!items.length) {
    return []
  }

  return items.map((item) => ({
    href: buildSessionHash(item.session_id, item.project_ref),
    label: `${item.project_name} / ${item.session_id}`,
    meta: `${formatDuration(item.active_ms)} active . ${item.host} . ${item.model_name}`,
  }))
}

function buildNotFoundDetail(title, description) {
  return {
    title,
    description,
    entries: [['Status', 'Not found in current dashboard snapshot']],
  }
}

function buildHomeDetail(overview) {
  return {
    title: 'Home overview',
    description: 'Current Clipulse alpha snapshot across all tracked agent activity.',
    entries: [
      ['Total active', formatDuration(overview.totals.active_ms)],
      ['Total wait', formatDuration(overview.totals.wait_ms)],
      ['Today active', formatDuration(overview.today.active_ms)],
      ['This week active', formatDuration(overview.this_week.active_ms)],
    ],
  }
}

function buildProjectDetail(route, projectDetail) {
  if (!projectDetail) {
    return buildNotFoundDetail(
      `Project: ${route.projectRef}`,
      'This project detail is not available yet.',
    )
  }

  return {
    title: `Project: ${projectDetail.project_name}`,
    description: 'Recent session aggregates for this project.',
    entries: [
      ['Project ref', projectDetail.project_ref],
      ['Active time', formatDuration(projectDetail.active_ms)],
      ['Wait time', formatDuration(projectDetail.wait_ms)],
      ['Events', String(projectDetail.event_count)],
      ['Recent sessions', String(projectDetail.sessions.length)],
    ],
  }
}

function buildSessionDetail(route, sessionDetail) {
  if (!sessionDetail) {
    return buildNotFoundDetail(
      `Session: ${route.sessionId}`,
      'This session detail is not available yet.',
    )
  }

  return {
    title: `Session: ${sessionDetail.session_id}`,
    description: 'Aggregated session activity and file delta summary.',
    entries: [
      ['Project', sessionDetail.project_name],
      ['Project ref', sessionDetail.project_ref],
      ['Active time', formatDuration(sessionDetail.active_ms)],
      ['Wait time', formatDuration(sessionDetail.wait_ms)],
      ['Events', String(sessionDetail.event_count)],
      ['Host', sessionDetail.host],
      ['Model', sessionDetail.model_name],
      ['Branch', sessionDetail.git_branch || 'unknown'],
      ['Languages', summarizeLanguages(sessionDetail.languages)],
      ['Changed files', String(sessionDetail.file_deltas?.length ?? 0)],
      ['Last event', formatTimestampLabel(sessionDetail.last_event_time)],
    ],
  }
}

export function buildDetailEntries(route, data, detailState = null) {
  if (route.view === 'project') {
    return buildProjectDetail(route, detailState?.projectDetail ?? null)
  }

  if (route.view === 'session') {
    return buildSessionDetail(route, detailState?.sessionDetail ?? null)
  }

  return buildHomeDetail(data.overview)
}

export function buildTimeseriesRows(items) {
  if (!items.length) {
    return []
  }

  const maxActiveMs = Math.max(...items.map((item) => item.active_ms), 0)

  return items.map((item) => ({
    dateLabel: formatDayLabel(item.date),
    summary: `${formatDuration(item.active_ms)} active . ${item.events} events`,
    barWidth:
      maxActiveMs > 0 ? `${Math.max(Math.round((item.active_ms / maxActiveMs) * 100), 1)}%` : '0%',
  }))
}

function summarizeLanguages(languages) {
  if (!languages?.length) {
    return 'None'
  }

  return languages.map((language) => language.name).join(', ')
}
