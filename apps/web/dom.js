import { translateText } from './i18n.js'

function createTextElement(doc, tagName, className, text) {
  const element = doc.createElement(tagName)
  element.className = className
  element.textContent = translateText(text)
  return element
}

function renderEmptyState(doc, target, text) {
  target.replaceChildren(createTextElement(doc, 'div', 'empty-state', text))
}

export function renderSectionTitle(target, text) {
  if (!target) {
    return
  }

  target.textContent = translateText(text)
}

export function renderMetricList(doc, target, lines) {
  if (!target) {
    return
  }

  const nodes = lines.map((line) => createTextElement(doc, 'div', 'metric', line))
  target.replaceChildren(...nodes)
}

export function renderLinkList(doc, target, items, activeHref, emptyText) {
  if (!target) {
    return
  }

  if (!items.length) {
    renderEmptyState(doc, target, emptyText)
    return
  }

  const nodes = items.map((item) => {
    const link = doc.createElement('a')
    link.className = item.href === activeHref ? 'linked-item linked-item-active' : 'linked-item'
    link.href = item.href
    link.setAttribute('data-kind', 'dashboard-link')

    const title = createTextElement(doc, 'span', 'linked-item-label', item.label)
    const meta = createTextElement(doc, 'span', 'linked-item-meta', item.meta)

    link.append(title, meta)
    return link
  })

  target.replaceChildren(...nodes)
}

export function renderDetailPanel(doc, target, detail) {
  if (!target) {
    return
  }

  const nodes = detail.entries.map(([label, value]) => {
    const row = doc.createElement('div')
    row.className = 'detail-row'

    const labelNode = createTextElement(doc, 'span', 'detail-label', label)
    const valueNode = createTextElement(doc, 'span', 'detail-value', translateText(value))

    row.append(labelNode, valueNode)
    return row
  })

  target.replaceChildren(...nodes)
}

export function renderTimeseries(doc, target, rows, emptyText = 'No daily activity yet.') {
  if (!target) {
    return
  }

  if (!rows.length) {
    renderEmptyState(doc, target, emptyText)
    return
  }

  const nodes = rows.map((row) => {
    const wrapper = doc.createElement('div')
    wrapper.className = 'timeseries-row'

    const label = createTextElement(doc, 'span', 'timeseries-date', row.dateLabel)
    const summary = createTextElement(doc, 'span', 'timeseries-summary', translateText(row.summary))

    const track = doc.createElement('div')
    track.className = 'timeseries-track'

    const bar = doc.createElement('div')
    bar.className = 'timeseries-bar'
    bar.setAttribute('style', `width: ${row.barWidth}`)
    track.append(bar)

    wrapper.append(label, track, summary)
    return wrapper
  })

  target.replaceChildren(...nodes)
}
