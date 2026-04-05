const sections = {
  overview: document.querySelector('#overview'),
  languages: document.querySelector('#languages'),
  models: document.querySelector('#models'),
  hosts: document.querySelector('#hosts'),
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

async function bootstrap() {
  try {
    const [overview, languages, models, hosts] = await Promise.all([
      loadJson('/api/v1/overview'),
      loadJson('/api/v1/breakdown/languages'),
      loadJson('/api/v1/breakdown/models'),
      loadJson('/api/v1/breakdown/hosts'),
    ])

    renderLines(sections.overview, [
      `Events: ${overview.totals.events}`,
      `Active: ${overview.totals.active_ms} ms`,
      `Wait: ${overview.totals.wait_ms} ms`,
    ])

    renderLines(
      sections.languages,
      (languages.items.length ? languages.items : [{ name: 'No data', changed: 0 }]).map(
        (item) => `${item.name}: ${item.changed}`,
      ),
    )

    renderLines(
      sections.models,
      (models.items.length ? models.items : [{ name: 'No data', active_ms: 0 }]).map(
        (item) => `${item.name}: ${item.active_ms} ms`,
      ),
    )

    renderLines(
      sections.hosts,
      (hosts.items.length ? hosts.items : [{ name: 'No data', active_ms: 0 }]).map(
        (item) => `${item.name}: ${item.active_ms} ms`,
      ),
    )
  } catch (error) {
    console.error(error)
    renderLines(sections.overview, ['Unable to load dashboard data yet.'])
    renderLines(sections.languages, ['Unable to load dashboard data yet.'])
    renderLines(sections.models, ['Unable to load dashboard data yet.'])
    renderLines(sections.hosts, ['Unable to load dashboard data yet.'])
  }
}

void bootstrap()
