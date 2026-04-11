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
} from './view-models.js'
import { buildHomeHash, buildProjectHash, buildSessionHash, parseDashboardHash } from './routes.js'
import { getProjectSessionListPaths, getRecentSessionListPaths } from './session-list-paths.js'

const DASHBOARD_COMPAT_FALLBACK = {
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
      'event_count',
      'session_count',
      'changed_files_count',
      'changed_languages_count',
      'lines_added',
      'lines_removed',
      'lines_changed',
    ],
  },
  sessionDetail: {
    text: ['session_id', 'project_name', 'project_ref', 'last_event_time'],
    number: [
      'active_ms',
      'wait_ms',
      'event_count',
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
  },
}

const dashboardCompatContractUrl = new URL('../../contracts/dashboard-compat.v1.json', import.meta.url)

async function loadDashboardCompatContract() {
  const isNodeRuntime =
    typeof process !== 'undefined'
    && Boolean(process?.versions?.node)

  try {
    let rawContract = ''

    if (isNodeRuntime) {
      const { readFileSync } = await import('node:fs')
      rawContract = readFileSync(dashboardCompatContractUrl, 'utf8')
    } else if (typeof fetch === 'function') {
      const response = await fetch(dashboardCompatContractUrl)
      if (!response.ok) {
        return DASHBOARD_COMPAT_FALLBACK
      }
      rawContract = await response.text()
    } else {
      return DASHBOARD_COMPAT_FALLBACK
    }

    return {
      ...DASHBOARD_COMPAT_FALLBACK,
      ...JSON.parse(rawContract),
    }
  } catch {
    return DASHBOARD_COMPAT_FALLBACK
  }
}

const dashboardCompatContract = await loadDashboardCompatContract()

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

function hasObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

const SESSION_LIST_ITEM_CONTRACT = dashboardCompatContract.sessionListItem ?? DASHBOARD_COMPAT_FALLBACK.sessionListItem

const PROJECT_DETAIL_CONTRACT = dashboardCompatContract.projectDetail ?? DASHBOARD_COMPAT_FALLBACK.projectDetail

const SESSION_DETAIL_CONTRACT = dashboardCompatContract.sessionDetail ?? DASHBOARD_COMPAT_FALLBACK.sessionDetail

const SUMMARY_ITEMS_CONTRACTS = {
  language: {
    text: ['name'],
    number: ['changed'],
  },
  model: {
    text: ['name'],
    number: ['active_ms'],
  },
  host: {
    text: ['name'],
    number: ['active_ms'],
  },
  project: {
    text: ['project_ref'],
    number: ['active_ms'],
  },
  'daily activity': {
    text: ['date'],
    number: ['active_ms', 'events'],
  },
}

function validateItemsPayload(payload, hint, options = {}) {
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
    const missingFields = collectMissingContractFields(item, SESSION_LIST_ITEM_CONTRACT)

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

  return payload
}

function shouldRetryLegacyListPath(error) {
  if (error?.code === 'invalid_list_payload' || error?.code === 'invalid_json_response') {
    return true
  }

  return error?.status === 400 || error?.status === 404 || error?.status === 422
}

async function loadSessionListPayload(paths, fetchImpl, hint, options = {}) {
  let lastError = null

  for (let index = 0; index < paths.length; index += 1) {
    const path = paths[index]
    try {
      const payload = await loadJson(path, fetchImpl)
      return validateItemsPayload(payload, hint, options)
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

function validateSummaryItemsPayload(payload, label, path) {
  if (!hasObject(payload) || !Array.isArray(payload.items)) {
    throw createInvalidSummaryPayloadError(
      `Invalid ${label} payload.`,
      `Check that ${path} returns an object with an items array.`,
    )
  }

  const contract = SUMMARY_ITEMS_CONTRACTS[label]

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

  return payload
}

function validateStatusPayload(payload) {
  if (hasObject(payload?.api) && hasObject(payload?.db) && hasObject(payload?.spool)) {
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
      title: 'Project view',
      description: 'Inspect project-level rollups. Active, wait, and line-change totals are compact local heuristics, not a full audit log.',
    }
  }

  if (route.view === 'session') {
    return {
      title: 'Session view',
      description: 'Inspect a single logical session. Active, wait, and line-change totals are compact local heuristics, not a full audit log.',
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
        description: 'The dedicated detail endpoint returned an invalid detail payload. Check that the API still returns the expected JSON shape for this route.',
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

  const detail = buildDetailFallback(route, data.loadState, data.detail, data.errors)
    ?? buildDetailEntries(route, data, data.detail)
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

  if (
    data.detail.projectSessionsStatus === 'fulfilled'
    && data.detail.projectSessions
    && (
      data.detail.projectDetailStatus === 'ready'
      || data.detail.projectSessions.items.length > 0
    )
  ) {
    return {
      title: 'Project Sessions',
      items: data.detail.projectSessions.items,
      loadState: 'fulfilled',
      loadingText: 'Loading project sessions...',
      emptyText: 'No sessions recorded for this project yet.',
      errorText: 'Project sessions unavailable. Check the dedicated project detail request.',
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
    errorText: 'Project sessions unavailable. Check the dedicated project detail request.',
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
  }
  let hasRegisteredHashListener = false
  let startPromise = null

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
            const safePayload = validateProjectDetailPayload(payload, route.projectRef)
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
      const safePayload = validateSessionDetailPayload(payload, route)

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
            validateSummaryItemsPayload(payload, 'language', '/api/v1/breakdown/languages')
          )),
          loadJson('/api/v1/breakdown/models', fetchImpl).then((payload) => (
            validateSummaryItemsPayload(payload, 'model', '/api/v1/breakdown/models')
          )),
          loadJson('/api/v1/breakdown/hosts', fetchImpl).then((payload) => (
            validateSummaryItemsPayload(payload, 'host', '/api/v1/breakdown/hosts')
          )),
          loadJson('/api/v1/projects/top?limit=5', fetchImpl).then((payload) => (
            validateSummaryItemsPayload(payload, 'project', '/api/v1/projects/top')
          )),
          loadSessionListPayload(
            getRecentSessionListPaths(),
            fetchImpl,
            'Check the recent sessions endpoint response shape.',
            {
              requireProjectName: false,
            },
          ),
          loadJson('/api/v1/timeseries', fetchImpl).then((payload) => (
            validateSummaryItemsPayload(payload, 'daily activity', '/api/v1/timeseries')
          )),
          loadJson('/api/v1/status', fetchImpl).then((payload) => validateStatusPayload(payload)),
        ])

        data = {
          ...buildDataSnapshot(results),
          detail: data.detail,
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
    const hint = error?.hint ?? 'Check the dedicated project sessions request.'
    return `Invalid project sessions payload. ${detail} ${hint}`
  }

  if (error?.code === 'project_not_found') {
    return 'Project sessions unavailable. Open the home view and reselect a project from the latest snapshot.'
  }

  const hint = error?.hint ?? 'Check the dedicated project detail request.'
  if (typeof error?.detail === 'string' && error.detail.trim().length > 0) {
    return `Project sessions unavailable. ${error.detail} ${hint}`
  }
  return `Project sessions unavailable. ${hint}`
}

function createInvalidDetailPayloadError(detail, hint = 'Check the dedicated detail endpoint response shape.') {
  const error = new Error(detail)
  error.status = 200
  error.code = 'invalid_detail_payload'
  error.detail = detail
  error.hint = hint
  return error
}

function validateProjectDetailPayload(payload, routeProjectRef) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createInvalidDetailPayloadError('Detail response must be a JSON object.')
  }

  const missingFields = collectMissingContractFields(payload, PROJECT_DETAIL_CONTRACT)
  if (missingFields.length > 0) {
    throw createInvalidDetailPayloadError(`Missing required detail fields: ${missingFields.join(', ')}`)
  }

  if (payload.project_ref !== routeProjectRef) {
    throw createInvalidDetailPayloadError('Detail payload does not match current route identity: project_ref')
  }

  return payload
}

function validateSessionDetailPayload(payload, route) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createInvalidDetailPayloadError('Detail response must be a JSON object.')
  }

  const missingFields = collectMissingContractFields(payload, SESSION_DETAIL_CONTRACT)
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

  return payload
}

export async function bootstrapDashboard() {
  const app = createDashboardApp()
  await app.start()
}
