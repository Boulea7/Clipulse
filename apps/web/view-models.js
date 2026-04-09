import { formatDayLabel, formatDuration, formatTimestampLabel } from './formatters.js'
import { buildProjectHash, buildSessionHash } from './routes.js'

const CHANGE_TRACKING_EMPTY_TEXT = 'No file delta summary yet. This can be normal for prompt-only activity, read-only commands, or the first Codex snapshot baseline.'
const FILE_IDENTIFIER_TEXT = 'Fingerprints are privacy-safe file IDs, not raw paths or source excerpts.'

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
    meta: formatProjectMeta(item),
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

function buildHomeDetail(overview, statusLoadState = 'fulfilled') {
  const statusSuffix = statusLoadState === 'fulfilled'
    ? ''
    : ' Status feed unavailable, so system-health details are temporarily incomplete.'
  return {
    title: 'Home overview',
    description: `Current Clipulse alpha snapshot across all tracked agent activity.${statusSuffix}`,
    entries: [
      ['Total active', formatDuration(overview.totals.active_ms)],
      ['Total wait', formatDuration(overview.totals.wait_ms)],
      ['Today active', formatDuration(overview.today.active_ms)],
      ['This week active', formatDuration(overview.this_week.active_ms)],
    ],
  }
}

function buildHomeStatusEntries(status, statusLoadState = 'fulfilled') {
  if (statusLoadState !== 'fulfilled') {
    return [[
      'System',
      'Status feed unavailable. /api/v1/status could not be loaded. Check /healthz and CLIPULSE_API_URL.',
    ]]
  }

  if (!status) {
    return []
  }

  return [
    ['System', formatSystemHealth(status)],
    ['Queue backlog', formatQueueHealth(status)],
    ['Queue storage', formatQueueStorage(status)],
  ]
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
    description: 'Recent session aggregates for this project. Clipulse reports compact, local-first heuristics instead of a full audit log.',
    entries: [
      ['Project ref', projectDetail.project_ref],
      ['Active time', formatDuration(projectDetail.active_ms)],
      ['Wait time', formatDuration(projectDetail.wait_ms)],
      ['Events', String(projectDetail.event_count)],
      ['Sessions', String(projectDetail.session_count ?? 0)],
      ['Changed files', formatChangedFiles(projectDetail)],
      ['Languages', formatLanguageSummary(projectDetail)],
      ['Line changes', formatLineChangeSummary(projectDetail)],
      ...(buildChangeTrackingEntries(projectDetail)),
      ['File identifiers', FILE_IDENTIFIER_TEXT],
      ['Host-model mix', formatHostModelMix(projectDetail.host_model_mix)],
      ['Project sessions', formatCountLabel(projectDetail.session_count ?? 0, 'session')],
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

  const sessionContext = sessionDetail.project_name ?? sessionDetail.project_ref ?? route.projectRef
  const titleSuffix = sessionContext ? `${sessionContext} / ${sessionDetail.session_id}` : sessionDetail.session_id

  return {
    title: `Session: ${titleSuffix}`,
    description: 'Aggregated session activity and file delta summary. Clipulse reports compact, local-first heuristics instead of a full audit log.',
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
      ['Languages', formatLanguageSummary(sessionDetail)],
      ['Line changes', formatLineChangeSummary(sessionDetail)],
      ...(buildChangeTrackingEntries(sessionDetail)),
      ['File identifiers', FILE_IDENTIFIER_TEXT],
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

  return {
    ...buildHomeDetail(data.overview, data.loadState?.status),
    entries: [
      ...buildHomeDetail(data.overview, data.loadState?.status).entries,
      ...buildHomeStatusEntries(data.status, data.loadState?.status),
    ],
  }
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

function formatCountLabel(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`
}

function formatFingerprintPreview(fingerprint) {
  if (!fingerprint) {
    return 'unknown'
  }

  return /^[a-f0-9]{16,}$/i.test(fingerprint) ? fingerprint.slice(0, 8) : fingerprint
}

function formatChangedFiles(detail) {
  const count = detail.changed_files_count ?? detail.file_deltas?.length ?? 0
  const previewItems = detail.file_preview?.length ? detail.file_preview : (detail.file_deltas ?? [])
  if (!previewItems.length) {
    return formatCountLabel(count, 'file')
  }

  const preview = previewItems
    .slice(0, 2)
    .map((delta) => `${formatFingerprintPreview(delta.fingerprint)} +${delta.added ?? 0}/-${delta.removed ?? 0}`)
    .join(', ')

  return `${formatCountLabel(count, 'file')} . ${preview}`
}

function formatLanguageSummary(detail) {
  const count = detail.changed_languages_count ?? detail.languages?.length ?? 0
  if (detail.top_language?.name) {
    return `${formatCountLabel(count, 'language')} . ${detail.top_language.name} leads (${detail.top_language.changed ?? 0} lines)`
  }

  const names = summarizeLanguages(detail.languages)
  return names === 'None' ? formatCountLabel(count, 'language') : `${formatCountLabel(count, 'language')} . ${names}`
}

function formatLineChangeSummary(sessionDetail) {
  const added = sessionDetail.lines_added ?? 0
  const removed = sessionDetail.lines_removed ?? 0
  const changed = sessionDetail.lines_changed ?? (added + removed)
  return `${changed} lines . +${added} / -${removed}`
}

function buildChangeTrackingEntries(detail) {
  const changedFilesCount = detail.changed_files_count ?? detail.file_deltas?.length ?? 0
  const changedLanguagesCount = detail.changed_languages_count ?? detail.languages?.length ?? 0

  if (changedFilesCount > 0 || changedLanguagesCount > 0) {
    return []
  }

  return [[
    'Change tracking',
    CHANGE_TRACKING_EMPTY_TEXT,
  ]]
}

function formatHostModelMix(items) {
  if (!items?.length) {
    return 'None'
  }

  const preview = items
    .slice(0, 2)
    .map((item) => `${item.host} / ${item.model_name} (${formatDuration(item.active_ms ?? 0)} active)`)
    .join('; ')

  return `${formatCountLabel(items.length, 'host-model combo')} . ${preview}`
}

function formatSystemHealth(status) {
  const apiStatus = status.api?.status === 'ok' ? 'API ok' : 'API unavailable'
  const dbStatus = status.db?.status === 'ok' ? 'DB ok' : 'DB unavailable'
  return `${apiStatus} . ${dbStatus}`
}

function formatQueueHealth(status) {
  const ready = status.spool?.ready ?? 0
  const processing = status.spool?.processing ?? 0
  const pending = ready + processing
  const oldestBacklogAgeSeconds = status.spool?.oldest_backlog_age_seconds ?? 0
  const quarantine = status.spool?.quarantine ?? 0
  const oldestQuarantineAgeSeconds = status.spool?.oldest_quarantine_age_seconds ?? 0
  const quarantineSuffix = quarantine > 0
    ? ` . oldest quarantine ${formatAgeSeconds(oldestQuarantineAgeSeconds)}`
    : ''
  return `${pending} jobs pending . ${ready} ready . ${processing} processing . ${quarantine} quarantine . oldest backlog ${formatAgeSeconds(oldestBacklogAgeSeconds)}${quarantineSuffix}`
}

function formatQueueStorage(status) {
  const readyBytes = status.spool?.ready_bytes ?? 0
  const processingBytes = status.spool?.processing_bytes ?? 0
  const quarantineBytes = status.spool?.quarantine_bytes ?? 0
  const totalBytes = readyBytes + processingBytes + quarantineBytes
  const stateDir = status.spool?.state_dir ? ` . ${status.spool.state_dir}` : ''
  return `${formatBytes(totalBytes)} payload spool . ${formatBytes(quarantineBytes)} quarantined${stateDir}`
}

function formatAgeSeconds(seconds) {
  return formatDuration((seconds ?? 0) * 1000)
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  const kib = bytes / 1024
  if (kib < 1024) {
    return `${Number(kib.toFixed(kib >= 10 ? 0 : 1))} KiB`
  }

  const mib = kib / 1024
  return `${Number(mib.toFixed(mib >= 10 ? 0 : 1))} MiB`
}

function formatProjectMeta(item) {
  const parts = [`${formatDuration(item.active_ms)} active`]
  if (item.lines_changed) {
    parts.push(`${item.lines_changed} lines`)
  }
  if (item.top_language?.name) {
    parts.push(item.top_language.name)
  }
  if (item.changed_files_count) {
    parts.push(formatCountLabel(item.changed_files_count, 'file'))
  } else {
    parts.push(`${item.events} events`)
  }

  return parts.join(' . ')
}

function formatRecentSessionMeta(item) {
  const mixLength = item.host_model_mix_count ?? item.host_model_mix?.length ?? 0
  const parts = [`${formatDuration(item.active_ms)} active`]
  if (item.lines_changed) {
    parts.push(`${item.lines_changed} lines`)
  }
  if (item.top_language?.name) {
    parts.push(item.top_language.name)
  }
  if (item.changed_files_count) {
    parts.push(formatCountLabel(item.changed_files_count, 'file'))
  }
  parts.push(item.host)
  parts.push(item.model_name)
  const mixSuffix = mixLength > 1
    ? ` . +${mixLength - 1} host-model combo${mixLength - 1 === 1 ? '' : 's'}`
    : ''
  return `${parts.join(' . ')}${mixSuffix}`
}
