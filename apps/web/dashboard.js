import {
  renderDetailPanel,
  renderLinkList,
  renderMetricList,
  renderSectionTitle,
  renderTimeseries,
} from './dom.js'
import {
  buildHostLines,
  buildLanguageLines,
  buildModelLines,
  buildOverviewLines,
  buildProjectListItems,
  buildRecentSessionItems,
  buildTimeseriesRows,
  buildDetailEntries,
  formatCompatibilitySummary,
} from './view-models.js'
import { buildHomeHash, buildProjectHash, buildSessionHash, parseDashboardHash } from './routes.js'
import { getProjectSessionListPaths, getRecentSessionListPaths } from './session-list-paths.js'

const DASHBOARD_COMPAT_FALLBACK = {
  languageBreakdownItem: {
    text: ['name'],
    number: ['changed'],
  },
  modelBreakdownItem: {
    text: ['name'],
    number: ['active_ms', 'events'],
  },
  hostBreakdownItem: {
    text: ['name'],
    number: ['active_ms', 'events'],
  },
  projectTopItem: {
    text: ['project_name', 'project_ref'],
    number: ['active_ms'],
    anyNumber: [{ label: 'changed_files_count/events', fields: ['changed_files_count', 'events'] }],
  },
  sessionListItem: {
    text: ['session_id', 'project_name', 'project_ref'],
    number: ['active_ms'],
    anyText: [{ label: 'host', fields: ['host', 'last_host'] }],
    anyNumber: [{ label: 'event_count/events', fields: ['event_count', 'events'] }],
  },
  projectDetail: {
    text: ['project_name', 'project_ref'],
    number: [
      'active_ms',
      'wait_ms',
      'session_count',
      'changed_files_count',
      'changed_languages_count',
      'lines_added',
      'lines_removed',
      'lines_changed',
    ],
    anyNumber: [{ label: 'event_count/events', fields: ['event_count', 'events'] }],
  },
  sessionDetail: {
    text: ['session_id', 'project_name', 'project_ref', 'last_event_time'],
    number: [
      'active_ms',
      'wait_ms',
      'changed_files_count',
      'changed_languages_count',
      'lines_added',
      'lines_removed',
      'lines_changed',
    ],
    anyText: [
      { label: 'host', fields: ['host', 'last_host'] },
      { label: 'model_name', fields: ['model_name', 'last_model_name'] },
      { label: 'git_branch', fields: ['git_branch', 'last_git_branch'] },
    ],
    anyNumber: [{ label: 'event_count/events', fields: ['event_count', 'events'] }],
  },
  timeseriesItem: {
    text: ['date'],
    number: ['active_ms', 'wait_ms', 'events'],
  },
}

const DASHBOARD_COMPAT_SECTION_NAMES = Object.keys(DASHBOARD_COMPAT_FALLBACK)
const DASHBOARD_COMPAT_SECTION_LABELS = {
  languageBreakdownItem: 'language breakdown',
  modelBreakdownItem: 'model breakdown',
  hostBreakdownItem: 'host breakdown',
  projectTopItem: 'top projects list',
  sessionListItem: 'recent sessions list',
  projectDetail: 'project detail',
  sessionDetail: 'session detail',
  timeseriesItem: 'activity chart',
}
const DASHBOARD_COMPAT_META_FALLBACK = {
  artifact: 'clipulse.dashboard-compat',
  version: 'v1',
  description: 'Dashboard-side compatibility contract for summary, list, and detail payload validation.',
  sections: DASHBOARD_COMPAT_SECTION_NAMES,
  section_count: DASHBOARD_COMPAT_SECTION_NAMES.length,
}

const dashboardCompatContractUrl = new URL('../../contracts/dashboard-compat.v1.json', import.meta.url)

function getSections(doc) {
  return {
    viewNav: doc.querySelector('#view-nav'),
    viewTitle: doc.querySelector('#view-title'),
    viewDescription: doc.querySelector('#view-description'),
    detailTitle: doc.querySelector('#detail-title'),
    detailDescription: doc.querySelector('#detail-description'),
    overview: doc.querySelector('#overview'),
    languages: doc.querySelector('#languages'),
    models: doc.querySelector('#models'),
    hosts: doc.querySelector('#hosts'),
    projects: doc.querySelector('#projects'),
    sessionsTitle: doc.querySelector('#sessions-title'),
    sessions: doc.querySelector('#sessions'),
    timeseries: doc.querySelector('#timeseries'),
  }
}

async function loadJson(path, fetchImpl) {
  const response = await fetchImpl(path)

  if (!response.ok) {
    let errorBody = null
    try {
      errorBody = await response.json()
    } catch {
      errorBody = null
    }
    const detailPayload = errorBody?.detail && typeof errorBody.detail === 'object'
      ? errorBody.detail
      : null

    const error = new Error(`Failed to load ${path}`)
    error.status = response.status ?? 0
    error.code = detailPayload?.code ?? null
    error.detail = detailPayload?.message ?? errorBody?.detail ?? null
    error.hint = detailPayload?.hint ?? null
    throw error
  }

  try {
    return await response.json()
  } catch {
    const error = new Error(`Failed to parse ${path}`)
    error.status = response.status ?? 0
    error.code = 'invalid_json_response'
    error.detail = 'Invalid JSON response.'
    error.hint = 'Check the API response body and JSON serialization for this endpoint.'
    throw error
  }
}

function getSettledValue(result) {
  return result.status === 'fulfilled' ? result.value : null
}

function normalizeItemsPayload(payload) {
  const safePayload = payload && typeof payload === 'object' ? payload : {}
  return {
    ...safePayload,
    items: Array.isArray(safePayload.items) ? safePayload.items : [],
  }
}

function getSettledError(result) {
  return result.status === 'rejected' ? toDetailError(result.reason) : null
}

function createInvalidItemsPayloadError(
  detail = 'Invalid list payload.',
  hint = 'Check the list endpoint response shape.',
) {
  const error = new Error(detail)
  error.status = 200
  error.code = 'invalid_list_payload'
  error.detail = detail
  error.hint = hint
  return error
}

function createInvalidSummaryPayloadError(
  detail = 'Invalid summary payload.',
  hint = 'Check the summary endpoint response shape.',
) {
  const error = new Error(detail)
  error.status = 200
  error.code = 'invalid_summary_payload'
  error.detail = detail
  error.hint = hint
  return error
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function hasNumber(value) {
  return Number.isFinite(value)
}

function hasStringArray(value) {
  return Array.isArray(value) && value.every((item) => hasText(item))
}

function hasContractGroupArray(value) {
  return Array.isArray(value) && value.every((group) => (
    hasObject(group)
    && hasText(group.label)
    && hasStringArray(group.fields)
  ))
}

function hasRequiredContractFields(remoteSection, fallbackSection) {
  for (const fieldName of fallbackSection.text ?? []) {
    if (!remoteSection.text.includes(fieldName)) {
      return false
    }
  }

  for (const fieldName of fallbackSection.number ?? []) {
    if (!remoteSection.number.includes(fieldName)) {
      return false
    }
  }

  for (const fallbackGroup of fallbackSection.anyText ?? []) {
    const remoteGroup = (remoteSection.anyText ?? []).find((group) => group.label === fallbackGroup.label)
    if (!remoteGroup || !fallbackGroup.fields.every((fieldName) => remoteGroup.fields.includes(fieldName))) {
      return false
    }
  }

  for (const fallbackGroup of fallbackSection.anyNumber ?? []) {
    const remoteGroup = (remoteSection.anyNumber ?? []).find((group) => group.label === fallbackGroup.label)
    if (!remoteGroup || !fallbackGroup.fields.every((fieldName) => remoteGroup.fields.includes(fieldName))) {
      return false
    }
  }

  return true
}

function isCompleteContractSection(remoteSection, fallbackSection) {
  if (!hasObject(remoteSection)) {
    return false
  }

  if (!hasStringArray(remoteSection.text ?? [])) {
    return false
  }

  if (!hasStringArray(remoteSection.number ?? [])) {
    return false
  }

  if (!hasContractGroupArray(remoteSection.anyText ?? [])) {
    return false
  }

  if (!hasContractGroupArray(remoteSection.anyNumber ?? [])) {
    return false
  }

  return hasRequiredContractFields(remoteSection, fallbackSection)
}

function getDashboardCompatMeta(rawMeta) {
  const sanitizeMetaToken = (value, fallback) => {
    if (!hasText(value)) {
      return fallback
    }

    const trimmedValue = value.trim()
    return /^[A-Za-z0-9._-]+$/.test(trimmedValue) ? trimmedValue : fallback
  }

  const sanitizeMetaDescription = (value, fallback) => {
    if (!hasText(value)) {
      return fallback
    }

    return value.trim().replace(/\s+/g, ' ')
  }

  const sections = hasStringArray(rawMeta?.sections)
    ? rawMeta.sections
    : DASHBOARD_COMPAT_META_FALLBACK.sections

  return {
    artifact: sanitizeMetaToken(rawMeta?.artifact, DASHBOARD_COMPAT_META_FALLBACK.artifact),
    version: sanitizeMetaToken(rawMeta?.version, DASHBOARD_COMPAT_META_FALLBACK.version),
    description: sanitizeMetaDescription(rawMeta?.description, DASHBOARD_COMPAT_META_FALLBACK.description),
    sections,
    section_count: hasNumber(rawMeta?.section_count) ? rawMeta.section_count : sections.length,
  }
}

function formatDashboardCompatMeta(meta, builtIn = false) {
  const prefix = builtIn ? 'built-in ' : ''
  return `${prefix}${meta.artifact}@${meta.version} (${meta.section_count} sections)`
}

function summarizeFallbackSections(fallbackSections) {
  if (!fallbackSections.length) {
    return 'none'
  }

  if (fallbackSections.length === DASHBOARD_COMPAT_SECTION_NAMES.length) {
    return `all ${fallbackSections.length} sections`
  }

  const labels = fallbackSections.map((sectionName) => DASHBOARD_COMPAT_SECTION_LABELS[sectionName] ?? sectionName)
  const preview = labels.slice(0, 3)
  const remainingCount = Math.max(labels.length - preview.length, 0)
  const countLabel = `${labels.length} ${labels.length === 1 ? 'section' : 'sections'}`
  const previewLabel = remainingCount > 0
    ? `${preview.join(', ')}, +${remainingCount} more`
    : preview.join(', ')

  return `${countLabel}: ${previewLabel}`
}

function resolveDashboardCompatContract(rawContract, diagnostics = {}) {
  const resolvedContract = {}
  const fallbackSections = []

  for (const sectionName of DASHBOARD_COMPAT_SECTION_NAMES) {
    const fallbackSection = DASHBOARD_COMPAT_FALLBACK[sectionName]
    const remoteSection = rawContract?.[sectionName]
    if (isCompleteContractSection(remoteSection, fallbackSection)) {
      resolvedContract[sectionName] = remoteSection
      continue
    }

    resolvedContract[sectionName] = fallbackSection
    fallbackSections.push(sectionName)
  }

  const usingFallback = fallbackSections.length > 0
  const isBuiltInOnly = !hasObject(rawContract)
  const meta = getDashboardCompatMeta(rawContract?._meta)
  const mode = isBuiltInOnly ? 'built-in' : usingFallback ? 'mixed' : 'remote'

  return {
    contract: resolvedContract,
    mode,
    usingFallback,
    fallbackSections,
    fallbackSectionsLabel: summarizeFallbackSections(fallbackSections),
    source: diagnostics.source ?? (
      usingFallback
        ? 'Remote contract loaded with mixed-version/contract-drift sections; built-in fallback remains active where needed.'
        : 'remote contract loaded.'
    ),
    meta,
    metaLabel: formatDashboardCompatMeta(isBuiltInOnly ? DASHBOARD_COMPAT_META_FALLBACK : meta, isBuiltInOnly),
  }
}

async function loadDashboardCompatContract(fetchImpl) {
  if (typeof fetchImpl !== 'function') {
    try {
      const { readFileSync } = await import('node:fs')
      return resolveDashboardCompatContract(
        JSON.parse(readFileSync(dashboardCompatContractUrl, 'utf8')),
        { source: 'Bundled dashboard contract artifact loaded from the local filesystem.' },
      )
    } catch {
      return resolveDashboardCompatContract(null, {
        source: 'Bundled dashboard contract artifact could not be read; using built-in fallback.',
      })
    }
  }

  try {
    const response = await fetchImpl(dashboardCompatContractUrl)
    if (!response?.ok) {
      return resolveDashboardCompatContract(null, {
        source: `Remote contract fetch failed with status ${response?.status ?? 0}; using built-in fallback.`,
      })
    }

    try {
      return resolveDashboardCompatContract(JSON.parse(await response.text()))
    } catch {
      return resolveDashboardCompatContract(null, {
        source: 'Remote contract returned invalid JSON; using built-in fallback.',
      })
    }
  } catch (error) {
    const message = hasText(error?.message) ? error.message : 'unknown error'
    return resolveDashboardCompatContract(null, {
      source: `Remote contract fetch failed before a response was available: ${message}; using built-in fallback.`,
    })
  }
}

function collectMissingContractFields(payload, contract) {
  const missingFields = []

  for (const fieldName of contract.text ?? []) {
    if (!hasText(payload?.[fieldName])) {
      missingFields.push(fieldName)
    }
  }

  for (const fieldName of contract.number ?? []) {
    if (!hasNumber(payload?.[fieldName])) {
      missingFields.push(fieldName)
    }
  }

  for (const group of contract.anyText ?? []) {
    if (!group.fields.some((fieldName) => hasText(payload?.[fieldName]))) {
      missingFields.push(group.label)
    }
  }

  for (const group of contract.anyNumber ?? []) {
    if (!group.fields.some((fieldName) => hasNumber(payload?.[fieldName]))) {
      missingFields.push(group.label)
    }
  }

  return missingFields
}

function normalizePayloadWithContract(payload, contract) {
  if (!hasObject(payload) || !hasObject(contract)) {
    return payload
  }

  const normalizedPayload = { ...payload }

  for (const group of contract.anyText ?? []) {
    const canonicalField = group.fields?.[0]
    if (hasText(normalizedPayload[canonicalField])) {
      continue
    }

    const aliasField = group.fields.find((fieldName) => hasText(normalizedPayload[fieldName]))
    if (aliasField && canonicalField) {
      normalizedPayload[canonicalField] = normalizedPayload[aliasField]
    }
  }

  for (const group of contract.anyNumber ?? []) {
    const canonicalField = group.fields?.[0]
    if (hasNumber(normalizedPayload[canonicalField])) {
      continue
    }

    const aliasField = group.fields.find((fieldName) => hasNumber(normalizedPayload[fieldName]))
    if (aliasField && canonicalField) {
      normalizedPayload[canonicalField] = normalizedPayload[aliasField]
    }
  }

  return normalizedPayload
}

function hasObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function validateItemsPayload(payload, hint, options = {}, contract = DASHBOARD_COMPAT_FALLBACK.sessionListItem) {
  const { projectRef = null, requireProjectName = false } = options

  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.items)) {
    throw createInvalidItemsPayloadError('Invalid list payload.', hint)
  }

  if (projectRef && (!hasText(payload.project_ref) || payload.project_ref !== projectRef)) {
    throw createInvalidItemsPayloadError('List payload does not match the current route project_ref.', hint)
  }

  if (requireProjectName && !hasText(payload.project_name)) {
    throw createInvalidItemsPayloadError('Missing required list fields: project_name', hint)
  }

  payload.items.forEach((item, index) => {
    const missingFields = collectMissingContractFields(item, contract)

    if (missingFields.length > 0) {
      throw createInvalidItemsPayloadError(
        `Missing required list item fields at index ${index}: ${missingFields.join(', ')}`,
        hint,
      )
    }

    if (projectRef && item.project_ref !== projectRef) {
      throw createInvalidItemsPayloadError(
        `List item at index ${index} does not match the current route project_ref.`,
        hint,
      )
    }
  })

  return {
    ...payload,
    items: payload.items.map((item) => normalizePayloadWithContract(item, contract)),
  }
}

function shouldRetryLegacyListPath(error) {
  if (error?.code === 'invalid_list_payload' || error?.code === 'invalid_json_response') {
    return true
  }

  return error?.status === 400
    || error?.status === 404
    || error?.status === 405
    || error?.status === 422
    || error?.status === 501
}

async function loadSessionListPayload(paths, fetchImpl, hint, options = {}, contract = DASHBOARD_COMPAT_FALLBACK.sessionListItem) {
  let lastError = null

  for (let index = 0; index < paths.length; index += 1) {
    const path = paths[index]
    try {
      const payload = await loadJson(path, fetchImpl)
      return validateItemsPayload(payload, hint, options, contract)
    } catch (error) {
      lastError = error
      const hasFallback = index < paths.length - 1
      if (!hasFallback || !shouldRetryLegacyListPath(error)) {
        throw error
      }
    }
  }

  throw lastError ?? createInvalidItemsPayloadError(hint)
}

function validateOverviewPayload(payload) {
  if (!hasObject(payload)) {
    throw createInvalidSummaryPayloadError(
      'Invalid overview payload.',
      'Check that /api/v1/overview returns an object with totals, today, or this_week windows.',
    )
  }

  if (hasObject(payload.totals) || hasObject(payload.today) || hasObject(payload.this_week)) {
    return payload
  }

  throw createInvalidSummaryPayloadError(
    'Invalid overview payload.',
    'Check that /api/v1/overview returns at least one of totals, today, or this_week as an object.',
  )
}

function validateSummaryItemsPayload(payload, label, path, contracts) {
  if (!hasObject(payload) || !Array.isArray(payload.items)) {
    throw createInvalidSummaryPayloadError(
      `Invalid ${label} payload.`,
      `Check that ${path} returns an object with an items array.`,
    )
  }

  const contract = contracts?.[label] ?? null

  payload.items.forEach((item, index) => {
    if (!hasObject(item)) {
      throw createInvalidSummaryPayloadError(
        `Invalid ${label} payload.`,
        `Check that ${path} returns an items array of objects.`,
      )
    }

    const missingFields = contract ? collectMissingContractFields(item, contract) : []
    if (missingFields.length > 0) {
      throw createInvalidSummaryPayloadError(
        `Invalid ${label} payload.`,
        `Check that ${path} item ${index} includes ${missingFields.join(', ')}.`,
      )
    }
  })

  return {
    ...payload,
    items: payload.items.map((item) => normalizePayloadWithContract(item, contract)),
  }
}

function validateStatusPayload(payload) {
  if (
    hasObject(payload?.api)
    && hasText(payload.api.status)
    && hasText(payload.api.version)
    && hasObject(payload?.db)
    && hasText(payload.db.status)
    && hasNumber(payload.db.events)
    && hasNumber(payload.db.projects)
    && hasNumber(payload.db.sessions)
    && hasObject(payload?.spool)
    && hasNumber(payload.spool.ready)
    && hasNumber(payload.spool.processing)
    && hasNumber(payload.spool.quarantine)
    && hasNumber(payload.spool.ready_bytes)
    && hasNumber(payload.spool.processing_bytes)
    && hasNumber(payload.spool.quarantine_bytes)
    && hasNumber(payload.spool.oldest_backlog_age_seconds)
    && hasNumber(payload.spool.oldest_quarantine_age_seconds)
    && (
      !Object.prototype.hasOwnProperty.call(payload, 'compat')
      || !hasObject(payload.compat)
      || (
        (!Object.prototype.hasOwnProperty.call(payload.compat, 'pointer') || hasText(payload.compat.pointer))
        && (!Object.prototype.hasOwnProperty.call(payload.compat, 'artifact_version') || hasText(payload.compat.artifact_version))
        && (!Object.prototype.hasOwnProperty.call(payload.compat, 'artifact_section_count') || hasNumber(payload.compat.artifact_section_count))
      )
    )
    && (!Object.prototype.hasOwnProperty.call(payload.spool, 'state_dir_exists') || typeof payload.spool.state_dir_exists === 'boolean')
  ) {
    return payload
  }

  throw createInvalidSummaryPayloadError(
    'Invalid status payload.',
    'Check that /api/v1/status returns api, db, and spool objects.',
  )
}

function isInvalidPayloadError(error) {
  return error?.code === 'invalid_summary_payload' || error?.code === 'invalid_json_response'
}

function getSummaryErrorText(error, invalidText, defaultText) {
  return isInvalidPayloadError(error) ? invalidText : defaultText
}

function isInvalidListError(error) {
  return error?.code === 'invalid_list_payload' || error?.code === 'invalid_json_response'
}

function getSessionListErrorText(error, invalidText, defaultText) {
  return isInvalidListError(error) ? invalidText : defaultText
}

function buildDataSnapshot(results) {
  const [overview, languages, models, hosts, projects, sessions, timeseries, status] = results

  return {
    overview: getSettledValue(overview),
    languages: normalizeItemsPayload(getSettledValue(languages)),
    models: normalizeItemsPayload(getSettledValue(models)),
    hosts: normalizeItemsPayload(getSettledValue(hosts)),
    projects: normalizeItemsPayload(getSettledValue(projects)),
    sessions: normalizeItemsPayload(getSettledValue(sessions)),
    timeseries: normalizeItemsPayload(getSettledValue(timeseries)),
    status: getSettledValue(status),
    loadState: {
      overview: overview.status,
      languages: languages.status,
      models: models.status,
      hosts: hosts.status,
      projects: projects.status,
      sessions: sessions.status,
      timeseries: timeseries.status,
      status: status.status,
    },
    errors: {
      overview: getSettledError(overview),
      languages: getSettledError(languages),
      models: getSettledError(models),
      hosts: getSettledError(hosts),
      projects: getSettledError(projects),
      sessions: getSettledError(sessions),
      timeseries: getSettledError(timeseries),
      status: getSettledError(status),
    },
  }
}

function getActiveHref(route) {
  if (route.view === 'project') {
    return buildProjectHash(route.projectRef)
  }

  if (route.view === 'session') {
    return buildSessionHash(route.sessionId, route.projectRef)
  }

  return buildHomeHash()
}

function getViewCopy(route) {
  if (route.view === 'project') {
    return {
      title: 'Project overview',
      description: 'Inspect project-level rollups and recent sessions from the latest snapshot.',
    }
  }

  if (route.view === 'session') {
    return {
      title: 'Session overview',
      description: 'Inspect one logical session and its surrounding snapshot context.',
    }
  }

  return {
    title: 'Home overview',
    description: 'Clipulse keeps this dashboard local-first, compact, and readable for daily checks. Metrics are summary-first heuristics meant for quick inspection.',
  }
}

function buildDetailFallback(route, loadState, detailState, summaryErrors = {}) {
  const detailStatus = route.view === 'project'
    ? detailState?.projectDetailStatus ?? detailState?.status
    : detailState?.status
  const detailError = route.view === 'project'
    ? detailState?.projectDetailError ?? detailState?.error
    : detailState?.error

  if ((route.view === 'project' || route.view === 'session') && detailStatus === 'idle') {
    return {
      title: route.view === 'project' ? 'Project detail loading' : 'Session detail loading',
      description: 'Clipulse is preparing the detail view for this route.',
      entries: [['Status', 'Loading detail data...']],
    }
  }

  if ((route.view === 'project' || route.view === 'session') && detailStatus === 'loading') {
    return {
      title: route.view === 'project' ? 'Project detail loading' : 'Session detail loading',
      description: 'Clipulse is loading the latest detail payload for this view.',
      entries: [['Status', 'Loading detail data...']],
    }
  }

  if ((route.view === 'project' || route.view === 'session') && detailStatus === 'error') {
    const detailLabel = detailError?.status === 0
      ? 'Network request failed before an HTTP status was returned.'
      : detailError?.detail ?? 'Unable to load detail data yet.'
    const hintLabel = detailError?.hint ?? 'Check /healthz, CLIPULSE_API_URL, /api/v1/status if the API still responds, and CLIPULSE_STATE_DIR/spool/ready.'
    const description = detailError?.status === 0
      ? 'The dedicated detail request failed before the API returned an HTTP status. Check /healthz, CLIPULSE_API_URL, and local network reachability.'
      : detailError?.code
      ? `The dedicated detail endpoint returned ${detailError.code}. Check /healthz, CLIPULSE_API_URL, /api/v1/status if the API still responds, and local backlog state.`
      : 'The dedicated detail endpoint could not be loaded. Check /healthz, CLIPULSE_API_URL, /api/v1/status if the API still responds, and whether backlog batches are still waiting in CLIPULSE_STATE_DIR/spool/ready.'
    if (route.view === 'session' && detailError?.code === 'ambiguous_session') {
      return {
        title: 'Session detail needs project scope',
        description: 'This session id matched more than one project. Open the project-scoped session link or retry with the matching project_ref.',
        entries: [
          ['Status', detailLabel],
          ['Hint', hintLabel],
        ],
      }
    }
    if (route.view === 'session' && detailError?.code === 'session_not_found') {
      return {
        title: 'Session not found',
        description: 'This session is no longer available for the selected project scope. Open the project view and choose it again from the latest list.',
        entries: [
          ['Status', detailLabel],
          ['Hint', hintLabel],
        ],
      }
    }
    if (route.view === 'project' && detailError?.code === 'project_not_found') {
      return {
        title: 'Project not found',
        description: 'This project is no longer available in the latest dashboard snapshot. Reopen the home view and pick it again.',
        entries: [
          ['Status', detailLabel],
          ['Hint', hintLabel],
        ],
      }
    }
    if (detailError?.code === 'invalid_json_response' || detailError?.code === 'invalid_detail_payload') {
      return {
        title: route.view === 'project' ? 'Project detail unavailable' : 'Session detail unavailable',
        description: 'The dedicated detail endpoint returned an invalid detail payload. This usually means mixed-version/contract-drift between the API and dashboard contracts. Check that the API still returns the expected JSON shape for this route.',
        entries: [
          ['Status', detailLabel],
          ['Hint', hintLabel],
        ],
      }
    }
    return {
      title: route.view === 'project' ? 'Project detail unavailable' : 'Session detail unavailable',
      description,
      entries: [
        ['Status', detailLabel],
        ['Hint', hintLabel],
      ],
    }
  }

  if (route.view === 'home' && loadState.overview !== 'fulfilled') {
    const overviewError = summaryErrors?.overview
    if (isInvalidPayloadError(overviewError)) {
      return {
        title: 'Home overview unavailable',
        description: 'The overview feed returned an invalid overview payload. Check that /api/v1/overview still returns the expected JSON shape.',
        entries: [['Status', overviewError?.detail ?? 'Invalid overview payload.']],
      }
    }

    return {
      title: 'Home overview unavailable',
      description: 'The overview feed is not available. Check /healthz, then inspect /api/v1/status if the API still responds, and confirm the API can read the current SQLite database.',
      entries: [['Status', 'Unable to load overview yet. Check /healthz, CLIPULSE_API_URL, and /api/v1/status if the API still responds.']],
    }
  }

  return null
}

function renderViewNav(doc, target, route) {
  if (!target) {
    return
  }

  const links = [
    { href: buildHomeHash(), label: 'Home' },
  ]

  if (route.view === 'project') {
    links.push({ href: buildProjectHash(route.projectRef), label: 'Project' })
  } else if (route.view === 'session' && route.projectRef) {
    links.push({ href: buildProjectHash(route.projectRef), label: 'Project' })
    links.push({ href: buildSessionHash(route.sessionId, route.projectRef), label: 'Session' })
  } else if (route.view === 'session') {
    links.push({ href: buildSessionHash(route.sessionId), label: 'Session' })
  }

  const nodes = links.map((item, index) => {
    const link = doc.createElement('a')
    link.className = 'view-link'
    if (index === links.length - 1) {
      link.className = 'view-link view-link-active'
    }
    link.href = item.href
    link.textContent = item.label
    return link
  })

  target.replaceChildren(...nodes)
}

function updateViewChrome(doc, sections, route, detail) {
  const viewCopy = getViewCopy(route)
  renderViewNav(doc, sections.viewNav, route)
  renderSectionTitle(sections.viewTitle, viewCopy.title)
  renderSectionTitle(sections.viewDescription, viewCopy.description)
  renderSectionTitle(sections.detailTitle, detail.title)
  renderSectionTitle(sections.detailDescription, detail.description)
}

function getRouteRelevantCompatSections(route) {
  if (route.view === 'project') {
    return ['projectDetail', 'sessionListItem']
  }

  if (route.view === 'session') {
    return ['sessionDetail']
  }

  return [...DASHBOARD_COMPAT_SECTION_NAMES]
}

function summarizeRouteCompatibility(route, compat, relevantFallbackSections) {
  if (route.view === 'home') {
    return formatCompatibilitySummary(compat)
  }

  if (compat?.mode === 'mixed' && compat.usingFallback && relevantFallbackSections.length === 0) {
    const metaText = hasText(compat.metaLabel) ? ` via ${compat.metaLabel}` : ''
    return `Remote contract active${metaText}, with built-in fallback elsewhere in dashboard.`
  }

  return formatCompatibilitySummary({
    ...compat,
    fallbackSectionsLabel: relevantFallbackSections.length > 0
      ? summarizeFallbackSections(relevantFallbackSections)
      : null,
  })
}

function isDetailErrorState(route, detail) {
  if (route.view === 'home' || !hasText(detail?.title)) {
    return false
  }

  return [
    'Project detail unavailable',
    'Session detail unavailable',
    'Project not found',
    'Session not found',
    'Session detail needs project scope',
  ].includes(detail.title)
}

function shouldExpandCompatDetails(route, compat, detail, relevantFallbackSections) {
  if (route.view === 'home') {
    return true
  }

  if (isDetailErrorState(route, detail)) {
    return true
  }

  if (compat?.mode === 'built-in') {
    return true
  }

  return relevantFallbackSections.length > 0
}

function withCompatFallbackHint(detail, compat, route) {
  if (!Array.isArray(detail?.entries) || !hasText(compat?.mode)) {
    return detail
  }

  const nextEntries = [...detail.entries]
  const relevantSectionNames = new Set(getRouteRelevantCompatSections(route))
  const relevantFallbackSections = (compat.fallbackSections ?? []).filter((sectionName) => relevantSectionNames.has(sectionName))
  const unrelatedFallbackSections = (compat.fallbackSections ?? []).filter((sectionName) => !relevantSectionNames.has(sectionName))
  const compatibilitySummary = summarizeRouteCompatibility(route, compat, relevantFallbackSections)
  const shouldExpandDetails = shouldExpandCompatDetails(route, compat, detail, relevantFallbackSections)

  if (
    route.view !== 'home'
    && hasText(compatibilitySummary)
    && !nextEntries.some((entry) => entry?.[0] === 'Compatibility')
  ) {
    nextEntries.push(['Compatibility', compatibilitySummary])
  }

  if (route.view !== 'home') {
    if (!shouldExpandDetails) {
      return {
        ...detail,
        entries: nextEntries,
      }
    }

    if (
      unrelatedFallbackSections.length > 0
      && !nextEntries.some((entry) => entry?.[0] === 'Compatibility scope')
    ) {
      nextEntries.push(['Compatibility scope', 'Fallback active elsewhere in dashboard.'])
    }

    if (
      relevantFallbackSections.length > 0
      && !nextEntries.some((entry) => entry?.[0] === 'Fallback sections')
    ) {
      nextEntries.push(['Fallback sections', summarizeFallbackSections(relevantFallbackSections)])
    }

    if (hasText(compat.source) && !nextEntries.some((entry) => entry?.[0] === 'Compatibility source')) {
      nextEntries.push(['Compatibility source', compat.source])
    }

    if (hasText(compat.metaLabel) && !nextEntries.some((entry) => entry?.[0] === 'Contract meta')) {
      nextEntries.push(['Contract meta', compat.metaLabel])
    }

    return {
      ...detail,
      entries: nextEntries,
    }
  }

  if (!nextEntries.some((entry) => entry?.[0] === 'Compatibility mode')) {
    nextEntries.push(['Compatibility mode', compat.mode])
  }

  if (hasText(compat.source) && !nextEntries.some((entry) => entry?.[0] === 'Compatibility source')) {
    nextEntries.push(['Compatibility source', compat.source])
  }

  if (
    compat.usingFallback
    && hasText(compat.fallbackSectionsLabel)
    && !nextEntries.some((entry) => entry?.[0] === 'Fallback sections')
  ) {
    nextEntries.push(['Fallback sections', compat.fallbackSectionsLabel])
  }

  if (hasText(compat.metaLabel) && !nextEntries.some((entry) => entry?.[0] === 'Contract meta')) {
    nextEntries.push(['Contract meta', compat.metaLabel])
  }

  return {
    ...detail,
    entries: nextEntries,
  }
}

function renderDashboard(doc, sections, route, data) {
  const activeHref = getActiveHref(route)
  const sessionScope = getSessionScope(route, data)
  renderSectionTitle(sections.sessionsTitle, sessionScope.title)

  renderMetricList(
    doc,
    sections.overview,
    buildSummaryLines(
      data.loadState.overview,
      data.overview ? buildOverviewLines(data.overview) : null,
      'Loading overview...',
      getSummaryErrorText(data.errors?.overview, 'Invalid overview payload.', 'Unable to load overview yet.'),
    ),
  )
  renderMetricList(
    doc,
    sections.languages,
    buildSummaryLines(
      data.loadState.languages,
      data.languages ? buildLanguageLines(data.languages.items) : null,
      'Loading language data...',
      getSummaryErrorText(data.errors?.languages, 'Invalid language payload.', 'Unable to load language data yet.'),
    ),
  )
  renderMetricList(
    doc,
    sections.models,
    buildSummaryLines(
      data.loadState.models,
      data.models ? buildModelLines(data.models.items) : null,
      'Loading model data...',
      getSummaryErrorText(data.errors?.models, 'Invalid model payload.', 'Unable to load model data yet.'),
    ),
  )
  renderMetricList(
    doc,
    sections.hosts,
    buildSummaryLines(
      data.loadState.hosts,
      data.hosts ? buildHostLines(data.hosts.items) : null,
      'Loading host data...',
      getSummaryErrorText(data.errors?.hosts, 'Invalid host payload.', 'Unable to load host data yet.'),
    ),
  )

  renderLinkList(
    doc,
    sections.projects,
    buildProjectListItems(data.projects.items),
    activeHref,
    buildEmptyStateText(
      data.loadState.projects,
      'Loading project data...',
      'No project data yet.',
      getSummaryErrorText(data.errors?.projects, 'Invalid project payload.', 'Unable to load project data yet.'),
    ),
  )
  renderLinkList(
    doc,
    sections.sessions,
    buildRecentSessionItems(sessionScope.items),
    activeHref,
    buildEmptyStateText(
      sessionScope.loadState,
      sessionScope.loadingText,
      sessionScope.emptyText,
      sessionScope.errorText,
    ),
  )

  if (data.loadState.timeseries === 'fulfilled') {
    renderTimeseries(doc, sections.timeseries, buildTimeseriesRows(data.timeseries.items))
  } else if (data.loadState.timeseries === 'pending') {
    renderMetricList(doc, sections.timeseries, ['Loading daily activity...'])
  } else {
    renderMetricList(
      doc,
      sections.timeseries,
      [getSummaryErrorText(data.errors?.timeseries, 'Invalid daily activity payload.', 'Unable to load daily activity yet.')],
    )
  }

  const detail = withCompatFallbackHint(
    buildDetailFallback(route, data.loadState, data.detail, data.errors)
      ?? buildDetailEntries(route, data, data.detail),
    data.compat,
    route,
  )
  updateViewChrome(doc, sections, route, detail)
  renderDetailPanel(doc, sections.detailPanel ?? sections.detail, detail)
}

function buildSummaryLines(loadState, successLines, pendingText, errorText) {
  if (loadState === 'pending') {
    return [pendingText]
  }

  if (loadState === 'fulfilled') {
    return successLines ?? [errorText]
  }

  return [errorText]
}

function buildEmptyStateText(loadState, pendingText, emptyText, errorText) {
  if (loadState === 'pending') {
    return pendingText
  }

  if (loadState === 'fulfilled') {
    return emptyText
  }

  return errorText
}

function getSessionScope(route, data) {
  if (route.view !== 'project') {
    return {
      title: 'Recent Sessions',
      items: data.sessions.items,
      loadState: data.loadState.sessions,
      loadingText: 'Loading recent sessions...',
      emptyText: 'No recent sessions yet.',
      errorText: getSessionListErrorText(
        data.errors?.sessions,
        'Invalid recent sessions payload.',
        'Unable to load recent sessions yet.',
      ),
    }
  }

  if (
    data.detail.projectSessionsStatus === 'fulfilled'
    && data.detail.projectSessions
    && (
      data.detail.projectDetailStatus === 'ready'
      || data.detail.projectDetailStatus === 'error'
      || data.detail.projectSessions.items.length > 0
    )
  ) {
    return {
      title: 'Project Sessions',
      items: data.detail.projectSessions.items,
      loadState: 'fulfilled',
      loadingText: 'Loading project sessions...',
      emptyText: 'No sessions recorded for this project yet.',
      errorText: 'Project session list unavailable right now. The project summary above is still available. Check the dedicated project sessions request.',
    }
  }

  if (data.detail.projectDetailStatus === 'error') {
    return {
      title: 'Project Sessions',
      items: [],
      loadState: 'rejected',
      loadingText: 'Loading project sessions...',
      emptyText: 'No sessions recorded for this project yet.',
      errorText: buildProjectSessionsErrorText(data.detail.projectDetailError),
    }
  }

  if (data.detail.projectSessionsStatus === 'error') {
    return {
      title: 'Project Sessions',
      items: [],
      loadState: 'rejected',
      loadingText: 'Loading project sessions...',
      emptyText: 'No sessions recorded for this project yet.',
      errorText: buildProjectSessionsErrorText(data.detail.projectSessionsError),
    }
  }

  return {
    title: 'Project Sessions',
    items: [],
    loadState: 'pending',
    loadingText: 'Loading project sessions...',
    emptyText: 'No sessions recorded for this project yet.',
    errorText: 'Project session list unavailable right now. The project summary above is still available. Check the dedicated project sessions request.',
  }
}

function replaceHash(win, nextHash) {
  if (win.location.hash === nextHash) {
    return
  }

  if (typeof win.history?.replaceState === 'function') {
    win.history.replaceState(null, '', nextHash)
    return
  }

  win.location.hash = nextHash
}

export function createDashboardApp({
  doc = typeof document === 'undefined' ? null : document,
  win = typeof window === 'undefined' ? null : window,
  fetchImpl = fetch,
  contractFetchImpl = typeof document !== 'undefined' && typeof fetch === 'function' ? fetch : null,
} = {}) {
  if (!doc || !win) {
    return {
      async start() {},
    }
  }

  const sections = {
    ...getSections(doc),
    detailPanel: doc.querySelector('#detail-panel'),
  }

  let data = {
    overview: null,
    languages: null,
    models: null,
    hosts: null,
    projects: { items: [] },
    sessions: { items: [] },
    timeseries: { items: [] },
    status: null,
    loadState: {
      overview: 'pending',
      languages: 'pending',
      models: 'pending',
      hosts: 'pending',
      projects: 'pending',
      sessions: 'pending',
      timeseries: 'pending',
      status: 'pending',
    },
    errors: {
      overview: null,
      languages: null,
      models: null,
      hosts: null,
      projects: null,
      sessions: null,
      timeseries: null,
      status: null,
    },
    detail: {
      status: 'idle',
      routeKey: buildHomeHash(),
      requestId: 0,
      projectDetail: null,
      projectDetailStatus: 'idle',
      projectDetailError: null,
      projectSessions: null,
      projectSessionsStatus: 'idle',
      projectSessionsError: null,
      sessionDetail: null,
      error: null,
    },
    compat: {
      mode: 'built-in',
      fallbackSections: [...DASHBOARD_COMPAT_SECTION_NAMES],
      fallbackSectionsLabel: `all ${DASHBOARD_COMPAT_SECTION_NAMES.length} sections`,
      source: 'Remote contract refresh pending; using built-in fallback until the artifact resolves.',
      meta: DASHBOARD_COMPAT_META_FALLBACK,
      metaLabel: formatDashboardCompatMeta(DASHBOARD_COMPAT_META_FALLBACK, true),
      usingFallback: true,
    },
  }
  let hasRegisteredHashListener = false
  let startPromise = null
  let hasStartedContractRefresh = false

  const getCompatSection = (sectionName) => data.compat.contract?.[sectionName] ?? DASHBOARD_COMPAT_FALLBACK[sectionName]

  const getSummaryItemContracts = () => ({
    language: getCompatSection('languageBreakdownItem'),
    model: getCompatSection('modelBreakdownItem'),
    host: getCompatSection('hostBreakdownItem'),
    project: getCompatSection('projectTopItem'),
    'daily activity': getCompatSection('timeseriesItem'),
  })

  const rerender = () => {
    const route = parseDashboardHash(win.location.hash)
    renderDashboard(doc, sections, route, data)
  }

  const isActiveRouteRequest = (routeKey, requestId) =>
    routeKey === getActiveHref(parseDashboardHash(win.location.hash))
    && data.detail.routeKey === routeKey
    && data.detail.requestId === requestId

  const updateProjectRouteDetail = (routeKey, requestId, patch) => {
    if (!isActiveRouteRequest(routeKey, requestId)) {
      return false
    }

    const nextDetail = {
      ...data.detail,
      ...patch,
      routeKey,
      requestId,
      sessionDetail: null,
    }
    nextDetail.status = nextDetail.projectDetailStatus === 'error'
      ? 'error'
      : nextDetail.projectDetailStatus === 'ready'
        ? 'ready'
        : 'loading'

    data = {
      ...data,
      detail: nextDetail,
    }
    rerender()
    return true
  }

  const refreshDashboardCompatContract = () => {
    if (hasStartedContractRefresh) {
      return
    }

    hasStartedContractRefresh = true

    void loadDashboardCompatContract(contractFetchImpl).then((compat) => {
      data = {
        ...data,
        compat,
      }
      rerender()
    })
  }

  const loadRouteDetail = async (route) => {
    if (route.view === 'home') {
      const requestId = (data.detail.requestId ?? 0) + 1
      data = {
        ...data,
        detail: {
          status: 'idle',
          routeKey: buildHomeHash(),
          requestId,
          projectDetail: null,
          projectDetailStatus: 'idle',
          projectDetailError: null,
          projectSessions: null,
          projectSessionsStatus: 'idle',
          projectSessionsError: null,
          sessionDetail: null,
          error: null,
        },
      }
      rerender()
      return
    }

    const routeKey = route.view === 'project'
      ? buildProjectHash(route.projectRef)
      : buildSessionHash(route.sessionId, route.projectRef)
    if (
      route.view === 'project'
      && data.detail.routeKey === routeKey
      && (
        data.detail.projectDetailStatus === 'loading'
        || data.detail.projectSessionsStatus === 'loading'
      )
    ) {
      return
    }
    if (
      route.view === 'session'
      && data.detail.routeKey === routeKey
      && (data.detail.status === 'loading' || data.detail.status === 'ready')
    ) {
      return
    }

    const requestId = (data.detail.requestId ?? 0) + 1

    data = {
      ...data,
      detail: {
        status: 'loading',
        routeKey,
        requestId,
        projectDetail: null,
        projectDetailStatus: route.view === 'project' ? 'loading' : 'idle',
        projectDetailError: null,
        projectSessions: null,
        projectSessionsStatus: route.view === 'project' ? 'loading' : 'idle',
        projectSessionsError: null,
        sessionDetail: null,
        error: null,
      },
    }
    rerender()

    try {
      if (route.view === 'project') {
        void loadSessionListPayload(
          getProjectSessionListPaths(route.projectRef),
          fetchImpl,
          'Check the project sessions endpoint response shape.',
          {
            projectRef: route.projectRef,
            requireProjectName: true,
          },
          getCompatSection('sessionListItem'),
        ).then((payload) => {
          updateProjectRouteDetail(routeKey, requestId, {
            projectSessions: payload,
            projectSessionsStatus: 'fulfilled',
            projectSessionsError: null,
          })
        }).catch((error) => {
          updateProjectRouteDetail(routeKey, requestId, {
            projectSessions: null,
            projectSessionsStatus: 'error',
            projectSessionsError: toDetailError(error),
          })
        })

        await loadJson(`/api/v1/projects/${encodeURIComponent(route.projectRef)}`, fetchImpl)
          .then((payload) => {
            const safePayload = validateProjectDetailPayload(payload, route.projectRef, getCompatSection('projectDetail'))
            updateProjectRouteDetail(routeKey, requestId, {
              projectDetail: safePayload,
              projectDetailStatus: 'ready',
              projectDetailError: null,
              error: null,
            })
          })
          .catch((error) => {
            const projectDetailError = toDetailError(error)
            updateProjectRouteDetail(routeKey, requestId, {
              projectDetail: null,
              projectDetailStatus: 'error',
              projectDetailError,
              error: projectDetailError,
            })
          })
        return
      }

      const payload = await loadJson(
        `/api/v1/sessions/${encodeURIComponent(route.sessionId)}${route.projectRef ? `?project_ref=${encodeURIComponent(route.projectRef)}` : ''}`,
        fetchImpl,
      )
      const safePayload = validateSessionDetailPayload(payload, route, getCompatSection('sessionDetail'))

      if (!isActiveRouteRequest(routeKey, requestId)) {
        return
      }

      const normalizedRouteKey = !route.projectRef && safePayload.project_ref
        ? buildSessionHash(safePayload.session_id, safePayload.project_ref)
        : routeKey

      data = {
        ...data,
        detail: {
          status: 'ready',
          routeKey: normalizedRouteKey,
          requestId,
          projectDetail: null,
          projectDetailStatus: 'idle',
          projectDetailError: null,
          projectSessions: null,
          projectSessionsStatus: 'idle',
          projectSessionsError: null,
          sessionDetail: safePayload,
          error: null,
        },
      }

      if (!route.projectRef && safePayload.project_ref) {
        replaceHash(win, normalizedRouteKey)
      }

      rerender()
    } catch (error) {
      if (!isActiveRouteRequest(routeKey, requestId)) {
        return
      }

      data = {
        ...data,
        detail: {
          status: 'error',
          routeKey,
          requestId,
          projectDetail: null,
          projectDetailStatus: 'idle',
          projectDetailError: null,
          projectSessions: null,
          projectSessionsStatus: 'idle',
          projectSessionsError: null,
          sessionDetail: null,
          error: {
            status: error.status ?? 0,
            code: error.code ?? null,
            detail: error.detail ?? null,
            hint: error.hint ?? null,
          },
        },
      }
      rerender()
    }
  }

  return {
    async start() {
      if (startPromise) {
        await startPromise
        return
      }

      startPromise = (async () => {
        rerender()
        refreshDashboardCompatContract()

        if (!hasRegisteredHashListener) {
          win.addEventListener('hashchange', () => {
            rerender()
            void loadRouteDetail(parseDashboardHash(win.location.hash))
          })
          hasRegisteredHashListener = true
        }

        void loadRouteDetail(parseDashboardHash(win.location.hash))

        const results = await Promise.allSettled([
          loadJson('/api/v1/overview', fetchImpl).then((payload) => validateOverviewPayload(payload)),
          loadJson('/api/v1/breakdown/languages', fetchImpl).then((payload) => (
            validateSummaryItemsPayload(payload, 'language', '/api/v1/breakdown/languages', getSummaryItemContracts())
          )),
          loadJson('/api/v1/breakdown/models', fetchImpl).then((payload) => (
            validateSummaryItemsPayload(payload, 'model', '/api/v1/breakdown/models', getSummaryItemContracts())
          )),
          loadJson('/api/v1/breakdown/hosts', fetchImpl).then((payload) => (
            validateSummaryItemsPayload(payload, 'host', '/api/v1/breakdown/hosts', getSummaryItemContracts())
          )),
          loadJson('/api/v1/projects/top?limit=5', fetchImpl).then((payload) => (
            validateSummaryItemsPayload(payload, 'project', '/api/v1/projects/top', getSummaryItemContracts())
          )),
          loadSessionListPayload(
            getRecentSessionListPaths(),
            fetchImpl,
            'Check the recent sessions endpoint response shape.',
            {
              requireProjectName: false,
            },
            getCompatSection('sessionListItem'),
          ),
          loadJson('/api/v1/timeseries', fetchImpl).then((payload) => (
            validateSummaryItemsPayload(payload, 'daily activity', '/api/v1/timeseries', getSummaryItemContracts())
          )),
          loadJson('/api/v1/status', fetchImpl).then((payload) => validateStatusPayload(payload)),
        ])

        data = {
          ...buildDataSnapshot(results),
          detail: data.detail,
          compat: data.compat,
        }
        rerender()
        await loadRouteDetail(parseDashboardHash(win.location.hash))
      })()

      await startPromise
    },
  }
}

function toDetailError(error) {
  return {
    status: error?.status ?? 0,
    code: error?.code ?? null,
    detail: error?.detail ?? null,
    hint: error?.hint ?? null,
  }
}

function buildProjectSessionsErrorText(error) {
  if (isInvalidListError(error)) {
    const detail = error?.detail ?? 'Project sessions did not match the expected payload shape.'
    const hint = error?.hint ?? 'Check the project sessions endpoint response shape.'
    return `Project session list returned an invalid payload. ${detail} ${hint}`
  }

  if (error?.code === 'project_not_found') {
    return 'Project session list unavailable. Open the home view and reselect a project from the latest snapshot.'
  }

  const hint = error?.hint ?? 'Check the dedicated project sessions request.'
  if (typeof error?.detail === 'string' && error.detail.trim().length > 0) {
    return `Project session list unavailable right now. The project summary above is still available. ${error.detail} ${hint}`
  }
  return `Project session list unavailable right now. The project summary above is still available. ${hint}`
}

function createInvalidDetailPayloadError(detail, hint = 'Check the dedicated detail endpoint response shape.') {
  const error = new Error(detail)
  error.status = 200
  error.code = 'invalid_detail_payload'
  error.detail = detail
  error.hint = hint
  return error
}

function validateProjectDetailPayload(payload, routeProjectRef, contract = DASHBOARD_COMPAT_FALLBACK.projectDetail) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createInvalidDetailPayloadError('Detail response must be a JSON object.')
  }

  const missingFields = collectMissingContractFields(payload, contract)
  if (missingFields.length > 0) {
    throw createInvalidDetailPayloadError(`Missing required detail fields: ${missingFields.join(', ')}`)
  }

  if (payload.project_ref !== routeProjectRef) {
    throw createInvalidDetailPayloadError('Detail payload does not match current route identity: project_ref')
  }

  return normalizePayloadWithContract(payload, contract)
}

function validateSessionDetailPayload(payload, route, contract = DASHBOARD_COMPAT_FALLBACK.sessionDetail) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createInvalidDetailPayloadError('Detail response must be a JSON object.')
  }

  const missingFields = collectMissingContractFields(payload, contract)
  if (missingFields.length > 0) {
    throw createInvalidDetailPayloadError(`Missing required detail fields: ${missingFields.join(', ')}`)
  }

  const identityMismatches = []
  if (payload.session_id !== route.sessionId) {
    identityMismatches.push('session_id')
  }
  if (route.projectRef && payload.project_ref !== route.projectRef) {
    identityMismatches.push('project_ref')
  }

  if (identityMismatches.length > 0) {
    throw createInvalidDetailPayloadError(
      `Detail payload does not match current route identity: ${identityMismatches.join(', ')}`,
    )
  }

  return normalizePayloadWithContract(payload, contract)
}

export async function bootstrapDashboard() {
  const app = createDashboardApp()
  await app.start()
}
