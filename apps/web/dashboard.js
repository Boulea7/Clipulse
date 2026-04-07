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

  return response.json()
}

function getSettledValue(result) {
  return result.status === 'fulfilled' ? result.value : null
}

function buildDataSnapshot(results) {
  const [overview, languages, models, hosts, projects, sessions, timeseries, status] = results

  return {
    overview: getSettledValue(overview),
    languages: getSettledValue(languages),
    models: getSettledValue(models),
    hosts: getSettledValue(hosts),
    projects: getSettledValue(projects) ?? { items: [] },
    sessions: getSettledValue(sessions) ?? { items: [] },
    timeseries: getSettledValue(timeseries) ?? { items: [] },
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

function buildDetailFallback(route, loadState, detailState) {
  if ((route.view === 'project' || route.view === 'session') && detailState?.status === 'idle') {
    return {
      title: route.view === 'project' ? 'Project detail loading' : 'Session detail loading',
      description: 'Clipulse is preparing the detail view for this route.',
      entries: [['Status', 'Loading detail data...']],
    }
  }

  if ((route.view === 'project' || route.view === 'session') && detailState?.status === 'loading') {
    return {
      title: route.view === 'project' ? 'Project detail loading' : 'Session detail loading',
      description: 'Clipulse is loading the latest detail payload for this view.',
      entries: [['Status', 'Loading detail data...']],
    }
  }

  if ((route.view === 'project' || route.view === 'session') && detailState?.status === 'error') {
    const detailLabel = detailState.error?.status === 0
      ? 'Network request failed before an HTTP status was returned.'
      : detailState.error?.detail ?? 'Unable to load detail data yet.'
    const hintLabel = detailState.error?.hint ?? 'Check /healthz, CLIPULSE_API_URL, and CLIPULSE_STATE_DIR/spool/ready.'
    const description = detailState.error?.status === 0
      ? 'The dedicated detail request failed before the API returned an HTTP status. Check /healthz, CLIPULSE_API_URL, and local network reachability.'
      : detailState.error?.code
      ? `The dedicated detail endpoint returned ${detailState.error.code}. Check /healthz, CLIPULSE_API_URL, and local backlog state.`
      : 'The dedicated detail endpoint could not be loaded. Check /healthz, CLIPULSE_API_URL, and whether backlog batches are still waiting in CLIPULSE_STATE_DIR/spool/ready.'
    if (route.view === 'session' && detailState.error?.code === 'ambiguous_session') {
      return {
        title: 'Session detail needs project scope',
        description: 'The dedicated detail endpoint returned ambiguous_session. Open the project-scoped session link or retry with the matching project_ref.',
        entries: [
          ['Status', detailLabel],
          ['Hint', hintLabel],
        ],
      }
    }
    if (route.view === 'session' && detailState.error?.code === 'session_not_found') {
      return {
        title: 'Session not found',
        description: 'The dedicated detail endpoint returned session_not_found. Open the project view or retry from the latest project-scoped session list.',
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
    return {
      title: 'Home overview unavailable',
      description: 'The overview feed is not available. Check /healthz and confirm the API can read the current SQLite database.',
      entries: [['Status', 'Unable to load overview yet. Check /healthz and CLIPULSE_API_URL.']],
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
  const sessionItems = route.view === 'project' && data.detail.projectSessions
    ? data.detail.projectSessions.items
    : data.sessions.items
  const sessionsLoadState = route.view === 'project' && data.detail.status === 'ready'
    ? 'fulfilled'
    : data.loadState.sessions
  const sessionEmptyText = route.view === 'project' && data.detail.status === 'ready'
    ? 'No sessions recorded for this project yet.'
    : 'No recent sessions yet.'

  renderMetricList(
    doc,
    sections.overview,
    data.overview ? buildOverviewLines(data.overview) : ['Unable to load overview yet.'],
  )
  renderMetricList(
    doc,
    sections.languages,
    data.languages ? buildLanguageLines(data.languages.items) : ['Unable to load language data yet.'],
  )
  renderMetricList(
    doc,
    sections.models,
    data.models ? buildModelLines(data.models.items) : ['Unable to load model data yet.'],
  )
  renderMetricList(
    doc,
    sections.hosts,
    data.hosts ? buildHostLines(data.hosts.items) : ['Unable to load host data yet.'],
  )

  renderLinkList(
    doc,
    sections.projects,
    buildProjectListItems(data.projects.items),
    activeHref,
    data.loadState.projects === 'fulfilled' ? 'No project data yet.' : 'Unable to load project data yet.',
  )
  renderLinkList(
    doc,
    sections.sessions,
    buildRecentSessionItems(sessionItems),
    activeHref,
    sessionsLoadState === 'fulfilled'
      ? sessionEmptyText
      : 'Unable to load recent sessions yet.',
  )

  if (data.loadState.timeseries === 'fulfilled') {
    renderTimeseries(doc, sections.timeseries, buildTimeseriesRows(data.timeseries.items))
  } else {
    renderMetricList(doc, sections.timeseries, ['Unable to load daily activity yet.'])
  }

  const detail = buildDetailFallback(route, data.loadState, data.detail)
    ?? buildDetailEntries(route, data, data.detail)
  updateViewChrome(doc, sections, route, detail)
  renderDetailPanel(doc, sections.detailPanel ?? sections.detail, detail)
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
    detail: {
      status: 'idle',
      routeKey: buildHomeHash(),
      projectDetail: null,
      projectSessions: null,
      sessionDetail: null,
      error: null,
    },
  }

  const rerender = () => {
    const route = parseDashboardHash(win.location.hash)
    renderDashboard(doc, sections, route, data)
  }

  const loadRouteDetail = async (route) => {
    if (route.view === 'home') {
      data = {
        ...data,
        detail: {
          status: 'idle',
          routeKey: buildHomeHash(),
          projectDetail: null,
          projectSessions: null,
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

    data = {
      ...data,
      detail: {
        status: 'loading',
        routeKey,
        projectDetail: null,
        projectSessions: null,
        sessionDetail: null,
        error: null,
      },
    }
    rerender()

    try {
      const payload = route.view === 'project'
        ? await Promise.all([
          loadJson(`/api/v1/projects/${encodeURIComponent(route.projectRef)}`, fetchImpl),
          loadJson(`/api/v1/projects/${encodeURIComponent(route.projectRef)}/sessions?limit=10`, fetchImpl),
        ])
        : await loadJson(
          `/api/v1/sessions/${encodeURIComponent(route.sessionId)}${route.projectRef ? `?project_ref=${encodeURIComponent(route.projectRef)}` : ''}`,
          fetchImpl,
        )

      if (routeKey !== getActiveHref(parseDashboardHash(win.location.hash))) {
        return
      }

      data = {
        ...data,
        detail: {
          status: 'ready',
          routeKey,
          projectDetail: route.view === 'project' ? payload[0] : null,
          projectSessions: route.view === 'project' ? payload[1] : null,
          sessionDetail: route.view === 'session' ? payload : null,
          error: null,
        },
      }
    } catch (error) {
      if (routeKey !== getActiveHref(parseDashboardHash(win.location.hash))) {
        return
      }

      data = {
        ...data,
        detail: {
          status: 'error',
          routeKey,
          projectDetail: null,
          projectSessions: null,
          sessionDetail: null,
          error: {
            status: error.status ?? 0,
            code: error.code ?? null,
            detail: error.detail ?? null,
            hint: error.hint ?? null,
          },
        },
      }
    }

    rerender()
  }

  return {
    async start() {
      rerender()

      win.addEventListener('hashchange', () => {
        rerender()
        void loadRouteDetail(parseDashboardHash(win.location.hash))
      })

      const results = await Promise.allSettled([
        loadJson('/api/v1/overview', fetchImpl),
        loadJson('/api/v1/breakdown/languages', fetchImpl),
        loadJson('/api/v1/breakdown/models', fetchImpl),
        loadJson('/api/v1/breakdown/hosts', fetchImpl),
        loadJson('/api/v1/projects/top?limit=5', fetchImpl),
        loadJson('/api/v1/sessions/recent?limit=10', fetchImpl),
        loadJson('/api/v1/timeseries', fetchImpl),
        loadJson('/api/v1/status', fetchImpl),
      ])

      data = {
        ...buildDataSnapshot(results),
        detail: data.detail,
      }
      rerender()
      await loadRouteDetail(parseDashboardHash(win.location.hash))
    },
  }
}

export async function bootstrapDashboard() {
  const app = createDashboardApp()
  await app.start()
}
