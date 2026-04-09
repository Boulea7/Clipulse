import { formatDayLabel, formatDuration, formatTimestampLabel } from './formatters.js'
import { buildProjectHash, buildSessionHash } from './routes.js'

const CHANGE_TRACKING_EMPTY_TEXT = 'No file delta summary yet. This can be normal for prompt-only activity, read-only commands, or the first Codex snapshot baseline.'
const FILE_IDENTIFIER_TEXT = 'Fingerprints are privacy-safe file IDs, not raw paths or source excerpts.'
const UNKNOWN_TEXT = 'unknown'
const NOT_RECORDED_YET_TEXT = 'Not recorded yet'

function pickText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value
    }
  }

  return null
}

function getDurationMs(value) {
  return Number.isFinite(value) ? value : 0
}

function getCount(value) {
  return Number.isFinite(value) ? value : 0
}

function getItems(items) {
  return Array.isArray(items) ? items : []
}

function normalizeOverviewWindow(window) {
  return {
    events: getCount(window?.events),
    active_ms: getDurationMs(window?.active_ms),
    wait_ms: getDurationMs(window?.wait_ms),
  }
}

function normalizeOverview(overview) {
  return {
    totals: normalizeOverviewWindow(overview?.totals),
    today: normalizeOverviewWindow(overview?.today),
    this_week: normalizeOverviewWindow(overview?.this_week),
  }
}

function getProjectLabel(item, routeProjectRef = null) {
  return pickText(item?.project_name, item?.project_ref, routeProjectRef, 'Unknown project')
}

function getProjectRefLabel(item, routeProjectRef = null) {
  return pickText(item?.project_ref, routeProjectRef, UNKNOWN_TEXT)
}

function getSessionIdLabel(item, routeSessionId = null) {
  return pickText(item?.session_id, routeSessionId, UNKNOWN_TEXT)
}

function getUnknownText(value) {
  return pickText(value, UNKNOWN_TEXT)
}

function normalizeHostLabel(host) {
  const normalizedHost = pickText(host)
  if (!normalizedHost) {
    return null
  }

  switch (normalizedHost.toLowerCase()) {
    case 'claude-code':
      return 'Claude Code'
    case 'codex':
      return 'Codex'
    case 'gemini-cli':
      return 'Gemini CLI'
    case 'opencode':
      return 'OpenCode'
    default:
      return normalizedHost
  }
}

function getDisplayHost(value, fallback = UNKNOWN_TEXT) {
  return normalizeHostLabel(value) ?? fallback
}

function formatOptionalTimestamp(timestamp) {
  return pickText(timestamp) ? formatTimestampLabel(timestamp) : NOT_RECORDED_YET_TEXT
}

function getPrimaryHostModelSource(detail) {
  return detail?.host_model_primary ?? detail?.host_model_mix?.[0] ?? null
}

function formatPrimaryHostModel(detail) {
  const primary = getPrimaryHostModelSource(detail)
  const host = getDisplayHost(primary?.host, null)
  const modelName = pickText(primary?.model_name)

  if (!host && !modelName) {
    return NOT_RECORDED_YET_TEXT
  }

  return `${host ?? UNKNOWN_TEXT} / ${modelName ?? UNKNOWN_TEXT}`
}

function buildProjectLastEventEntries(projectDetail) {
  const entries = []

  if (pickText(projectDetail?.last_host)) {
    entries.push(['Last host', getDisplayHost(projectDetail.last_host)])
  }
  if (pickText(projectDetail?.last_model_name)) {
    entries.push(['Last model', projectDetail.last_model_name])
  }
  if (pickText(projectDetail?.last_git_branch)) {
    entries.push(['Last branch', projectDetail.last_git_branch])
  }
  if (pickText(projectDetail?.last_event_time)) {
    entries.push(['Last event', formatOptionalTimestamp(projectDetail.last_event_time)])
  }

  return entries
}

function buildNamedDurationLines(items, emptyLine) {
  const safeItems = getItems(items)

  if (!safeItems.length) {
    return [emptyLine]
  }

  return safeItems.map((item) => `${item.name}: ${formatDuration(getDurationMs(item.active_ms))}`)
}

export function buildOverviewLines(overview) {
  const safeOverview = normalizeOverview(overview)

  return [
    `Total events: ${safeOverview.totals.events}`,
    `Total active: ${formatDuration(safeOverview.totals.active_ms)}`,
    `Total wait: ${formatDuration(safeOverview.totals.wait_ms)}`,
    `Today active: ${formatDuration(safeOverview.today.active_ms)}`,
    `This week active: ${formatDuration(safeOverview.this_week.active_ms)}`,
  ]
}

export function buildLanguageLines(items) {
  const safeItems = getItems(items)

  if (!safeItems.length) {
    return ['No language data yet.']
  }

  return safeItems.map((item) => `${item.name}: ${item.changed}`)
}

export function buildModelLines(items) {
  return buildNamedDurationLines(items, 'No model data yet.')
}

export function buildHostLines(items) {
  const safeItems = getItems(items)

  if (!safeItems.length) {
    return ['No host data yet.']
  }

  return safeItems.map((item) => `${getDisplayHost(item.name, item.name ?? UNKNOWN_TEXT)}: ${formatDuration(getDurationMs(item.active_ms))}`)
}

export function buildProjectListItems(items) {
  const safeItems = getItems(items).filter((item) => pickText(item?.project_ref))

  if (!safeItems.length) {
    return []
  }

  return safeItems.map((item) => ({
    href: buildProjectHash(item.project_ref),
    label: getProjectLabel(item),
    meta: formatProjectMeta(item),
  }))
}

export function buildRecentSessionItems(items) {
  const safeItems = getItems(items).filter((item) => pickText(item?.project_ref) && pickText(item?.session_id))

  if (!safeItems.length) {
    return []
  }

  return safeItems.map((item) => ({
    href: buildSessionHash(item.session_id, item.project_ref),
    label: `${getProjectLabel(item)} / ${getSessionIdLabel(item)}`,
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
  const safeOverview = normalizeOverview(overview)
  const statusSuffix = statusLoadState === 'fulfilled'
    ? ''
    : ' Status feed unavailable, so system-health details are temporarily incomplete.'
  return {
    title: 'Home overview',
    description: `Current Clipulse alpha snapshot across all tracked agent activity.${statusSuffix}`,
    entries: [
      ['Total events', String(safeOverview.totals.events)],
      ['Total active', formatDuration(safeOverview.totals.active_ms)],
      ['Total wait', formatDuration(safeOverview.totals.wait_ms)],
      ['Today active', formatDuration(safeOverview.today.active_ms)],
      ['This week active', formatDuration(safeOverview.this_week.active_ms)],
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

  const projectLabel = getProjectLabel(projectDetail, route.projectRef)
  const projectRef = getProjectRefLabel(projectDetail, route.projectRef)

  return {
    title: `Project: ${projectLabel}`,
    description: 'Recent session aggregates for this project. Clipulse reports compact, local-first heuristics instead of a full audit log.',
    entries: [
      ['Project ref', projectRef],
      ['Active time', formatDuration(getDurationMs(projectDetail.active_ms))],
      ['Wait time', formatDuration(getDurationMs(projectDetail.wait_ms))],
      ['Events', String(getCount(projectDetail.event_count))],
      ['Sessions', String(getCount(projectDetail.session_count))],
      ['Changed files', formatChangedFiles(projectDetail)],
      ['Languages', formatLanguageSummary(projectDetail)],
      ['Line changes', formatLineChangeSummary(projectDetail)],
      ...(buildChangeTrackingEntries(projectDetail)),
      ['File identifiers', FILE_IDENTIFIER_TEXT],
      ['Primary host-model', formatPrimaryHostModel(projectDetail)],
      ['Host-model mix', formatHostModelMix(projectDetail.host_model_mix)],
      ...(buildProjectLastEventEntries(projectDetail)),
      ['Project sessions', formatCountLabel(getCount(projectDetail.session_count), 'session')],
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

  const sessionContext = getProjectLabel(sessionDetail, route.projectRef)
  const projectRef = getProjectRefLabel(sessionDetail, route.projectRef)
  const sessionId = getSessionIdLabel(sessionDetail, route.sessionId)
  const titleSuffix = sessionContext ? `${sessionContext} / ${sessionId}` : sessionId

  return {
    title: `Session: ${titleSuffix}`,
    description: 'Aggregated session activity and file delta summary. Clipulse reports compact, local-first heuristics instead of a full audit log.',
    entries: [
      ['Project', sessionContext],
      ['Project ref', projectRef],
      ['Active time', formatDuration(getDurationMs(sessionDetail.active_ms))],
      ['Wait time', formatDuration(getDurationMs(sessionDetail.wait_ms))],
      ['Events', String(getCount(sessionDetail.event_count))],
      ['Primary host-model', formatPrimaryHostModel(sessionDetail)],
      ['Host-model mix', formatHostModelMix(sessionDetail.host_model_mix)],
      ['Last host', getDisplayHost(sessionDetail.host)],
      ['Last model', getUnknownText(sessionDetail.model_name)],
      ['Last branch', pickText(sessionDetail.git_branch, UNKNOWN_TEXT)],
      ['Changed files', formatChangedFiles(sessionDetail)],
      ['Languages', formatLanguageSummary(sessionDetail)],
      ['Line changes', formatLineChangeSummary(sessionDetail)],
      ...(buildChangeTrackingEntries(sessionDetail)),
      ['File identifiers', FILE_IDENTIFIER_TEXT],
      ['Last event', formatOptionalTimestamp(sessionDetail.last_event_time)],
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
  const safeItems = getItems(items)

  if (!safeItems.length) {
    return []
  }

  const maxActiveMs = Math.max(...safeItems.map((item) => item.active_ms), 0)

  return safeItems.map((item) => ({
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
  const truncatedCount = Number.isFinite(detail?.file_preview_truncated_count)
    ? Math.max(detail.file_preview_truncated_count, 0)
    : 0
  const count = detail.changed_files_count ?? detail.file_deltas?.length ?? 0
  const filePreview = Array.isArray(detail?.file_preview) ? detail.file_preview : []
  const fileDeltas = Array.isArray(detail?.file_deltas) ? detail.file_deltas : []
  const previewItems = filePreview.length ? filePreview : fileDeltas
  if (!previewItems.length) {
    if (truncatedCount > 0) {
      return `${formatCountLabel(count, 'file')} . Preview truncated`
    }
    return formatCountLabel(count, 'file')
  }

  const preview = previewItems
    .slice(0, 2)
    .map((delta) => `${formatFingerprintPreview(delta.fingerprint)} +${delta.added ?? 0}/-${delta.removed ?? 0}`)
    .join(', ')

  const hiddenPreviewCount = Math.max(count - Math.min(previewItems.length, 2), 0)
  const hiddenCount = Math.max(hiddenPreviewCount, truncatedCount)
  const truncatedSuffix = hiddenCount > 0 ? ` . +${hiddenCount} more` : ''
  return `${formatCountLabel(count, 'file')} . ${preview}${truncatedSuffix}`
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
    .map((item) => `${getDisplayHost(item.host)} / ${item.model_name} (${formatDuration(item.active_ms ?? 0)} active)`)
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
  const parts = [`${formatDuration(getDurationMs(item.active_ms))} active`]
  if (getCount(item.lines_changed) > 0) {
    parts.push(`${item.lines_changed} lines`)
  }
  if (item.top_language?.name) {
    parts.push(item.top_language.name)
  }
  if (getCount(item.changed_files_count) > 0) {
    parts.push(formatCountLabel(item.changed_files_count, 'file'))
  } else {
    parts.push(`${getCount(item.events)} events`)
  }

  return parts.join(' . ')
}

function formatRecentSessionMeta(item) {
  const mixLength = item.host_model_mix_count ?? item.host_model_mix?.length ?? 0
  const parts = [`${formatDuration(getDurationMs(item.active_ms))} active`]
  if (getCount(item.lines_changed) > 0) {
    parts.push(`${item.lines_changed} lines`)
  }
  if (item.top_language?.name) {
    parts.push(item.top_language.name)
  }
  if (getCount(item.changed_files_count) > 0) {
    parts.push(formatCountLabel(item.changed_files_count, 'file'))
  }
  const primary = getPrimaryHostModelSource(item)
  const primaryHost = getDisplayHost(primary?.host, null)
  const primaryModelName = pickText(primary?.model_name)
  if (primaryHost || primaryModelName) {
    parts.push(`Primary ${primaryHost ?? UNKNOWN_TEXT} / ${primaryModelName ?? UNKNOWN_TEXT}`)
  } else {
    const lastHost = getDisplayHost(item.host, null)
    const lastModelName = pickText(item.model_name)
    if (lastHost || lastModelName) {
      parts.push(`Last ${lastHost ?? UNKNOWN_TEXT} / ${lastModelName ?? UNKNOWN_TEXT}`)
    }
  }
  const mixSuffix = mixLength > 1
    ? ` . +${mixLength - 1} host-model combo${mixLength - 1 === 1 ? '' : 's'}`
    : ''
  return `${parts.join(' . ')}${mixSuffix}`
}
