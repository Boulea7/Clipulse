import { formatDayLabel, formatDuration, formatTimestampLabel } from './formatters.js'
import { buildProjectHash, buildSessionHash } from './routes.js'

const CHANGE_TRACKING_EMPTY_TEXT = 'No file delta summary yet. This can be normal for prompt-only activity, read-only commands, or the first Codex snapshot baseline.'
const FILE_IDENTIFIER_TEXT = 'Fingerprints are privacy-safe file IDs, not raw paths or source excerpts.'
const UNKNOWN_TEXT = 'unknown'
const NOT_RECORDED_YET_TEXT = 'Not recorded yet'
const DETAIL_HEURISTICS_TEXT = 'Metrics stay compact and heuristic rather than a full audit log.'
const HOST_UI_DISPLAY = {
  'claude-code': { label: 'Claude Code', release: 'stable' },
  codex: { label: 'Codex', release: 'stable' },
  'gemini-cli': { label: 'Gemini CLI', release: 'experimental' },
  opencode: { label: 'OpenCode', release: 'experimental' },
}

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

function getHostUiDisplay(host) {
  const normalizedHost = pickText(host)
  if (!normalizedHost) {
    return null
  }

  const knownHost = HOST_UI_DISPLAY[normalizedHost.toLowerCase()]
  return knownHost ?? { label: normalizedHost, release: null }
}

function getDisplayHost(value, fallback = UNKNOWN_TEXT) {
  const hostDisplay = getHostUiDisplay(value)
  if (!hostDisplay) {
    return fallback
  }

  return hostDisplay.release ? `${hostDisplay.label} (${hostDisplay.release})` : hostDisplay.label
}

function formatOptionalTimestamp(timestamp) {
  return pickText(timestamp) ? formatTimestampLabel(timestamp) : NOT_RECORDED_YET_TEXT
}

function getExplicitPrimaryHostModelSource(detail) {
  return detail?.host_model_primary ?? null
}

function getObservedHostModelSource(detail) {
  return detail?.host_model_mix?.[0] ?? null
}

function formatHostModelValue(source) {
  const host = getDisplayHost(source?.host, null)
  const modelName = pickText(source?.model_name)

  if (!host && !modelName) {
    return null
  }

  return `${host ?? UNKNOWN_TEXT} / ${modelName ?? UNKNOWN_TEXT}`
}

function formatPrimaryHostModel(detail) {
  return formatHostModelValue(getExplicitPrimaryHostModelSource(detail)) ?? NOT_RECORDED_YET_TEXT
}

function buildHostModelEntry(detail) {
  const primaryValue = formatHostModelValue(getExplicitPrimaryHostModelSource(detail))
  if (primaryValue) {
    return ['Primary host-model', primaryValue]
  }

  const observedValue = formatHostModelValue(getObservedHostModelSource(detail))
  if (observedValue) {
    return ['Observed host-model', observedValue]
  }

  return ['Primary host-model', NOT_RECORDED_YET_TEXT]
}

function buildRouteStateEntries(detailState) {
  const entries = []

  if (pickText(detailState?.routeState) && detailState.routeState !== 'healthy') {
    entries.push(['State', detailState.routeState])
  }

  if (pickText(detailState?.completeness)) {
    entries.push(['Data completeness', detailState.completeness])
  }

  if (pickText(detailState?.relatedFeed)) {
    entries.push(['Related feed', detailState.relatedFeed])
  }

  if (pickText(detailState?.statusMessage)) {
    entries.push(['Status', detailState.statusMessage])
  }

  if (pickText(detailState?.hintMessage)) {
    entries.push(['Hint', detailState.hintMessage])
  }

  return entries
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

function buildHomeDetail(overview) {
  const safeOverview = normalizeOverview(overview)
  return {
    title: 'Home overview',
    description: 'Current Clipulse alpha snapshot across all tracked agent activity.',
    entries: [
      ['Total events', String(safeOverview.totals.events)],
      ['Total active', formatDuration(safeOverview.totals.active_ms)],
      ['Total wait', formatDuration(safeOverview.totals.wait_ms)],
      ['Today active', formatDuration(safeOverview.today.active_ms)],
      ['This week active', formatDuration(safeOverview.this_week.active_ms)],
    ],
  }
}

export function formatCompatibilitySummary(compat) {
  if (!compat || !pickText(compat.mode)) {
    return null
  }

  const metaLabel = pickText(compat.metaLabel)
  const fallbackSectionsLabel = pickText(compat.fallbackSectionsLabel)
  const compatSource = pickText(compat.source)?.toLowerCase() ?? ''
  const remoteMetaText = metaLabel ? ` via ${metaLabel}` : ''
  const builtInMetaText = metaLabel ? ` (${metaLabel})` : ''
  const fallbackScopeText = fallbackSectionsLabel ? ` for ${fallbackSectionsLabel}` : ''

  if (compat.mode === 'remote') {
    return `Remote contract active${remoteMetaText}.`
  }

  if (compat.mode === 'mixed') {
    const fallbackText = fallbackSectionsLabel
      ? `, with built-in fallback for ${fallbackSectionsLabel}`
      : ', with built-in fallback still active'
    return `Remote contract active${remoteMetaText}${fallbackText}.`
  }

  if (compatSource.includes('pending')) {
    return `Dashboard compatibility is using the bundled contract${fallbackScopeText} while the remote contract refresh is still pending${builtInMetaText}.`
  }

  if (
    compatSource.includes('fetch failed')
    || compatSource.includes('invalid json')
    || compatSource.includes('could not be read')
  ) {
    return `Built-in compatibility fallback active${fallbackScopeText} because the remote contract fetch failed${builtInMetaText}.`
  }

  return `Built-in compatibility fallback active${fallbackScopeText}${builtInMetaText}.`
}

function formatStatusCompatAdvisory(status, compat) {
  const pointer = pickText(status?.compat?.pointer)
  const tier = pickText(status?.compat?.tier)
  const artifactVersion = pickText(status?.compat?.artifact_version)
  const surfaces = Array.isArray(status?.compat?.surfaces)
    ? status.compat.surfaces.filter((surface) => typeof pickText(surface) === 'string')
    : []
  const artifactSections = Array.isArray(status?.compat?.artifact_sections)
    ? status.compat.artifact_sections.filter((section) => typeof pickText(section) === 'string')
    : []
  const sectionCount = Number.isFinite(status?.compat?.artifact_section_count)
    ? status.compat.artifact_section_count
    : null

  if (!pointer && !tier && !artifactVersion && sectionCount === null && surfaces.length === 0 && artifactSections.length === 0) {
    return null
  }

  if (compat?.mode === 'remote') {
    return null
  }

  const suffix = artifactVersion && sectionCount !== null
    ? ` @ ${artifactVersion} (${sectionCount} sections)`
    : artifactVersion
      ? ` @ ${artifactVersion}`
      : sectionCount !== null
        ? ` (${sectionCount} sections)`
        : ''
  const tierText = tier ? ` tier=${tier}` : ''
  const surfacesText = surfaces.length ? ` surfaces=${surfaces.join('/')}` : ''
  const sectionsText = artifactSections.length ? ` sections=${artifactSections.join('/')}` : ''

  return `API reports ${pointer ?? '/api/v1/status compat metadata'}${suffix}${tierText}${surfacesText}${sectionsText}.`
}

function hasSpoolAttention(status) {
  const ready = status?.spool?.ready ?? 0
  const processing = status?.spool?.processing ?? 0
  const quarantine = status?.spool?.quarantine ?? 0
  return ready > 0 || processing > 0 || quarantine > 0
}

function buildHomeStatusEntries(status, compat, statusLoadState = 'fulfilled', statusError = null) {
  const entries = []
  const compatibilitySummary = formatCompatibilitySummary(compat)
  const compatibilityAdvisory = formatStatusCompatAdvisory(status, compat)
  const statusFeedInvalid = statusError?.code === 'invalid_summary_payload' || statusError?.code === 'invalid_json_response'
  const shouldFlagAttention = (
    compat?.mode === 'built-in'
    || (compat?.mode === 'mixed' && compat?.usingFallback)
    || hasSpoolAttention(status)
  )

  if (statusLoadState !== 'fulfilled') {
    entries.push([
      'Runtime',
      statusFeedInvalid
        ? 'Status feed returned an invalid payload. /api/v1/status did not match the expected JSON shape.'
        : 'Status feed unavailable. /api/v1/status could not be loaded. Check /healthz, CLIPULSE_API_URL, and the /api/v1/status response if the API still answers.',
    ])
    entries.push([
      'Queue status',
      statusFeedInvalid
        ? 'Queue status unavailable until /api/v1/status returns the expected JSON shape.'
        : 'Queue status unavailable until /api/v1/status is reachable again.',
    ])

    if (compatibilitySummary) {
      entries.push(['Dashboard compatibility', compatibilitySummary])
    }

    entries.push(['State', 'unavailable'])

    return entries
  }

  if (!status) {
    if (compatibilitySummary) {
      entries.push(['Dashboard compatibility', compatibilitySummary])
    }

    return entries
  }

  entries.push(
    ['Runtime', formatSystemHealth(status)],
    ['Queue status', formatQueueHealth(status)],
    ['Queue storage', formatQueueStorage(status)],
  )

  if (compatibilitySummary) {
    entries.push(['Dashboard compatibility', compatibilitySummary])
  }

  if (compatibilityAdvisory) {
    entries.push(['Status metadata', compatibilityAdvisory])
  }

  if (shouldFlagAttention) {
    entries.push(['State', 'attention'])
  }

  return entries
}

function buildProjectDetail(route, detailState) {
  const projectDetail = detailState?.projectDetail ?? null

  if (!projectDetail) {
    return buildNotFoundDetail(
      `Project: ${route.projectRef}`,
      'This project detail is not available yet.',
    )
  }

  const projectLabel = getProjectLabel(projectDetail, route.projectRef)
  const projectRef = getProjectRefLabel(projectDetail, route.projectRef)

  const hasSessionCount = Number.isFinite(projectDetail.session_count)

  return {
    title: `Project: ${projectLabel}`,
    description: detailState?.summaryBacked
      ? `summary-backed project detail while the dedicated detail feed recovers. ${DETAIL_HEURISTICS_TEXT}`
      : `Recent session aggregates for this project. ${DETAIL_HEURISTICS_TEXT}`,
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
      buildHostModelEntry(projectDetail),
      ['Host-model mix', formatHostModelMix(
        projectDetail.host_model_mix,
        projectDetail.host_model_mix_count,
        getExplicitPrimaryHostModelSource(projectDetail) ?? getObservedHostModelSource(projectDetail),
      )],
      ...(buildProjectLastEventEntries(projectDetail)),
      ...(hasSessionCount ? [['Project sessions', formatCountLabel(getCount(projectDetail.session_count), 'session')]] : []),
      ...buildRouteStateEntries(detailState),
    ],
  }
}

function buildSessionDetail(route, detailState) {
  const sessionDetail = detailState?.sessionDetail ?? null

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
    description: detailState?.summaryBacked
      ? `summary-backed session detail while the dedicated detail feed recovers. ${DETAIL_HEURISTICS_TEXT}`
      : `Aggregated session activity and file delta summary. ${DETAIL_HEURISTICS_TEXT}`,
    entries: [
      ['Project', sessionContext],
      ['Project ref', projectRef],
      ['Active time', formatDuration(getDurationMs(sessionDetail.active_ms))],
      ['Wait time', formatDuration(getDurationMs(sessionDetail.wait_ms))],
      ['Events', String(getCount(sessionDetail.event_count))],
      buildHostModelEntry(sessionDetail),
      ['Host-model mix', formatHostModelMix(
        sessionDetail.host_model_mix,
        sessionDetail.host_model_mix_count,
        getExplicitPrimaryHostModelSource(sessionDetail) ?? getObservedHostModelSource(sessionDetail),
      )],
      ['Last host', getDisplayHost(pickText(sessionDetail.last_host, sessionDetail.host))],
      ['Last model', getUnknownText(pickText(sessionDetail.last_model_name, sessionDetail.model_name))],
      ['Last branch', pickText(sessionDetail.last_git_branch, sessionDetail.git_branch, UNKNOWN_TEXT)],
      ['First event', formatOptionalTimestamp(sessionDetail.first_event_time)],
      ['Changed files', formatChangedFiles(sessionDetail)],
      ['Languages', formatLanguageSummary(sessionDetail)],
      ['Line changes', formatLineChangeSummary(sessionDetail)],
      ...(buildChangeTrackingEntries(sessionDetail)),
      ['File identifiers', FILE_IDENTIFIER_TEXT],
      ['Last event', formatOptionalTimestamp(sessionDetail.last_event_time)],
      ...buildRouteStateEntries(detailState),
    ],
  }
}

export function buildDetailEntries(route, data, detailState = null) {
  if (route.view === 'project') {
    return buildProjectDetail(route, detailState)
  }

  if (route.view === 'session') {
    return buildSessionDetail(route, detailState)
  }

  return {
    ...buildHomeDetail(data.overview),
    entries: [
      ...buildHomeDetail(data.overview).entries,
      ...buildHomeStatusEntries(data.status, data.compat, data.loadState?.status, data.errors?.status),
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
      return `${formatCountLabel(count, 'file')} . Backend preview truncated before dashboard display`
    }
    return formatCountLabel(count, 'file')
  }

  const preview = previewItems
    .slice(0, 2)
    .map((delta) => `${formatFingerprintPreview(delta.fingerprint)} +${delta.added ?? 0}/-${delta.removed ?? 0}`)
    .join(', ')

  const displayedPreviewCount = Math.min(previewItems.length, 2)
  const dashboardHiddenCount = Math.max(previewItems.length - displayedPreviewCount, 0)
  const backendHiddenCount = Math.max(count - previewItems.length, truncatedCount, 0)
  const suffixParts = []

  if (dashboardHiddenCount > 0) {
    suffixParts.push(`+${dashboardHiddenCount} more in dashboard preview`)
  }

  if (backendHiddenCount > 0) {
    suffixParts.push(`+${backendHiddenCount} more omitted by backend preview`)
  }

  const suffix = suffixParts.length ? ` . ${suffixParts.join(' . ')}` : ''
  return `${formatCountLabel(count, 'file')} . ${preview}${suffix}`
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

function formatHostModelMix(items, mixCount = null, fallbackSource = null) {
  const safeItems = Array.isArray(items) ? items : []
  const totalCount = Number.isFinite(mixCount) ? mixCount : safeItems.length

  if (totalCount <= 0) {
    return 'None'
  }

  let preview = safeItems
    .slice(0, 2)
    .map((item) => `${getDisplayHost(item.host)} / ${item.model_name} (${formatDuration(item.active_ms ?? 0)} active)`)
    .join('; ')

  if (!preview && fallbackSource) {
    preview = formatHostModelValue(fallbackSource)
  }

  return preview ? `${formatCountLabel(totalCount, 'host-model combo')} . ${preview}` : formatCountLabel(totalCount, 'host-model combo')
}

function formatSystemHealth(status) {
  const apiStatus = status.api?.status === 'ok' ? 'API ok' : 'API unavailable'
  const dbStatus = status.db?.status === 'ok' ? 'DB ok' : 'DB unavailable'
  return `${apiStatus} . ${dbStatus}`
}

function formatQueueHealth(status) {
  if (status.spool?.state_dir_exists === false) {
    return 'No local state directory yet . Hooks may not have created local spool state on this machine . pending backlog unavailable without local state yet'
  }

  const ready = status.spool?.ready ?? 0
  const processing = status.spool?.processing ?? 0
  const pending = ready + processing
  const oldestBacklogAgeSeconds = status.spool?.oldest_backlog_age_seconds ?? 0
  const quarantine = status.spool?.quarantine ?? 0
  const oldestQuarantineAgeSeconds = status.spool?.oldest_quarantine_age_seconds ?? 0

  if (pending === 0 && quarantine === 0) {
    return 'No payload backlog entries . 0 ready . 0 processing . 0 quarantine'
  }

  const quarantineSuffix = quarantine > 0
    ? ` . oldest quarantine ${formatAgeSeconds(oldestQuarantineAgeSeconds)}`
    : ''

  if (pending === 0 && quarantine > 0) {
    return `quarantine-only backlog . ${quarantine} quarantine . oldest quarantine ${formatAgeSeconds(oldestQuarantineAgeSeconds)}`
  }

  const modePrefix = quarantine > 0 ? 'mixed backlog . ' : ''
  return `${modePrefix}${pending} jobs pending . ${ready} ready . ${processing} processing . ${quarantine} quarantine . oldest backlog ${formatAgeSeconds(oldestBacklogAgeSeconds)}${quarantineSuffix}`
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
  const primaryValue = formatHostModelValue(getExplicitPrimaryHostModelSource(item))
  if (primaryValue) {
    parts.push(`Primary ${primaryValue}`)
  } else {
    const observedValue = formatHostModelValue(getObservedHostModelSource(item))
    if (observedValue) {
      parts.push(`Observed ${observedValue}`)
    } else {
    const lastHost = getDisplayHost(item.host, null)
    const lastModelName = pickText(item.model_name)
    if (lastHost || lastModelName) {
      parts.push(`Last ${lastHost ?? UNKNOWN_TEXT} / ${lastModelName ?? UNKNOWN_TEXT}`)
    }
    }
  }
  const mixSuffix = mixLength > 1
    ? ` . +${mixLength - 1} host-model combo${mixLength - 1 === 1 ? '' : 's'}`
    : ''
  return `${parts.join(' . ')}${mixSuffix}`
}
