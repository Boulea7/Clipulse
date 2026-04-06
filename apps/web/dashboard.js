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
    throw new Error(`Failed to load ${path}`)
  }

  return response.json()
}

function getSettledValue(result) {
  return result.status === 'fulfilled' ? result.value : null
}

function buildDataSnapshot(results) {
  const [overview, languages, models, hosts, projects, sessions, timeseries] = results

  return {
    overview: getSettledValue(overview),
    languages: getSettledValue(languages),
    models: getSettledValue(models),
    hosts: getSettledValue(hosts),
    projects: getSettledValue(projects) ?? { items: [] },
    sessions: getSettledValue(sessions) ?? { items: [] },
    timeseries: getSettledValue(timeseries) ?? { items: [] },
    loadState: {
      overview: overview.status,
      languages: languages.status,
      models: models.status,
      hosts: hosts.status,
      projects: projects.status,
      sessions: sessions.status,
      timeseries: timeseries.status,
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
  if (route.view === 'project' && loadState.projects !== 'fulfilled') {
    return {
      title: 'Project details unavailable',
      description: 'Project detail depends on the top-project feed. Check /healthz first, then verify CLIPULSE_API_URL and the API process.',
      entries: [['Status', 'Unable to load project data yet. Check /healthz and CLIPULSE_API_URL.']],
    }
  }

  if (route.view === 'session' && loadState.sessions !== 'fulfilled') {
    return {
      title: 'Session details unavailable',
      description: 'Session detail depends on the recent-session feed. Check /healthz first, then verify CLIPULSE_API_URL and backlog delivery.',
      entries: [['Status', 'Unable to load recent sessions yet. Check /healthz, CLIPULSE_API_URL, and CLIPULSE_STATE_DIR/spool/ready.']],
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
    return {
      title: route.view === 'project' ? 'Project detail unavailable' : 'Session detail unavailable',
      description: 'The dedicated detail endpoint could not be loaded. Check /healthz, CLIPULSE_API_URL, and whether backlog batches are still waiting in CLIPULSE_STATE_DIR/spool/ready.',
      entries: [['Status', 'Unable to load detail data yet. Check /healthz, CLIPULSE_API_URL, and CLIPULSE_STATE_DIR/spool/ready.']],
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
    buildRecentSessionItems(data.sessions.items),
    activeHref,
    data.loadState.sessions === 'fulfilled'
      ? 'No recent sessions yet.'
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
    loadState: {
      overview: 'pending',
      languages: 'pending',
      models: 'pending',
      hosts: 'pending',
      projects: 'pending',
      sessions: 'pending',
      timeseries: 'pending',
    },
    detail: {
      status: 'idle',
      routeKey: buildHomeHash(),
      projectDetail: null,
      sessionDetail: null,
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
          sessionDetail: null,
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
        sessionDetail: null,
      },
    }
    rerender()

    try {
      const payload = route.view === 'project'
        ? await loadJson(`/api/v1/projects/${encodeURIComponent(route.projectRef)}`, fetchImpl)
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
          projectDetail: route.view === 'project' ? payload : null,
          sessionDetail: route.view === 'session' ? payload : null,
        },
      }
    } catch {
      if (routeKey !== getActiveHref(parseDashboardHash(win.location.hash))) {
        return
      }

      data = {
        ...data,
        detail: {
          status: 'error',
          routeKey,
          projectDetail: null,
          sessionDetail: null,
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
      ])

      data = buildDataSnapshot(results)
      rerender()
      await loadRouteDetail(parseDashboardHash(win.location.hash))
    },
  }
}

export async function bootstrapDashboard() {
  const app = createDashboardApp()
  await app.start()
}
