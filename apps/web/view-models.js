import { formatDayLabel, formatDuration, formatTimestampLabel } from './formatters.js'
import { buildProjectHash, buildSessionHash } from './routes.js'

const CHANGE_TRACKING_EMPTY_TEXT = 'No file delta summary yet. This can be normal for prompt-only activity, read-only commands, or the first Codex snapshot baseline.'
const FILE_IDENTIFIER_TEXT = 'Fingerprints are privacy-safe file IDs, not raw paths or source excerpts.'
const UNKNOWN_TEXT = 'unknown'
const NOT_RECORDED_YET_TEXT = 'Not recorded yet'
const DETAIL_HEURISTICS_TEXT = 'Metrics stay compact and heuristic rather than a full audit log.'
const SPOOL_BACKLOG_MODES = new Set([
  'missing_state_dir',
  'empty',
  'pending',
  'processing_only',
  'quarantine_only',
  'mixed',
])
const HOST_UI_DISPLAY = {
  'claude-code': { label: 'Claude Code', release: 'stable' },
  codex: { label: 'Codex', release: 'stable' },
  'gemini-cli': { label: 'Gemini CLI', release: 'experimental' },
  opencode: { label: 'OpenCode', release: 'experimental' },
}
const HOME_SUMMARY_FEED_LABELS = {
  languages: 'languages',
  models: 'models',
  hosts: 'hosts',
  projects: 'projects',
  sessions: 'recent sessions',
  timeseries: 'daily activity',
  status: 'status',
}

function getOptionsLocale(options) {
  return options?.locale ?? 'en'
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

function formatOptionalTimestamp(timestamp, locale = 'en') {
  return pickText(timestamp) ? formatTimestampLabel(timestamp, locale) : NOT_RECORDED_YET_TEXT
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

function buildProjectLastEventEntries(projectDetail, lowConfidence = false, locale = 'en') {
  const entries = []

  if (pickText(projectDetail?.last_host)) {
    entries.push(['Last host', getDisplayHost(projectDetail.last_host)])
  } else if (pickText(projectDetail?.host)) {
    entries.push(['Observed host', getDisplayHost(projectDetail.host)])
  }
  if (pickText(projectDetail?.last_model_name)) {
    entries.push(['Last model', projectDetail.last_model_name])
  } else if (pickText(projectDetail?.model_name)) {
    entries.push(['Observed model', projectDetail.model_name])
  }
  if (!lowConfidence && pickText(projectDetail?.last_git_branch)) {
    entries.push(['Last branch', projectDetail.last_git_branch])
  } else if (!lowConfidence && pickText(projectDetail?.git_branch)) {
    entries.push(['Observed branch', projectDetail.git_branch])
  }
  if (pickText(projectDetail?.last_event_time)) {
    entries.push(['Last event', formatOptionalTimestamp(projectDetail.last_event_time, locale)])
  }

  return entries
}

function buildNamedDurationLines(items, emptyLine, locale = 'en') {
  const safeItems = getItems(items)

  if (!safeItems.length) {
    return [emptyLine]
  }

  return safeItems.map((item) => `${item.name}: ${formatDuration(getDurationMs(item.active_ms), locale)}`)
}

export function buildOverviewLines(overview, options = {}) {
  const safeOverview = normalizeOverview(overview)
  const locale = getOptionsLocale(options)

  return [
    `Total events: ${safeOverview.totals.events}`,
    `Total active: ${formatDuration(safeOverview.totals.active_ms, locale)}`,
    `Total wait: ${formatDuration(safeOverview.totals.wait_ms, locale)}`,
    `Today active: ${formatDuration(safeOverview.today.active_ms, locale)}`,
    `This week active: ${formatDuration(safeOverview.this_week.active_ms, locale)}`,
  ]
}

export function buildLanguageLines(items) {
  const safeItems = getItems(items)

  if (!safeItems.length) {
    return ['No language data yet.']
  }

  return safeItems.map((item) => `${item.name}: ${item.changed}`)
}

export function buildModelLines(items, options = {}) {
  return buildNamedDurationLines(items, 'No model data yet.', getOptionsLocale(options))
}

export function buildHostLines(items, options = {}) {
  const safeItems = getItems(items)
  const locale = getOptionsLocale(options)

  if (!safeItems.length) {
    return ['No host data yet.']
  }

  return safeItems.map((item) => `${getDisplayHost(item.name, item.name ?? UNKNOWN_TEXT)}: ${formatDuration(getDurationMs(item.active_ms), locale)}`)
}

export function buildProjectListItems(items, options = {}) {
  const safeItems = getItems(items).filter((item) => pickText(item?.project_ref))
  const locale = getOptionsLocale(options)

  if (!safeItems.length) {
    return []
  }

  return safeItems.map((item) => ({
    href: buildProjectHash(item.project_ref),
    label: getProjectLabel(item),
    meta: formatProjectMeta(item, locale),
  }))
}

export function buildRecentSessionItems(items, options = {}) {
  const safeItems = getItems(items).filter((item) => pickText(item?.project_ref) && pickText(item?.session_id))
  const locale = getOptionsLocale(options)

  if (!safeItems.length) {
    return []
  }

  return safeItems.map((item) => ({
    href: buildSessionHash(item.session_id, item.project_ref),
    label: `${getProjectLabel(item)} / ${getSessionIdLabel(item)}`,
    meta: formatRecentSessionMeta(item, locale),
  }))
}

function buildNotFoundDetail(title, description) {
  return {
    title,
    description,
    entries: [['Status', 'Not found in current dashboard snapshot']],
  }
}

function buildHomeDetail(overview, locale = 'en') {
  const safeOverview = normalizeOverview(overview)
  return {
    title: 'Home overview',
    description: 'Current Clipulse alpha snapshot across all tracked agent activity.',
    entries: [
      ['Total events', String(safeOverview.totals.events)],
      ['Total active', formatDuration(safeOverview.totals.active_ms, locale)],
      ['Total wait', formatDuration(safeOverview.totals.wait_ms, locale)],
      ['Today active', formatDuration(safeOverview.today.active_ms, locale)],
      ['This week active', formatDuration(safeOverview.this_week.active_ms, locale)],
    ],
  }
}

function getQueueNote(status) {
  if (pickText(status?.spool?.status)?.toLowerCase() === 'degraded') {
    return 'status degraded'
  }

  const backlogMode = getSpoolBacklogMode(status)

  if (backlogMode === 'missing_state_dir') {
    return 'no local state yet'
  }
  if (backlogMode === 'empty') {
    return 'queue clear'
  }
  if (backlogMode === 'processing_only') {
    return 'processing only'
  }
  if (backlogMode === 'quarantine_only') {
    return 'quarantine present'
  }
  if (backlogMode === 'mixed') {
    return 'mixed backlog'
  }

  return 'pending backlog'
}

function getCompatibilityNote(status, compat) {
  const compatSourceKind = getCompatSourceKind(status, compat)

  if (compat?.mode === 'remote') {
    return 'remote contract'
  }
  if (compat?.mode === 'mixed' && compat?.usingFallback) {
    return 'fallback active'
  }
  if (compat?.mode === 'built-in' && compatSourceKind === 'pending_refresh') {
    return 'refresh pending'
  }
  if (compat?.mode === 'built-in') {
    return 'built-in fallback'
  }

  return null
}

function collectHostRelease(releases, host) {
  const release = getHostUiDisplay(host)?.release
  if (release) {
    releases.add(release)
  }
}

function getProfileHostReleases(data) {
  const releases = new Set()

  for (const item of getItems(data?.sessions?.items)) {
    for (const host of [item?.host_model_primary?.host, item?.host, item?.last_host]) {
      collectHostRelease(releases, host)
    }
  }

  for (const item of getItems(data?.projects?.items)) {
    for (const host of [item?.host_model_primary?.host, item?.host, item?.last_host]) {
      collectHostRelease(releases, host)
    }
  }

  for (const item of getItems(data?.hosts?.items)) {
    collectHostRelease(releases, item?.name)
  }

  return releases
}

function getHomeSummaryFeedFailures(data) {
  const failures = []

  for (const [key, label] of Object.entries(HOME_SUMMARY_FEED_LABELS)) {
    if (data?.loadState?.[key] === 'rejected') {
      failures.push(label)
    }
  }

  return failures
}

function formatRuntimeProfile(data) {
  const backlogMode = data?.status ? getSpoolBacklogMode(data.status) : null
  const compatMode = pickText(data?.compat?.mode)
  const releases = getProfileHostReleases(data)
  const failures = getHomeSummaryFeedFailures(data)
  const parts = []

  if (failures.length > 0) {
    parts.push('summary feeds degraded')
  }
  if (compatMode === 'built-in' || compatMode === 'mixed') {
    parts.push('compatibility fallback active')
  }
  if (backlogMode === 'mixed' || backlogMode === 'quarantine_only') {
    parts.push('operator attention required')
  } else if (backlogMode === 'pending' || backlogMode === 'processing_only') {
    parts.push('backlog pending')
  }
  if (releases.has('stable') && releases.has('experimental')) {
    parts.push('mixed stable + experimental activity')
  } else if (releases.has('experimental')) {
    parts.push('experimental activity')
  }

  if (parts.length === 0) {
    return 'healthy local stable'
  }

  return parts.join(' . ')
}

function formatOperatorSummary(data) {
  const failures = getHomeSummaryFeedFailures(data)
  const releases = getProfileHostReleases(data)
  const parts = []

  if (failures.length > 0) {
    parts.push(`Summary feeds degraded: ${failures.join(', ')}.`)
  }
  if (releases.has('stable') && releases.has('experimental')) {
    parts.push('Activity mix spans stable and experimental hosts.')
  } else if (releases.has('experimental')) {
    parts.push('Activity currently depends on experimental hosts.')
  }

  return parts.length > 0 ? parts.join(' ') : null
}

function buildHomeSummaryEntries(data) {
  const entries = []
  const runtimeProfile = formatRuntimeProfile(data)
  const queueNote = data?.status ? getQueueNote(data.status) : null
  const compatibilityNote = getCompatibilityNote(data?.status, data?.compat)
  const operatorSummary = formatOperatorSummary(data)

  if (runtimeProfile) {
    entries.push(['Runtime profile', runtimeProfile])
  }
  if (operatorSummary) {
    entries.push(['Operator summary', operatorSummary])
  }
  if (queueNote) {
    entries.push(['Queue note', queueNote])
  }
  if (compatibilityNote) {
    entries.push(['Compatibility', compatibilityNote])
  }

  return entries
}

export function formatCompatibilitySummary(compat) {
  if (!compat || !pickText(compat.mode)) {
    return null
  }

  const metaLabel = pickText(compat.metaLabel)
  const fallbackSectionsLabel = pickText(compat.fallbackSectionsLabel)
  const sourceKind = pickText(compat.source_kind)?.toLowerCase() ?? ''
  const compatSource = pickText(compat.source)?.toLowerCase() ?? ''
  const remoteMetaText = metaLabel ? ` via ${metaLabel}` : ''
  const builtInMetaText = metaLabel ? ` (${metaLabel})` : ''
  const fallbackScopeText = fallbackSectionsLabel ? ` for ${fallbackSectionsLabel}` : ''
  const hasHashDrift = sourceKind === 'hash_drift' || compatSource.includes('hash drift')

  if (compat.mode === 'remote') {
    if (hasHashDrift) {
      return `Remote contract active${remoteMetaText}, but /api/v1/status reports compat hash drift.`
    }

    return `Remote contract active${remoteMetaText}.`
  }

  if (compat.mode === 'mixed') {
    const fallbackText = fallbackSectionsLabel
      ? `, with built-in fallback for ${fallbackSectionsLabel}`
      : ', with built-in fallback still active'
    const driftText = hasHashDrift ? ' /api/v1/status also reports compat hash drift.' : '.'
    return `Remote contract active${remoteMetaText}${fallbackText}${driftText}`
  }

  if (sourceKind === 'pending_refresh' || compatSource.includes('pending')) {
    return `Dashboard compatibility is using the bundled contract${fallbackScopeText} while the remote contract refresh is still pending${builtInMetaText}.`
  }

  if (
    sourceKind === 'fetch_failed'
    || sourceKind === 'invalid_json'
    || compatSource.includes('fetch failed')
    || compatSource.includes('invalid json')
    || compatSource.includes('could not be read')
  ) {
    return `Built-in compatibility fallback active${fallbackScopeText} because the remote contract fetch failed${builtInMetaText}.`
  }

  return `Built-in compatibility fallback active${fallbackScopeText}${builtInMetaText}.`
}

function formatStatusCompatAdvisory(status, compat) {
  const pointer = pickText(status?.compat?.pointer)
  const reportedHash = pickText(status?.compat?.hash)
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
  const loadedHash = pickText(compat?.hash)
  const hasHashDrift = reportedHash && loadedHash && reportedHash !== loadedHash

  if (!pointer && !reportedHash && !tier && !artifactVersion && sectionCount === null && surfaces.length === 0 && artifactSections.length === 0) {
    return null
  }

  if (compat?.mode === 'remote' && !hasHashDrift) {
    return null
  }

  const suffix = artifactVersion && sectionCount !== null
    ? ` @ ${artifactVersion} (${sectionCount} sections)`
    : artifactVersion
      ? ` @ ${artifactVersion}`
      : sectionCount !== null
        ? ` (${sectionCount} sections)`
        : ''
  const hashText = reportedHash ? ` hash=${reportedHash}` : ''
  const driftText = hasHashDrift ? ` loaded_hash=${loadedHash} (hash drift)` : ''
  const tierText = tier ? ` tier=${tier}` : ''
  const surfacesText = surfaces.length ? ` surfaces=${surfaces.join('/')}` : ''
  const sectionsText = artifactSections.length ? ` sections=${artifactSections.join('/')}` : ''

  return `API reports ${pointer ?? '/api/v1/status compat metadata'}${suffix}${hashText}${driftText}${tierText}${surfacesText}${sectionsText}.`
}

function hasSpoolAttention(status) {
  if (pickText(status?.spool?.status)?.toLowerCase() === 'degraded') {
    return true
  }
  const backlogMode = getSpoolBacklogMode(status)
  return backlogMode === 'quarantine_only' || backlogMode === 'mixed'
}

function hasSpoolPartial(status) {
  const backlogMode = getSpoolBacklogMode(status)
  return backlogMode === 'pending' || backlogMode === 'processing_only'
}

function deriveSpoolBacklogMode(status) {
  if (status?.spool?.state_dir_exists === false) {
    return 'missing_state_dir'
  }

  const ready = status?.spool?.ready ?? 0
  const processing = status?.spool?.processing ?? 0
  const quarantine = status?.spool?.quarantine ?? 0
  const pending = ready + processing

  if (pending === 0 && quarantine === 0) {
    return 'empty'
  }

  if (ready === 0 && processing > 0 && quarantine === 0) {
    return 'processing_only'
  }

  if (pending === 0 && quarantine > 0) {
    return 'quarantine_only'
  }

  if (pending > 0 && quarantine > 0) {
    return 'mixed'
  }

  return 'pending'
}

function getSpoolBacklogMode(status) {
  const explicitMode = pickText(status?.spool?.backlog_mode)
  if (explicitMode && SPOOL_BACKLOG_MODES.has(explicitMode)) {
    return explicitMode
  }

  return deriveSpoolBacklogMode(status)
}

function getSpoolBacklogMismatchMessage(status) {
  const explicitMode = pickText(status?.spool?.backlog_mode)
  if (!explicitMode || !SPOOL_BACKLOG_MODES.has(explicitMode)) {
    return null
  }

  const derivedMode = deriveSpoolBacklogMode(status)
  if (explicitMode === derivedMode) {
    return null
  }

  return `Queue status metadata does not match spool counts (reported ${explicitMode}, derived ${derivedMode}).`
}

function getCompatSourceKind(status, compat) {
  return pickText(status?.compat?.source_kind, compat?.source_kind)?.toLowerCase() ?? null
}

function getHostMaturity(detail) {
  const releases = new Set()

  for (const host of [
    detail?.host_model_primary?.host,
    detail?.host,
    detail?.last_host,
    ...(Array.isArray(detail?.host_model_mix) ? detail.host_model_mix.map((item) => item?.host) : []),
  ]) {
    const release = getHostUiDisplay(host)?.release
    if (release) {
      releases.add(release)
    }
  }

  if (releases.has('stable') && releases.has('experimental')) {
    return 'stable + experimental'
  }

  if (releases.has('stable')) {
    return 'stable only'
  }

  if (releases.has('experimental')) {
    return 'experimental only'
  }

  return null
}

function isLowConfidenceDetail(detailState) {
  if (detailState?.summaryBacked === true) {
    return true
  }

  const completeness = pickText(detailState?.completeness)?.toLowerCase() ?? ''
  return completeness.includes('summary-backed') || completeness.includes('compact summary payload')
}

function buildHomeStatusEntries(status, compat, statusLoadState = 'fulfilled', statusError = null, summaryFeedFailures = []) {
  const entries = []
  const compatibilitySummary = formatCompatibilitySummary({
    ...compat,
    source_kind: getCompatSourceKind(status, compat),
  })
  const compatibilityAdvisory = formatStatusCompatAdvisory(status, compat)
  const backlogMismatchMessage = getSpoolBacklogMismatchMessage(status)
  const statusFeedInvalid = statusError?.code === 'invalid_summary_payload' || statusError?.code === 'invalid_json_response'
  const compatSourceKind = getCompatSourceKind(status, compat)
  const compatPending = compat?.mode === 'built-in' && compatSourceKind === 'pending_refresh'
  const shouldFlagPartial = hasSpoolPartial(status) || summaryFeedFailures.length > 0
  const shouldFlagAttention = (
    (compat?.mode === 'built-in' && !compatPending)
    || (compat?.mode === 'mixed' && compat?.usingFallback)
    || compatSourceKind === 'hash_drift'
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

  const flushHealth = formatFlushHealth(status)
  if (flushHealth) {
    entries.push(['Flush health', flushHealth])
  }

  if (compatibilitySummary) {
    entries.push(['Dashboard compatibility', compatibilitySummary])
  }

  const metadataItems = [compatibilityAdvisory, backlogMismatchMessage].filter(Boolean)
  if (metadataItems.length > 0) {
    entries.push(['Status metadata', metadataItems.join(' ')])
  }

  const localDiagnostics = formatLocalDiagnostics(status)
  if (localDiagnostics) {
    entries.push(['Local diagnostics', localDiagnostics])
  }

  if (shouldFlagAttention) {
    entries.push(['State', 'attention'])
  } else if (shouldFlagPartial || compatPending) {
    entries.push(['State', 'partial'])
  }

  return entries
}

function buildProjectDetail(route, detailState, locale = 'en') {
  const projectDetail = detailState?.projectDetail ?? null

  if (!projectDetail) {
    return buildNotFoundDetail(
      `Project: ${route.projectRef}`,
      'This project detail is not available yet.',
    )
  }

  const projectLabel = getProjectLabel(projectDetail, route.projectRef)
  const projectRef = getProjectRefLabel(projectDetail, route.projectRef)
  const lowConfidence = isLowConfidenceDetail(detailState)
  const hostMaturity = getHostMaturity(projectDetail)

  const hasSessionCount = Number.isFinite(projectDetail.session_count)

  return {
    title: `Project: ${projectLabel}`,
    description: detailState?.summaryBacked
      ? `summary-backed project detail while the dedicated detail feed recovers. ${DETAIL_HEURISTICS_TEXT}`
      : `Recent session aggregates for this project. ${DETAIL_HEURISTICS_TEXT}`,
    entries: [
      ['Project ref', projectRef],
      ['Active time', formatDuration(getDurationMs(projectDetail.active_ms), locale)],
      ['Wait time', formatDuration(getDurationMs(projectDetail.wait_ms), locale)],
      ['Events', String(getCount(projectDetail.event_count))],
      ['Route summary', buildRouteSummary(projectDetail, locale)],
      ...(hasSessionCount ? [['Sessions', String(getCount(projectDetail.session_count))]] : []),
      ['Changed files', formatChangedFiles(projectDetail)],
      ['Languages', formatLanguageSummary(projectDetail)],
      ['Line changes', formatLineChangeSummary(projectDetail)],
      ...(buildChangeTrackingEntries(projectDetail)),
      buildHostModelEntry(projectDetail),
      ...(hostMaturity ? [['Host maturity', hostMaturity]] : []),
      ['Host-model mix', formatHostModelMix(
        projectDetail.host_model_mix,
        projectDetail.host_model_mix_count,
        getExplicitPrimaryHostModelSource(projectDetail) ?? getObservedHostModelSource(projectDetail),
        locale,
      )],
      ...(lowConfidence ? [['Coverage note', 'Summary-backed detail only shows high-confidence fields. Branch, first event, and file identifiers may be omitted.']] : []),
      ...(!lowConfidence ? [['File identifiers', FILE_IDENTIFIER_TEXT]] : []),
      ...(pickText(projectDetail?.last_event_name) ? [['Last event type', projectDetail.last_event_name]] : []),
      ...(buildProjectLastEventEntries(projectDetail, lowConfidence, locale)),
      ...(hasSessionCount ? [['Project sessions', formatCountLabel(getCount(projectDetail.session_count), 'session')]] : []),
      ...buildRouteStateEntries(detailState),
    ],
  }
}

function buildSessionDetail(route, detailState, locale = 'en') {
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
  const lowConfidence = isLowConfidenceDetail(detailState)
  const hostMaturity = getHostMaturity(sessionDetail)
  const hostModelMix = formatHostModelMix(
    sessionDetail.host_model_mix,
    sessionDetail.host_model_mix_count,
    getExplicitPrimaryHostModelSource(sessionDetail) ?? getObservedHostModelSource(sessionDetail),
    locale,
  )

  return {
    title: `Session: ${titleSuffix}`,
    description: detailState?.summaryBacked
      ? `summary-backed session detail while the dedicated detail feed recovers. ${DETAIL_HEURISTICS_TEXT}`
      : `Aggregated session activity and file delta summary. ${DETAIL_HEURISTICS_TEXT}`,
    entries: [
      ['Project', sessionContext],
      ['Project ref', projectRef],
      ['Active time', formatDuration(getDurationMs(sessionDetail.active_ms), locale)],
      ['Wait time', formatDuration(getDurationMs(sessionDetail.wait_ms), locale)],
      ['Events', String(getCount(sessionDetail.event_count))],
      ['Route summary', buildRouteSummary(sessionDetail, locale)],
      buildHostModelEntry(sessionDetail),
      ...(hostMaturity ? [['Host maturity', hostMaturity]] : []),
      ...((!lowConfidence || hostModelMix !== 'None') ? [['Host-model mix', hostModelMix]] : []),
      [
        pickText(sessionDetail.last_host) ? 'Last host' : pickText(sessionDetail.host) ? 'Observed host' : 'Last host',
        getDisplayHost(pickText(sessionDetail.last_host, sessionDetail.host)),
      ],
      [
        pickText(sessionDetail.last_model_name) ? 'Last model' : pickText(sessionDetail.model_name) ? 'Observed model' : 'Last model',
        getUnknownText(pickText(sessionDetail.last_model_name, sessionDetail.model_name)),
      ],
      ...(!lowConfidence ? [[
        pickText(sessionDetail.last_git_branch) ? 'Last branch' : pickText(sessionDetail.git_branch) ? 'Observed branch' : 'Last branch',
        pickText(sessionDetail.last_git_branch, sessionDetail.git_branch, UNKNOWN_TEXT),
      ]] : []),
      ...(!lowConfidence ? [['First event', formatOptionalTimestamp(sessionDetail.first_event_time, locale)]] : []),
      ['Changed files', formatChangedFiles(sessionDetail)],
      ['Languages', formatLanguageSummary(sessionDetail)],
      ['Line changes', formatLineChangeSummary(sessionDetail)],
      ...(buildChangeTrackingEntries(sessionDetail)),
      ...(lowConfidence ? [['Coverage note', 'Summary-backed detail only shows high-confidence fields. Branch, first event, and file identifiers may be omitted.']] : []),
      ...(!lowConfidence ? [['File identifiers', FILE_IDENTIFIER_TEXT]] : []),
      ...(pickText(sessionDetail?.last_event_name) ? [['Last event type', sessionDetail.last_event_name]] : []),
      ['Last event', formatOptionalTimestamp(sessionDetail.last_event_time, locale)],
      ...buildRouteStateEntries(detailState),
    ],
  }
}

export function buildDetailEntries(route, data, detailState = null, options = {}) {
  const locale = getOptionsLocale(options)
  if (route.view === 'project') {
    return buildProjectDetail(route, detailState, locale)
  }

  if (route.view === 'session') {
    return buildSessionDetail(route, detailState, locale)
  }

  return {
    ...buildHomeDetail(data.overview, locale),
    entries: [
      ...buildHomeDetail(data.overview, locale).entries,
      ...buildHomeSummaryEntries(data),
      ...buildHomeStatusEntries(
        data.status,
        data.compat,
        data.loadState?.status,
        data.errors?.status,
        getHomeSummaryFeedFailures(data),
      ),
    ],
  }
}

export function buildTimeseriesRows(items, options = {}) {
  const safeItems = getItems(items)
  const locale = getOptionsLocale(options)

  if (!safeItems.length) {
    return []
  }

  const maxActiveMs = Math.max(...safeItems.map((item) => item.active_ms), 0)

  return safeItems.map((item) => ({
    dateLabel: formatDayLabel(item.date, locale),
    summary: `${formatDuration(item.active_ms, locale)} active . ${item.events} events`,
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

function getLineChangeCount(item) {
  if (Number.isFinite(item?.lines_changed)) {
    return item.lines_changed
  }

  if (Number.isFinite(item?.lines_added) || Number.isFinite(item?.lines_removed)) {
    return getCount(item?.lines_added) + getCount(item?.lines_removed)
  }

  return 0
}

function getHostModelMixCount(item) {
  if (Number.isFinite(item?.host_model_mix_count)) {
    return item.host_model_mix_count
  }

  if (Array.isArray(item?.host_model_mix)) {
    return item.host_model_mix.length
  }

  return item?.host_model_primary ? 1 : 0
}

function buildCompactSummaryTokens(item, options = {}) {
  const {
    includeCountFallback = false,
    includeFileCount = true,
    includeHostModelMixCount = false,
    includeLastEvent = false,
    includeWait = false,
  } = options
  const locale = getOptionsLocale(options)
  const parts = [`${formatDuration(getDurationMs(item?.active_ms), locale)} active`]

  if (includeWait && getDurationMs(item?.wait_ms) > 0) {
    parts.push(`${formatDuration(getDurationMs(item.wait_ms), locale)} wait`)
  }

  const lineCount = getLineChangeCount(item)
  if (lineCount > 0) {
    parts.push(`${lineCount} lines`)
  }

  if (pickText(item?.top_language?.name)) {
    parts.push(item.top_language.name)
  }

  if (includeFileCount && getCount(item?.changed_files_count) > 0) {
    parts.push(formatCountLabel(item.changed_files_count, 'file'))
  } else if (includeCountFallback) {
    parts.push(`${getCount(item?.events ?? item?.event_count)} events`)
  }

  if (includeLastEvent && pickText(item?.last_event_time)) {
    parts.push(`Last event ${formatOptionalTimestamp(item.last_event_time, locale)}`)
  }

  const hostModelMixCount = getHostModelMixCount(item)
  if (includeHostModelMixCount && hostModelMixCount > 0) {
    parts.push(formatCountLabel(hostModelMixCount, 'host-model combo'))
  }

  return parts
}

function buildRouteSummary(detail, locale = 'en') {
  return buildCompactSummaryTokens(detail, {
    includeFileCount: false,
    includeHostModelMixCount: true,
    includeLastEvent: true,
    includeWait: true,
    locale,
  }).join(' . ')
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

function formatHostModelMix(items, mixCount = null, fallbackSource = null, locale = 'en') {
  const safeItems = Array.isArray(items) ? items : []
  const totalCount = Number.isFinite(mixCount) ? mixCount : safeItems.length

  if (totalCount <= 0) {
    return 'None'
  }

  let preview = safeItems
    .slice(0, 2)
    .map((item) => `${getDisplayHost(item.host)} / ${item.model_name} (${formatDuration(item.active_ms ?? 0, locale)} active)`)
    .join('; ')

  if (!preview && fallbackSource) {
    preview = formatHostModelValue(fallbackSource)
  }

  return preview ? `${formatCountLabel(totalCount, 'host-model combo')} . ${preview}` : formatCountLabel(totalCount, 'host-model combo')
}

function formatSystemHealth(status) {
  const apiStatus = status.api?.status === 'ok' ? 'API ok' : 'API unavailable'
  const dbStatus = status.db?.status === 'ok' ? 'DB ok' : 'DB unavailable'
  const latestEventAgeSeconds = Number.isFinite(status?.db?.latest_event_age_seconds)
    ? status.db.latest_event_age_seconds
    : null
  const latestEventText = latestEventAgeSeconds !== null
    ? `latest event ${formatAgeSeconds(latestEventAgeSeconds)} ago`
    : null
  return [apiStatus, dbStatus, latestEventText].filter(Boolean).join(' . ')
}

function formatQueueHealth(status) {
  if (pickText(status?.spool?.status)?.toLowerCase() === 'degraded') {
    const degradedMessage = pickText(
      status?.spool?.error_message,
      'spool status is degraded; inspect server logs for details.',
    )
    return `degraded . ${degradedMessage}`
  }

  const backlogMode = getSpoolBacklogMode(status)

  if (backlogMode === 'missing_state_dir') {
    return 'No local state directory yet . Hooks may not have created local spool state on this machine . pending backlog unavailable without local state yet'
  }

  const ready = status.spool?.ready ?? 0
  const processing = status.spool?.processing ?? 0
  const pending = ready + processing
  const oldestBacklogAgeSeconds = status.spool?.oldest_backlog_age_seconds ?? 0
  const quarantine = status.spool?.quarantine ?? 0
  const oldestQuarantineAgeSeconds = status.spool?.oldest_quarantine_age_seconds ?? 0

  if (backlogMode === 'empty') {
    return 'No payload backlog entries . 0 ready . 0 processing . 0 quarantine'
  }

  const quarantineSuffix = quarantine > 0
    ? ` . oldest quarantine ${formatAgeSeconds(oldestQuarantineAgeSeconds)}`
    : ''

  if (backlogMode === 'quarantine_only') {
    return `quarantine-only backlog . ${quarantine} quarantine . oldest quarantine ${formatAgeSeconds(oldestQuarantineAgeSeconds)}`
  }

  if (backlogMode === 'processing_only') {
    return `processing-only backlog . ${processing} processing . 0 ready . ${quarantine} quarantine . oldest backlog ${formatAgeSeconds(oldestBacklogAgeSeconds)}${quarantineSuffix}`
  }

  const modePrefix = backlogMode === 'mixed' ? 'mixed backlog . ' : ''
  return `${modePrefix}${pending} jobs pending . ${ready} ready . ${processing} processing . ${quarantine} quarantine . oldest backlog ${formatAgeSeconds(oldestBacklogAgeSeconds)}${quarantineSuffix}`
}

function formatQueueStorage(status) {
  const readyBytes = status.spool?.ready_bytes ?? 0
  const processingBytes = status.spool?.processing_bytes ?? 0
  const quarantineBytes = status.spool?.quarantine_bytes ?? 0
  const totalBytes = readyBytes + processingBytes + quarantineBytes
  const stateDir = status.spool?.state_dir === '<redacted>'
    ? ' . server-local path redacted'
    : status.spool?.state_dir
      ? ` . ${status.spool.state_dir}`
      : ''
  return `${formatBytes(totalBytes)} payload spool . ${formatBytes(quarantineBytes)} quarantined${stateDir}`
}

function formatFlushHealth(status) {
  if (pickText(status?.spool?.status)?.toLowerCase() === 'degraded') {
    return null
  }

  const oldestReadyAgeSeconds = Number.isFinite(status?.spool?.oldest_ready_age_seconds)
    ? status.spool.oldest_ready_age_seconds
    : 0
  const oldestProcessingAgeSeconds = Number.isFinite(status?.spool?.oldest_processing_age_seconds)
    ? status.spool.oldest_processing_age_seconds
    : 0
  const maxAttemptCount = Number.isFinite(status?.spool?.max_attempt_count)
    ? status.spool.max_attempt_count
    : 0

  if (oldestReadyAgeSeconds <= 0 && oldestProcessingAgeSeconds <= 0 && maxAttemptCount <= 0) {
    return null
  }

  const parts = []
  if (oldestReadyAgeSeconds > 0) {
    parts.push(`oldest ready ${formatAgeSeconds(oldestReadyAgeSeconds)}`)
  }
  if (oldestProcessingAgeSeconds > 0) {
    parts.push(`oldest processing ${formatAgeSeconds(oldestProcessingAgeSeconds)}`)
  }
  if (maxAttemptCount > 0) {
    parts.push(`max attempts ${maxAttemptCount}`)
  }

  return parts.join(' . ')
}

function formatLocalDiagnostics(status) {
  const orphanSidecars = status?.spool?.orphan_sidecars
  const orphanTotal = Number.isFinite(orphanSidecars?.total) ? orphanSidecars.total : 0
  const quarantineReasonCounts = status?.spool?.quarantine_reason_counts
  const reasonEntries = quarantineReasonCounts && typeof quarantineReasonCounts === 'object'
    ? Object.entries(quarantineReasonCounts).filter(([, count]) => Number.isFinite(count) && count > 0)
    : []
  const metaErrorCounts = status?.spool?.quarantine_meta_error_counts
  const metaErrorEntries = metaErrorCounts && typeof metaErrorCounts === 'object'
    ? Object.entries(metaErrorCounts).filter(([, count]) => Number.isFinite(count) && count > 0)
    : []
  const metadataErrorCountsByState = status?.spool?.metadata_error_counts_by_state
  const metadataErrorEntriesByState = metadataErrorCountsByState && typeof metadataErrorCountsByState === 'object'
    ? Object.entries(metadataErrorCountsByState)
      .map(([state, counts]) => {
        if (!counts || typeof counts !== 'object') {
          return null
        }

        const nonZeroEntries = Object.entries(counts).filter(([, count]) => Number.isFinite(count) && count > 0)
        if (nonZeroEntries.length === 0) {
          return null
        }

        return `${state} metadata errors ${nonZeroEntries.map(([reason, count]) => `${reason}=${count}`).join(', ')}`
      })
      .filter(Boolean)
    : []
  const oldestFirstSeenAgeSeconds = Number.isFinite(status?.spool?.oldest_first_seen_age_seconds)
    ? status.spool.oldest_first_seen_age_seconds
    : 0
  const maxAttemptCount = Number.isFinite(status?.spool?.max_attempt_count)
    ? status.spool.max_attempt_count
    : 0
  const sourceStateCounts = status?.spool?.quarantine_source_state_counts
  const sourceStateEntries = sourceStateCounts && typeof sourceStateCounts === 'object'
    ? Object.entries(sourceStateCounts).filter(([, count]) => Number.isFinite(count) && count > 0)
    : []

  if (
    orphanTotal <= 0
    && reasonEntries.length === 0
    && metaErrorEntries.length === 0
    && metadataErrorEntriesByState.length === 0
    && oldestFirstSeenAgeSeconds <= 0
    && maxAttemptCount <= 0
    && sourceStateEntries.length === 0
  ) {
    return null
  }

  const parts = []
  if (orphanTotal > 0) {
    parts.push(`${orphanTotal} orphan sidecar${orphanTotal === 1 ? '' : 's'}`)
  }
  if (reasonEntries.length > 0) {
    parts.push(`quarantine reasons ${reasonEntries.map(([reason, count]) => `${reason}=${count}`).join(', ')}`)
  }
  if (metaErrorEntries.length > 0) {
    parts.push(`quarantine metadata errors ${metaErrorEntries.map(([reason, count]) => `${reason}=${count}`).join(', ')}`)
  }
  for (const entry of metadataErrorEntriesByState) {
    parts.push(entry)
  }
  if (oldestFirstSeenAgeSeconds > 0) {
    parts.push(`oldest first seen ${formatAgeSeconds(oldestFirstSeenAgeSeconds)}`)
  }
  if (maxAttemptCount > 0) {
    parts.push(`max attempts ${maxAttemptCount}`)
  }
  if (sourceStateEntries.length > 0) {
    parts.push(`quarantine source states ${sourceStateEntries.map(([reason, count]) => `${reason}=${count}`).join(', ')}`)
  }

  return parts.join(' . ')
}

function formatAgeSeconds(seconds, locale = 'en') {
  return formatDuration((seconds ?? 0) * 1000, locale)
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

function formatProjectMeta(item, locale = 'en') {
  const parts = buildCompactSummaryTokens(item, {
    includeCountFallback: true,
    includeHostModelMixCount: getHostModelMixCount(item) > 1,
    includeLastEvent: true,
    includeWait: true,
    locale,
  })
  const hostMaturity = getHostMaturity(item)
  if (hostMaturity === 'stable + experimental') {
    parts.push('mixed hosts')
  } else if (hostMaturity === 'experimental only') {
    parts.push('experimental')
  }

  return parts.join(' . ')
}

function formatRecentSessionMeta(item, locale = 'en') {
  const mixLength = getHostModelMixCount(item)
  const hostMaturity = getHostMaturity(item)
  const parts = buildCompactSummaryTokens(item, {
    includeLastEvent: true,
    includeWait: true,
    locale,
  })
  const primaryValue = formatHostModelValue(getExplicitPrimaryHostModelSource(item))
  if (primaryValue) {
    parts.push(`Primary ${primaryValue}`)
  } else {
    const observedValue = formatHostModelValue(getObservedHostModelSource(item))
    if (observedValue) {
      parts.push(`Observed ${observedValue}`)
    } else {
      const lastHost = getDisplayHost(item.last_host, null)
      const lastModelName = pickText(item.last_model_name)
      if (lastHost || lastModelName) {
        parts.push(`Last ${lastHost ?? UNKNOWN_TEXT} / ${lastModelName ?? UNKNOWN_TEXT}`)
      } else {
        const observedHost = getDisplayHost(item.host, null)
        const observedModelName = pickText(item.model_name)
        if (observedHost || observedModelName) {
          parts.push(`Observed ${observedHost ?? UNKNOWN_TEXT} / ${observedModelName ?? UNKNOWN_TEXT}`)
        }
      }
    }
  }
  const mixSuffix = mixLength > 1
    ? ` . ${formatCountLabel(mixLength, 'host-model combo')}`
    : ''
  const maturitySuffix = hostMaturity === 'stable + experimental'
    ? ' . mixed hosts'
    : hostMaturity === 'experimental only'
      ? ' . experimental'
      : ''
  return `${parts.join(' . ')}${mixSuffix}${maturitySuffix}`
}
