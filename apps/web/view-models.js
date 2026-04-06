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
    meta: formatRecentSessionMeta(item),
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
      ['Sessions', String(projectDetail.session_count ?? projectDetail.sessions.length)],
      ['Changed files', formatChangedFiles(projectDetail)],
      ['Changed languages', formatChangedLanguages(projectDetail)],
      ['Line changes', formatLineChangeSummary(projectDetail)],
      ['Top language', formatTopLanguage(projectDetail.top_language, projectDetail.languages)],
      ['Host-model mix', formatHostModelMix(projectDetail.host_model_mix)],
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
      ['Host-model mix', formatHostModelMix(sessionDetail.host_model_mix)],
      ['Changed files', formatChangedFiles(sessionDetail)],
      ['Changed languages', formatChangedLanguages(sessionDetail)],
      ['Line changes', formatLineChangeSummary(sessionDetail)],
      ['Top language', formatTopLanguage(sessionDetail.top_language, sessionDetail.languages)],
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

function formatChangedFiles(detail) {
  const count = detail.changed_files_count ?? detail.file_deltas?.length ?? 0
  const fileDeltas = detail.file_deltas ?? []
  if (!fileDeltas.length) {
    return `${count} total`
  }

  const preview = fileDeltas
    .slice(0, 2)
    .map((delta) => `${delta.language} +${delta.added ?? 0}/-${delta.removed ?? 0}`)
    .join(', ')

  return `${count} total (${preview})`
}

function formatChangedLanguages(detail) {
  const count = detail.changed_languages_count ?? detail.languages?.length ?? 0
  const names = summarizeLanguages(detail.languages)
  return names === 'None' ? `${count} total` : `${count} total (${names})`
}

function formatLineChangeSummary(sessionDetail) {
  const added = sessionDetail.lines_added ?? 0
  const removed = sessionDetail.lines_removed ?? 0
  const changed = sessionDetail.lines_changed ?? (added + removed)
  return `+${added} / -${removed} / ${changed} total`
}

function formatTopLanguage(topLanguage, languages) {
  if (topLanguage?.name) {
    return `${topLanguage.name} (${topLanguage.changed ?? 0} changed lines)`
  }

  return summarizeLanguages(languages)
}

function formatHostModelMix(items) {
  if (!items?.length) {
    return 'None'
  }

  return items
    .slice(0, 2)
    .map((item) => `${item.host} / ${item.model_name} (${formatDuration(item.active_ms ?? 0)} active)`)
    .join('; ')
}

function formatRecentSessionMeta(item) {
  const mixLength = item.host_model_mix?.length ?? 0
  const mixSuffix = mixLength > 1 ? ` . +${mixLength - 1} combo${mixLength - 1 === 1 ? '' : 's'}` : ''
  return `${formatDuration(item.active_ms)} active . ${item.host} . ${item.model_name}${mixSuffix}`
}
