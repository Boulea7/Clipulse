export function formatDuration(durationMs) {
  const totalSeconds = Math.max(Math.floor(durationMs / 1000), 0)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`
  }
  return `${seconds}s`
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

export function buildProjectLines(items) {
  if (!items.length) {
    return ['No project data yet.']
  }

  return items.map((item) => `${item.project_name}: ${formatDuration(item.active_ms)}`)
}

export function buildRecentSessionLines(items) {
  if (!items.length) {
    return ['No recent sessions yet.']
  }

  return items.map(
    (item) => `${item.project_name} / ${item.session_id}: ${formatDuration(item.active_ms)}`,
  )
}

function buildLanguageLines(items) {
  if (!items.length) {
    return ['No language data yet.']
  }

  return items.map((item) => `${item.name}: ${item.changed}`)
}

function buildNamedDurationLines(items, emptyLine) {
  if (!items.length) {
    return [emptyLine]
  }

  return items.map((item) => `${item.name}: ${formatDuration(item.active_ms)}`)
}

function getSections(doc) {
  return {
    overview: doc.querySelector('#overview'),
    languages: doc.querySelector('#languages'),
    models: doc.querySelector('#models'),
    hosts: doc.querySelector('#hosts'),
    projects: doc.querySelector('#projects'),
    sessions: doc.querySelector('#sessions'),
  }
}

async function loadJson(path) {
  const response = await fetch(path)
  if (!response.ok) {
    throw new Error(`Failed to load ${path}`)
  }
  return response.json()
}

function renderLines(target, lines) {
  if (!target) {
    return
  }

  target.innerHTML = lines.map((line) => `<div class="metric">${line}</div>`).join('')
}

function getSettledValue(result) {
  return result.status === 'fulfilled' ? result.value : null
}

async function bootstrap() {
  if (typeof document === 'undefined') {
    return
  }

  const sections = getSections(document)

  const [overview, languages, models, hosts, projects, sessions] = await Promise.allSettled([
    loadJson('/api/v1/overview'),
    loadJson('/api/v1/breakdown/languages'),
    loadJson('/api/v1/breakdown/models'),
    loadJson('/api/v1/breakdown/hosts'),
    loadJson('/api/v1/projects/top?limit=5'),
    loadJson('/api/v1/sessions/recent?limit=10'),
  ])

  renderLines(
    sections.overview,
    getSettledValue(overview)
      ? buildOverviewLines(getSettledValue(overview))
      : ['Unable to load overview yet.'],
  )
  renderLines(
    sections.languages,
    getSettledValue(languages)
      ? buildLanguageLines(getSettledValue(languages).items)
      : ['Unable to load language data yet.'],
  )
  renderLines(
    sections.models,
    getSettledValue(models)
      ? buildNamedDurationLines(getSettledValue(models).items, 'No model data yet.')
      : ['Unable to load model data yet.'],
  )
  renderLines(
    sections.hosts,
    getSettledValue(hosts)
      ? buildNamedDurationLines(getSettledValue(hosts).items, 'No host data yet.')
      : ['Unable to load host data yet.'],
  )
  renderLines(
    sections.projects,
    getSettledValue(projects)
      ? buildProjectLines(getSettledValue(projects).items)
      : ['Unable to load project data yet.'],
  )
  renderLines(
    sections.sessions,
    getSettledValue(sessions)
      ? buildRecentSessionLines(getSettledValue(sessions).items)
      : ['Unable to load recent sessions yet.'],
  )
}

void bootstrap()
