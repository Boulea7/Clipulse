import { describe, expect, it } from 'vitest'

import { createDashboardApp } from './dashboard.js'
import { renderMetricList, renderSectionTitle } from './dom.js'
import {
  buildDetailEntries,
  buildOverviewLines,
  buildProjectListItems,
  buildRecentSessionItems,
  buildTimeseriesRows,
} from './view-models.js'
import { formatDuration, formatTimestampLabel } from './formatters.js'
import {
  buildHomeHash,
  buildProjectHash,
  buildSessionHash,
  parseDashboardHash,
} from './routes.js'

class FakeElement {
  tagName: string
  children: FakeElement[]
  attributes: Record<string, string>
  className: string
  textContent: string
  href: string
  dataset: Record<string, string>
  innerHTML: string

  constructor(tagName: string) {
    this.tagName = tagName
    this.children = []
    this.attributes = {}
    this.className = ''
    this.textContent = ''
    this.href = ''
    this.dataset = {}
    this.innerHTML = '__unsafe__'
  }

  append(...nodes: FakeElement[]) {
    this.children.push(...nodes)
  }

  replaceChildren(...nodes: FakeElement[]) {
    this.children = [...nodes]
  }

  setAttribute(name: string, value: string) {
    this.attributes[name] = value
  }
}

class FakeDocument {
  nodes: Record<string, FakeElement>

  constructor(nodes = {}) {
    this.nodes = nodes
  }

  createElement(tagName: string) {
    return new FakeElement(tagName)
  }

  querySelector(selector: string) {
    if (!selector.startsWith('#')) {
      return null
    }

    return this.nodes[selector.slice(1)] ?? null
  }
}

class FakeWindow {
  location: { hash: string }
  listeners: Record<string, (() => void)[]>

  constructor(hash = '') {
    this.location = { hash }
    this.listeners = {}
  }

  addEventListener(eventName: string, listener: () => void) {
    this.listeners[eventName] ??= []
    this.listeners[eventName].push(listener)
  }

  dispatch(eventName: string) {
    for (const listener of this.listeners[eventName] ?? []) {
      listener()
    }
  }
}

const fakeDocument = new FakeDocument()

function createDashboardNodes() {
  return {
    'view-title': new FakeElement('h2'),
    'view-description': new FakeElement('p'),
    'view-nav': new FakeElement('nav'),
    'detail-title': new FakeElement('h3'),
    'detail-description': new FakeElement('p'),
    overview: new FakeElement('div'),
    languages: new FakeElement('div'),
    models: new FakeElement('div'),
    hosts: new FakeElement('div'),
    projects: new FakeElement('div'),
    'sessions-title': new FakeElement('h3'),
    sessions: new FakeElement('div'),
    timeseries: new FakeElement('div'),
    'detail-panel': new FakeElement('div'),
  }
}

function okJson(payload: unknown) {
  return {
    ok: true,
    status: 200,
    async json() {
      return payload
    },
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })

  return { promise, resolve }
}

function buildBaseDashboardPayloads(overrides: Record<string, unknown> = {}) {
  return {
    '/api/v1/overview': {
      totals: { events: 8, active_ms: 180_000, wait_ms: 45_000 },
      today: { events: 3, active_ms: 60_000, wait_ms: 10_000 },
      this_week: { events: 6, active_ms: 120_000, wait_ms: 20_000 },
    },
    '/api/v1/breakdown/languages': { items: [] },
    '/api/v1/breakdown/models': { items: [] },
    '/api/v1/breakdown/hosts': { items: [] },
    '/api/v1/projects/top?limit=5': { items: [] },
    '/api/v1/sessions/recent?limit=10': { items: [] },
    '/api/v1/timeseries': { items: [] },
    '/api/v1/status': {
      api: { status: 'ok', version: '0.1.0' },
      db: { status: 'ok', events: 8, projects: 0, sessions: 0 },
      spool: {
        state_dir: '/tmp/clipulse',
        ready: 0,
        processing: 0,
        quarantine: 0,
        ready_bytes: 0,
        processing_bytes: 0,
        quarantine_bytes: 0,
        oldest_backlog_age_seconds: 0,
        oldest_quarantine_age_seconds: 0,
      },
    },
    ...overrides,
  }
}

describe('dashboard formatters', () => {
  it('formats duration in a more human-readable form', () => {
    expect(formatDuration(0)).toBe('0 sec')
    expect(formatDuration(65_000)).toBe('1 min 5 sec')
    expect(formatDuration(3_660_000)).toBe('1 hr 1 min')
    expect(formatDuration(172_800_000)).toBe('2 days 0 hr')
  })

  it('formats timestamps for session detail summaries', () => {
    expect(formatTimestampLabel('2026-04-05T08:00:00Z')).toBe('Apr 5, 2026, 08:00 UTC')
  })
})

describe('dashboard routes', () => {
  it('parses home, project, and session hashes', () => {
    expect(parseDashboardHash('')).toEqual({ view: 'home' })
    expect(parseDashboardHash('#/projects/project-demo')).toEqual({
      view: 'project',
      projectRef: 'project-demo',
    })
    expect(parseDashboardHash('#/sessions/project-demo/session-2')).toEqual({
      view: 'session',
      projectRef: 'project-demo',
      sessionId: 'session-2',
    })
  })

  it('builds stable hashes for each dashboard view', () => {
    expect(buildHomeHash()).toBe('#/')
    expect(buildProjectHash('project/demo')).toBe('#/projects/project%2Fdemo')
    expect(buildSessionHash('session-2', 'project-demo')).toBe('#/sessions/project-demo/session-2')
  })
})

describe('dashboard view models', () => {
  it('builds overview lines with readable totals', () => {
    expect(
      buildOverviewLines({
        totals: { events: 8, active_ms: 180_000, wait_ms: 45_000 },
        today: { events: 3, active_ms: 60_000, wait_ms: 10_000 },
        this_week: { events: 6, active_ms: 120_000, wait_ms: 20_000 },
      }),
    ).toEqual([
      'Total events: 8',
      'Total active: 3 min 0 sec',
      'Total wait: 45 sec',
      'Today active: 1 min 0 sec',
      'This week active: 2 min 0 sec',
    ])
  })

  it('maps project and session data into route-aware list items', () => {
    expect(
      buildProjectListItems([
        {
          project_name: 'demo-api',
          project_ref: 'project-demo',
          events: 4,
          active_ms: 120_000,
          wait_ms: 30_000,
          changed_files_count: 2,
          lines_changed: 15,
          top_language: { name: 'TypeScript', changed: 9 },
        },
      ]),
    ).toEqual([
      {
        href: '#/projects/project-demo',
        label: 'demo-api',
        meta: '2 min 0 sec active . 15 lines . TypeScript . 2 files',
      },
    ])

    expect(
      buildRecentSessionItems([
        {
          session_id: 'session-2',
          project_name: 'demo-api',
          host: 'codex',
          model_name: 'gpt-5.4',
          project_ref: 'project-demo',
          events: 3,
          active_ms: 90_000,
          wait_ms: 10_000,
          last_event_time: '2026-04-05T08:00:00Z',
          changed_files_count: 1,
          lines_changed: 5,
          top_language: { name: 'TypeScript', changed: 5 },
          host_model_mix: [
            { host: 'codex', model_name: 'gpt-5.4', active_ms: 90_000, events: 3 },
            { host: 'claude-code', model_name: 'claude-sonnet', active_ms: 15_000, events: 1 },
          ],
        },
      ]),
    ).toEqual([
      {
        href: '#/sessions/project-demo/session-2',
        label: 'demo-api / session-2',
        meta: '1 min 30 sec active . 5 lines . TypeScript . 1 file . codex . gpt-5.4 . +1 host-model combo',
      },
    ])
  })

  it('builds project and session detail entries for the detail panel', () => {
    expect(
      buildDetailEntries(
        { view: 'project', projectRef: 'project-demo' },
        {
          overview: null,
          projects: { items: [] },
          sessions: { items: [] },
        },
        {
          projectDetail: {
            project_name: 'demo-api',
            project_ref: 'project-demo',
            active_ms: 120_000,
            wait_ms: 30_000,
            event_count: 4,
            session_count: 1,
            changed_files_count: 2,
            changed_languages_count: 2,
            lines_added: 12,
            lines_removed: 3,
            lines_changed: 15,
            top_language: { name: 'TypeScript', changed: 9 },
            file_preview: [
              { fingerprint: 'ts-rollup', language: 'TypeScript', added: 9, removed: 2 },
              { fingerprint: 'py-rollup', language: 'Python', added: 3, removed: 1 },
            ],
            languages: [
              { name: 'TypeScript', changed: 9 },
              { name: 'Python', changed: 4 },
            ],
            host_model_mix: [{ host: 'codex', model_name: 'gpt-5.4', active_ms: 120_000 }],
            sessions: [{ session_id: 'session-2' }],
          },
        },
      ),
    ).toEqual({
      title: 'Project: demo-api',
      description: 'Recent session aggregates for this project. Clipulse reports compact, local-first heuristics instead of a full audit log.',
      entries: [
        ['Project ref', 'project-demo'],
        ['Active time', '2 min 0 sec'],
        ['Wait time', '30 sec'],
        ['Events', '4'],
        ['Sessions', '1'],
        ['Changed files', '2 files . ts-rollup +9/-2, py-rollup +3/-1'],
        ['Languages', '2 languages . TypeScript leads (9 lines)'],
        ['Line changes', '15 lines . +12 / -3'],
        ['File identifiers', 'Fingerprints are privacy-safe file IDs, not raw paths or source excerpts.'],
        ['Host-model mix', '1 host-model combo . codex / gpt-5.4 (2 min 0 sec active)'],
        ['Project sessions', '1 session'],
      ],
    })

    expect(
      buildDetailEntries(
        { view: 'session', sessionId: 'session-2', projectRef: 'project-demo' },
        {
          overview: null,
          projects: { items: [] },
          sessions: { items: [] },
        },
        {
          sessionDetail: {
            session_id: 'session-2',
            project_name: 'demo-api',
            project_ref: 'project-demo',
            git_branch: 'feat/v1-alpha',
            host: 'codex',
            model_name: 'gpt-5.4',
            event_count: 3,
            active_ms: 90_000,
            wait_ms: 10_000,
            languages: [{ name: 'TypeScript', changed: 5 }],
            file_deltas: [{ fingerprint: 'abc', language: 'TypeScript', added: 5, removed: 0 }],
            file_preview: [{ fingerprint: 'abc', language: 'TypeScript', added: 5, removed: 0 }],
            changed_files_count: 1,
            changed_languages_count: 1,
            lines_added: 5,
            lines_removed: 0,
            lines_changed: 5,
            top_language: { name: 'TypeScript', changed: 5 },
            host_model_mix: [{ host: 'codex', model_name: 'gpt-5.4', active_ms: 90_000 }],
            last_event_time: '2026-04-05T08:00:00Z',
          },
        },
      ),
    ).toEqual({
      title: 'Session: demo-api / session-2',
      description: 'Aggregated session activity and file delta summary. Clipulse reports compact, local-first heuristics instead of a full audit log.',
      entries: [
        ['Project', 'demo-api'],
        ['Project ref', 'project-demo'],
        ['Active time', '1 min 30 sec'],
        ['Wait time', '10 sec'],
        ['Events', '3'],
        ['Host', 'codex'],
        ['Model', 'gpt-5.4'],
        ['Branch', 'feat/v1-alpha'],
        ['Host-model mix', '1 host-model combo . codex / gpt-5.4 (1 min 30 sec active)'],
        ['Changed files', '1 file . abc +5/-0'],
        ['Languages', '1 language . TypeScript leads (5 lines)'],
        ['Line changes', '5 lines . +5 / -0'],
        ['File identifiers', 'Fingerprints are privacy-safe file IDs, not raw paths or source excerpts.'],
        ['Last event', 'Apr 5, 2026, 08:00 UTC'],
      ],
    })
  })

  it('explains zero-change detail states without treating them as failures', () => {
    expect(
      buildDetailEntries(
        { view: 'session', sessionId: 'session-quiet', projectRef: 'project-demo' },
        {
          overview: null,
          projects: { items: [] },
          sessions: { items: [] },
        },
        {
          sessionDetail: {
            session_id: 'session-quiet',
            project_name: 'demo-api',
            project_ref: 'project-demo',
            git_branch: 'main',
            host: 'codex',
            model_name: 'gpt-5.4',
            event_count: 1,
            active_ms: 15_000,
            wait_ms: 0,
            languages: [],
            file_deltas: [],
            file_preview: [],
            changed_files_count: 0,
            changed_languages_count: 0,
            lines_added: 0,
            lines_removed: 0,
            lines_changed: 0,
            top_language: null,
            host_model_mix: [],
            last_event_time: '2026-04-05T08:00:00Z',
          },
        },
      ),
    ).toEqual({
      title: 'Session: demo-api / session-quiet',
      description: 'Aggregated session activity and file delta summary. Clipulse reports compact, local-first heuristics instead of a full audit log.',
      entries: [
        ['Project', 'demo-api'],
        ['Project ref', 'project-demo'],
        ['Active time', '15 sec'],
        ['Wait time', '0 sec'],
        ['Events', '1'],
        ['Host', 'codex'],
        ['Model', 'gpt-5.4'],
        ['Branch', 'main'],
        ['Host-model mix', 'None'],
        ['Changed files', '0 files'],
        ['Languages', '0 languages'],
        ['Line changes', '0 lines . +0 / -0'],
        ['Change tracking', 'No file delta summary yet. This can be normal for prompt-only activity, read-only commands, or the first Codex snapshot baseline.'],
        ['File identifiers', 'Fingerprints are privacy-safe file IDs, not raw paths or source excerpts.'],
        ['Last event', 'Apr 5, 2026, 08:00 UTC'],
      ],
    })
  })

  it('builds a lightweight daily timeseries summary', () => {
    expect(
      buildTimeseriesRows([
        { date: '2026-04-04', events: 2, active_ms: 60_000, wait_ms: 10_000 },
        { date: '2026-04-05', events: 4, active_ms: 180_000, wait_ms: 20_000 },
      ]),
    ).toEqual([
      {
        dateLabel: 'Apr 4',
        summary: '1 min 0 sec active . 2 events',
        barWidth: '33%',
      },
      {
        dateLabel: 'Apr 5',
        summary: '3 min 0 sec active . 4 events',
        barWidth: '100%',
      },
    ])
  })
})

describe('dashboard DOM rendering', () => {
  it('renders metric lines without using innerHTML', () => {
    const target = new FakeElement('div')

    renderMetricList(fakeDocument, target, ['<script>alert(1)</script>', 'Safe text'])

    expect(target.innerHTML).toBe('__unsafe__')
    expect(target.children).toHaveLength(2)
    expect(target.children[0].textContent).toBe('<script>alert(1)</script>')
    expect(target.children[0].className).toBe('metric')
  })

  it('renders section titles as plain text content', () => {
    const target = new FakeElement('h2')

    renderSectionTitle(target, 'Session view')

    expect(target.textContent).toBe('Session view')
  })
})

describe('dashboard app wiring', () => {
  it('keeps startup copy in a loading state instead of rendering failure copy', async () => {
    const nodes = createDashboardNodes()
    const doc = new FakeDocument(nodes)
    const win = new FakeWindow('#/')
    const fetchImpl = async () => new Promise(() => {})

    const app = createDashboardApp({ doc, win, fetchImpl })
    void app.start()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(nodes.overview.children[0]?.textContent).toBe('Loading overview...')
    expect(nodes.languages.children[0]?.textContent).toBe('Loading language data...')
    expect(nodes.sessions.children[0]?.textContent).toBe('Loading recent sessions...')
  })

  it('keeps project route chrome stable while bootstrap responses are still pending', async () => {
    const nodes = createDashboardNodes()
    const doc = new FakeDocument(nodes)
    const win = new FakeWindow('#/projects/project-demo')
    const overview = createDeferred<unknown>()
    const languages = createDeferred<unknown>()
    const models = createDeferred<unknown>()
    const hosts = createDeferred<unknown>()
    const projects = createDeferred<unknown>()
    const sessions = createDeferred<unknown>()
    const timeseries = createDeferred<unknown>()
    const status = createDeferred<unknown>()
    const fetchImpl = async (path: string) => {
      if (path === '/api/v1/overview') {
        return overview.promise
      }
      if (path === '/api/v1/breakdown/languages') {
        return languages.promise
      }
      if (path === '/api/v1/breakdown/models') {
        return models.promise
      }
      if (path === '/api/v1/breakdown/hosts') {
        return hosts.promise
      }
      if (path === '/api/v1/projects/top?limit=5') {
        return projects.promise
      }
      if (path === '/api/v1/sessions/recent?limit=10') {
        return sessions.promise
      }
      if (path === '/api/v1/timeseries') {
        return timeseries.promise
      }
      if (path === '/api/v1/status') {
        return status.promise
      }
      return new Promise(() => {})
    }

    const app = createDashboardApp({ doc, win, fetchImpl })
    void app.start()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(nodes['view-title'].textContent).toBe('Project view')
    expect(nodes['detail-title'].textContent).toBe('Project detail loading')
    expect(nodes['sessions-title'].textContent).toBe('Project Sessions')
    expect(nodes.sessions.children[0]?.textContent).toBe('Loading project sessions...')

    overview.resolve(okJson({
      totals: { events: 8, active_ms: 180_000, wait_ms: 45_000 },
      today: { events: 3, active_ms: 60_000, wait_ms: 10_000 },
      this_week: { events: 6, active_ms: 120_000, wait_ms: 20_000 },
    }))
    languages.resolve(okJson({ items: [] }))
    models.resolve(okJson({ items: [] }))
    hosts.resolve(okJson({ items: [] }))
    projects.resolve(okJson({ items: [] }))
    sessions.resolve(okJson({ items: [] }))
    timeseries.resolve(okJson({ items: [] }))
    status.resolve(okJson({
      api: { status: 'ok', version: '0.1.0' },
      db: { status: 'ok', events: 8, projects: 1, sessions: 0 },
      spool: {
        state_dir: '/tmp/clipulse',
        ready: 0,
        processing: 0,
        quarantine: 0,
        ready_bytes: 0,
        processing_bytes: 0,
        quarantine_bytes: 0,
        oldest_backlog_age_seconds: 0,
        oldest_quarantine_age_seconds: 0,
      },
    }))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(nodes['view-title'].textContent).toBe('Project view')
    expect(nodes['detail-title'].textContent).toBe('Project detail loading')
    expect(nodes['sessions-title'].textContent).toBe('Project Sessions')
    expect(nodes.sessions.children[0]?.textContent).toBe('Loading project sessions...')
  })

  it('updates the detail panel when the hash route changes', async () => {
    const nodes = {
      'view-title': new FakeElement('h2'),
      'view-description': new FakeElement('p'),
      'view-nav': new FakeElement('nav'),
      'detail-title': new FakeElement('h3'),
      'detail-description': new FakeElement('p'),
      overview: new FakeElement('div'),
      languages: new FakeElement('div'),
      models: new FakeElement('div'),
      hosts: new FakeElement('div'),
      projects: new FakeElement('div'),
      'sessions-title': new FakeElement('h3'),
      sessions: new FakeElement('div'),
      timeseries: new FakeElement('div'),
      'detail-panel': new FakeElement('div'),
    }
    const doc = new FakeDocument(nodes)
    const win = new FakeWindow('#/sessions/project-demo/session-2')
    const payloads: Record<string, unknown> = {
      '/api/v1/overview': {
        totals: { events: 8, active_ms: 180_000, wait_ms: 45_000 },
        today: { events: 3, active_ms: 60_000, wait_ms: 10_000 },
        this_week: { events: 6, active_ms: 120_000, wait_ms: 20_000 },
      },
      '/api/v1/breakdown/languages': { items: [{ name: 'TypeScript', changed: 42 }] },
      '/api/v1/breakdown/models': { items: [{ name: 'gpt-5.4', active_ms: 120_000 }] },
      '/api/v1/breakdown/hosts': { items: [{ name: 'codex', active_ms: 120_000 }] },
      '/api/v1/projects/top?limit=5': {
        items: [{
          project_name: 'demo-api',
          project_ref: 'project-demo',
          events: 4,
          active_ms: 120_000,
          wait_ms: 30_000,
          changed_files_count: 2,
          lines_changed: 15,
          top_language: { name: 'TypeScript', changed: 9 },
        }],
      },
      '/api/v1/sessions/recent?limit=10': {
        items: [
          {
            session_id: 'session-2',
            project_name: 'demo-api',
            project_ref: 'project-demo',
            host: 'codex',
            model_name: 'gpt-5.4',
            events: 3,
            active_ms: 90_000,
            wait_ms: 10_000,
            last_event_time: '2026-04-05T08:00:00Z',
            changed_files_count: 1,
            lines_changed: 5,
            top_language: { name: 'TypeScript', changed: 5 },
            host_model_mix: [
              { host: 'codex', model_name: 'gpt-5.4', active_ms: 90_000, events: 3 },
              { host: 'claude-code', model_name: 'claude-sonnet', active_ms: 15_000, events: 1 },
            ],
          },
        ],
      },
      '/api/v1/timeseries': {
        items: [{ date: '2026-04-05', events: 4, active_ms: 180_000, wait_ms: 20_000 }],
      },
      '/api/v1/status': {
        api: { status: 'ok', version: '0.1.0' },
        db: { status: 'ok', events: 8, projects: 1, sessions: 1 },
        spool: {
          state_dir: '/tmp/clipulse',
          ready: 0,
          processing: 0,
          quarantine: 0,
        },
      },
      '/api/v1/sessions/session-2?project_ref=project-demo': {
        session_id: 'session-2',
        project_name: 'demo-api',
        project_ref: 'project-demo',
        git_branch: 'feat/v1-alpha',
        host: 'codex',
        model_name: 'gpt-5.4',
        event_count: 3,
        active_ms: 90_000,
        wait_ms: 10_000,
        languages: [{ name: 'TypeScript', changed: 5 }],
        file_deltas: [{ fingerprint: 'abc', language: 'TypeScript', added: 5, removed: 0 }],
        file_preview: [{ fingerprint: 'abc', language: 'TypeScript', added: 5, removed: 0 }],
        changed_files_count: 1,
        changed_languages_count: 1,
        lines_added: 5,
        lines_removed: 0,
        lines_changed: 5,
        top_language: { name: 'TypeScript', changed: 5 },
        host_model_mix: [{ host: 'codex', model_name: 'gpt-5.4', active_ms: 90_000 }],
        last_event_time: '2026-04-05T08:00:00Z',
      },
      '/api/v1/projects/project-demo': {
        project_name: 'demo-api',
        project_ref: 'project-demo',
        active_ms: 120_000,
        wait_ms: 30_000,
        event_count: 4,
        session_count: 1,
        changed_files_count: 2,
        changed_languages_count: 2,
        lines_added: 12,
        lines_removed: 3,
        lines_changed: 15,
        top_language: { name: 'TypeScript', changed: 9 },
        file_preview: [
          { fingerprint: 'ts-rollup', language: 'TypeScript', added: 9, removed: 2 },
          { fingerprint: 'py-rollup', language: 'Python', added: 3, removed: 1 },
        ],
        languages: [
          { name: 'TypeScript', changed: 9 },
          { name: 'Python', changed: 4 },
        ],
        host_model_mix: [{ host: 'codex', model_name: 'gpt-5.4', active_ms: 120_000 }],
      },
      '/api/v1/projects/project-demo/sessions?limit=10': {
        project_name: 'demo-api',
        project_ref: 'project-demo',
        items: [{
          session_id: 'session-2',
          project_name: 'demo-api',
          project_ref: 'project-demo',
          host: 'codex',
          model_name: 'gpt-5.4',
          git_branch: 'feat/v1-alpha',
          first_event_time: '2026-04-05T08:00:00Z',
          last_event_time: '2026-04-05T08:00:00Z',
          event_count: 3,
          events: 3,
          active_ms: 90_000,
          wait_ms: 10_000,
          changed_files_count: 1,
          changed_languages_count: 1,
          lines_added: 5,
          lines_removed: 0,
          lines_changed: 5,
          top_language: { name: 'TypeScript', changed: 5 },
          host_model_mix: [{ host: 'codex', model_name: 'gpt-5.4', active_ms: 90_000 }],
          host_model_mix_count: 1,
          host_model_primary: { host: 'codex', model_name: 'gpt-5.4', active_ms: 90_000 },
        }],
      },
    }
    const fetchImpl = async (path: string) => ({
      ok: true,
      async json() {
        return payloads[path]
      },
    })

    const app = createDashboardApp({ doc, win, fetchImpl })
    await app.start()

    expect(nodes['detail-title'].textContent).toBe('Session: demo-api / session-2')
    expect(nodes.sessions.children[0].className).toContain('linked-item-active')
    expect(nodes['sessions-title'].textContent).toBe('Recent Sessions')
    expect(nodes['view-nav'].children).toHaveLength(3)
    expect(nodes['view-nav'].children[0].href).toBe('#/')
    expect(nodes['view-nav'].children[1].href).toBe('#/projects/project-demo')

    win.location.hash = '#/projects/project-demo'
    win.dispatch('hashchange')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(nodes['detail-title'].textContent).toBe('Project: demo-api')
    expect(nodes.projects.children[0].className).toContain('linked-item-active')
    expect(nodes['sessions-title'].textContent).toBe('Project Sessions')
    expect(nodes.sessions.children[0].children[0].textContent).toBe('demo-api / session-2')
    expect(nodes['view-nav'].children).toHaveLength(2)
    expect(nodes['view-nav'].children[1].href).toBe('#/projects/project-demo')
  })

  it('does not flash stale project detail or sessions when switching between project routes', async () => {
    const nodes = createDashboardNodes()
    const doc = new FakeDocument(nodes)
    const win = new FakeWindow('#/projects/project-a')
    const projectBDetail = createDeferred<unknown>()
    const projectBSessions = createDeferred<unknown>()
    const payloads = buildBaseDashboardPayloads({
      '/api/v1/projects/top?limit=5': {
        items: [
          { project_name: 'demo-a', project_ref: 'project-a', events: 3, active_ms: 90_000, wait_ms: 5_000, changed_files_count: 1, lines_changed: 7, top_language: { name: 'TypeScript', changed: 7 } },
          { project_name: 'demo-b', project_ref: 'project-b', events: 2, active_ms: 45_000, wait_ms: 0, changed_files_count: 1, lines_changed: 4, top_language: { name: 'Python', changed: 4 } },
        ],
      },
      '/api/v1/projects/project-a': {
        project_name: 'demo-a',
        project_ref: 'project-a',
        active_ms: 90_000,
        wait_ms: 5_000,
        event_count: 3,
        session_count: 1,
        changed_files_count: 1,
        changed_languages_count: 1,
        lines_added: 7,
        lines_removed: 0,
        lines_changed: 7,
        top_language: { name: 'TypeScript', changed: 7 },
        file_preview: [{ fingerprint: 'a-file', language: 'TypeScript', added: 7, removed: 0 }],
        languages: [{ name: 'TypeScript', changed: 7 }],
        host_model_mix: [{ host: 'codex', model_name: 'gpt-5.4', active_ms: 90_000 }],
      },
      '/api/v1/projects/project-a/sessions?limit=10': {
        project_name: 'demo-a',
        project_ref: 'project-a',
        items: [{
          session_id: 'session-a',
          project_name: 'demo-a',
          project_ref: 'project-a',
          host: 'codex',
          model_name: 'gpt-5.4',
          git_branch: 'main',
          first_event_time: '2026-04-05T08:00:00Z',
          last_event_time: '2026-04-05T08:05:00Z',
          event_count: 3,
          events: 3,
          active_ms: 90_000,
          wait_ms: 5_000,
          changed_files_count: 1,
          changed_languages_count: 1,
          lines_added: 7,
          lines_removed: 0,
          lines_changed: 7,
          top_language: { name: 'TypeScript', changed: 7 },
          host_model_mix: [{ host: 'codex', model_name: 'gpt-5.4', active_ms: 90_000 }],
          host_model_mix_count: 1,
          host_model_primary: { host: 'codex', model_name: 'gpt-5.4', active_ms: 90_000 },
        }],
      },
    })
    const fetchImpl = async (path: string) => {
      if (path === '/api/v1/projects/project-b') {
        return projectBDetail.promise
      }
      if (path === '/api/v1/projects/project-b/sessions?limit=10') {
        return projectBSessions.promise
      }
      return okJson(payloads[path])
    }

    const app = createDashboardApp({ doc, win, fetchImpl })
    await app.start()

    expect(nodes['detail-title'].textContent).toBe('Project: demo-a')
    expect(nodes.sessions.children[0]?.children[0].textContent).toBe('demo-a / session-a')

    win.location.hash = '#/projects/project-b'
    win.dispatch('hashchange')

    expect(nodes['detail-title'].textContent).toBe('Project detail loading')
    expect(nodes.sessions.children[0]?.textContent).toBe('Loading project sessions...')

    projectBDetail.resolve(okJson({
      project_name: 'demo-b',
      project_ref: 'project-b',
      active_ms: 45_000,
      wait_ms: 0,
      event_count: 2,
      session_count: 1,
      changed_files_count: 1,
      changed_languages_count: 1,
      lines_added: 4,
      lines_removed: 0,
      lines_changed: 4,
      top_language: { name: 'Python', changed: 4 },
      file_preview: [{ fingerprint: 'b-file', language: 'Python', added: 4, removed: 0 }],
      languages: [{ name: 'Python', changed: 4 }],
      host_model_mix: [{ host: 'codex', model_name: 'gpt-5.4', active_ms: 45_000 }],
    }))
    projectBSessions.resolve(okJson({
      project_name: 'demo-b',
      project_ref: 'project-b',
      items: [],
    }))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(nodes['detail-title'].textContent).toBe('Project: demo-b')
  })

  it('ignores stale responses from an older visit to the same project route', async () => {
    const nodes = createDashboardNodes()
    const doc = new FakeDocument(nodes)
    const win = new FakeWindow('#/projects/project-a')
    const oldProjectDetail = createDeferred<unknown>()
    const oldProjectSessions = createDeferred<unknown>()
    let projectDetailCalls = 0
    let projectSessionCalls = 0
    const payloads = buildBaseDashboardPayloads({
      '/api/v1/projects/top?limit=5': {
        items: [{ project_name: 'demo-a', project_ref: 'project-a', events: 3, active_ms: 90_000, wait_ms: 5_000, changed_files_count: 1, lines_changed: 7, top_language: { name: 'TypeScript', changed: 7 } }],
      },
    })
    const fetchImpl = async (path: string) => {
      if (path === '/api/v1/projects/project-a') {
        projectDetailCalls += 1
        if (projectDetailCalls === 1) {
          return oldProjectDetail.promise
        }
        return okJson({
          project_name: 'demo-a-fresh',
          project_ref: 'project-a',
          active_ms: 120_000,
          wait_ms: 10_000,
          event_count: 4,
          session_count: 1,
          changed_files_count: 1,
          changed_languages_count: 1,
          lines_added: 9,
          lines_removed: 0,
          lines_changed: 9,
          top_language: { name: 'TypeScript', changed: 9 },
          file_preview: [{ fingerprint: 'fresh-file', language: 'TypeScript', added: 9, removed: 0 }],
          languages: [{ name: 'TypeScript', changed: 9 }],
          host_model_mix: [{ host: 'codex', model_name: 'gpt-5.4', active_ms: 120_000 }],
        })
      }
      if (path === '/api/v1/projects/project-a/sessions?limit=10') {
        projectSessionCalls += 1
        if (projectSessionCalls === 1) {
          return oldProjectSessions.promise
        }
        return okJson({
          project_name: 'demo-a-fresh',
          project_ref: 'project-a',
          items: [{
            session_id: 'session-fresh',
            project_name: 'demo-a-fresh',
            project_ref: 'project-a',
            host: 'codex',
            model_name: 'gpt-5.4',
            git_branch: 'main',
            first_event_time: '2026-04-05T09:00:00Z',
            last_event_time: '2026-04-05T09:05:00Z',
            event_count: 4,
            events: 4,
            active_ms: 120_000,
            wait_ms: 10_000,
            changed_files_count: 1,
            changed_languages_count: 1,
            lines_added: 9,
            lines_removed: 0,
            lines_changed: 9,
            top_language: { name: 'TypeScript', changed: 9 },
            host_model_mix: [{ host: 'codex', model_name: 'gpt-5.4', active_ms: 120_000 }],
            host_model_mix_count: 1,
            host_model_primary: { host: 'codex', model_name: 'gpt-5.4', active_ms: 120_000 },
          }],
        })
      }
      return okJson(payloads[path])
    }

    const app = createDashboardApp({ doc, win, fetchImpl })
    void app.start()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(nodes['detail-title'].textContent).toBe('Project detail loading')

    win.location.hash = '#/'
    win.dispatch('hashchange')
    win.location.hash = '#/projects/project-a'
    win.dispatch('hashchange')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(nodes['detail-title'].textContent).toBe('Project: demo-a-fresh')
    expect(nodes.sessions.children[0]?.children[0].textContent).toBe('demo-a-fresh / session-fresh')

    oldProjectDetail.resolve(okJson({
      project_name: 'demo-a-stale',
      project_ref: 'project-a',
      active_ms: 60_000,
      wait_ms: 0,
      event_count: 1,
      session_count: 1,
      changed_files_count: 1,
      changed_languages_count: 1,
      lines_added: 2,
      lines_removed: 0,
      lines_changed: 2,
      top_language: { name: 'Python', changed: 2 },
      file_preview: [{ fingerprint: 'stale-file', language: 'Python', added: 2, removed: 0 }],
      languages: [{ name: 'Python', changed: 2 }],
      host_model_mix: [{ host: 'claude-code', model_name: 'claude-sonnet', active_ms: 60_000 }],
    }))
    oldProjectSessions.resolve(okJson({
      project_name: 'demo-a-stale',
      project_ref: 'project-a',
      items: [{
        session_id: 'session-stale',
        project_name: 'demo-a-stale',
        project_ref: 'project-a',
        host: 'claude-code',
        model_name: 'claude-sonnet',
        git_branch: 'main',
        first_event_time: '2026-04-05T07:00:00Z',
        last_event_time: '2026-04-05T07:05:00Z',
        event_count: 1,
        events: 1,
        active_ms: 60_000,
        wait_ms: 0,
        changed_files_count: 1,
        changed_languages_count: 1,
        lines_added: 2,
        lines_removed: 0,
        lines_changed: 2,
        top_language: { name: 'Python', changed: 2 },
        host_model_mix: [{ host: 'claude-code', model_name: 'claude-sonnet', active_ms: 60_000 }],
        host_model_mix_count: 1,
        host_model_primary: { host: 'claude-code', model_name: 'claude-sonnet', active_ms: 60_000 },
      }],
    }))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(nodes['detail-title'].textContent).toBe('Project: demo-a-fresh')
    expect(nodes.sessions.children[0]?.children[0].textContent).toBe('demo-a-fresh / session-fresh')
  })

  it('ignores stale responses from an older visit to the same session route', async () => {
    const nodes = createDashboardNodes()
    const doc = new FakeDocument(nodes)
    const win = new FakeWindow('#/sessions/project-demo/session-2')
    const oldSessionDetail = createDeferred<unknown>()
    let sessionDetailCalls = 0
    const payloads = buildBaseDashboardPayloads({
      '/api/v1/projects/top?limit=5': {
        items: [{ project_name: 'demo-api', project_ref: 'project-demo', events: 4, active_ms: 120_000, wait_ms: 30_000, changed_files_count: 2, lines_changed: 15, top_language: { name: 'TypeScript', changed: 9 } }],
      },
      '/api/v1/sessions/recent?limit=10': {
        items: [{
          session_id: 'session-2',
          project_name: 'demo-api',
          project_ref: 'project-demo',
          host: 'codex',
          model_name: 'gpt-5.4',
          events: 3,
          active_ms: 90_000,
          wait_ms: 10_000,
          last_event_time: '2026-04-05T08:00:00Z',
          changed_files_count: 1,
          lines_changed: 5,
          top_language: { name: 'TypeScript', changed: 5 },
          host_model_mix: [{ host: 'codex', model_name: 'gpt-5.4', active_ms: 90_000, events: 3 }],
        }],
      },
    })
    const fetchImpl = async (path: string) => {
      if (path === '/api/v1/sessions/session-2?project_ref=project-demo') {
        sessionDetailCalls += 1
        if (sessionDetailCalls === 1) {
          return oldSessionDetail.promise
        }
        return okJson({
          session_id: 'session-2',
          project_name: 'demo-api-fresh',
          project_ref: 'project-demo',
          git_branch: 'feat/fresh',
          host: 'codex',
          model_name: 'gpt-5.4',
          event_count: 4,
          active_ms: 120_000,
          wait_ms: 10_000,
          languages: [{ name: 'TypeScript', changed: 9 }],
          file_deltas: [{ fingerprint: 'fresh-session-file', language: 'TypeScript', added: 9, removed: 0 }],
          file_preview: [{ fingerprint: 'fresh-session-file', language: 'TypeScript', added: 9, removed: 0 }],
          changed_files_count: 1,
          changed_languages_count: 1,
          lines_added: 9,
          lines_removed: 0,
          lines_changed: 9,
          top_language: { name: 'TypeScript', changed: 9 },
          host_model_mix: [{ host: 'codex', model_name: 'gpt-5.4', active_ms: 120_000 }],
          last_event_time: '2026-04-05T09:05:00Z',
        })
      }
      return okJson(payloads[path])
    }

    const app = createDashboardApp({ doc, win, fetchImpl })
    void app.start()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(nodes['detail-title'].textContent).toBe('Session detail loading')

    win.location.hash = '#/'
    win.dispatch('hashchange')
    win.location.hash = '#/sessions/project-demo/session-2'
    win.dispatch('hashchange')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(nodes['detail-title'].textContent).toBe('Session: demo-api-fresh / session-2')

    oldSessionDetail.resolve(okJson({
      session_id: 'session-2',
      project_name: 'demo-api-stale',
      project_ref: 'project-demo',
      git_branch: 'feat/stale',
      host: 'claude-code',
      model_name: 'claude-sonnet',
      event_count: 1,
      active_ms: 15_000,
      wait_ms: 0,
      languages: [{ name: 'Python', changed: 2 }],
      file_deltas: [{ fingerprint: 'stale-session-file', language: 'Python', added: 2, removed: 0 }],
      file_preview: [{ fingerprint: 'stale-session-file', language: 'Python', added: 2, removed: 0 }],
      changed_files_count: 1,
      changed_languages_count: 1,
      lines_added: 2,
      lines_removed: 0,
      lines_changed: 2,
      top_language: { name: 'Python', changed: 2 },
      host_model_mix: [{ host: 'claude-code', model_name: 'claude-sonnet', active_ms: 15_000 }],
      last_event_time: '2026-04-05T07:05:00Z',
    }))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(nodes['detail-title'].textContent).toBe('Session: demo-api-fresh / session-2')
  })

  it('renders actionable detail errors when a project detail endpoint fails', async () => {
    const nodes = {
      'view-title': new FakeElement('h2'),
      'view-description': new FakeElement('p'),
      'view-nav': new FakeElement('nav'),
      'detail-title': new FakeElement('h3'),
      'detail-description': new FakeElement('p'),
      overview: new FakeElement('div'),
      languages: new FakeElement('div'),
      models: new FakeElement('div'),
      hosts: new FakeElement('div'),
      projects: new FakeElement('div'),
      'sessions-title': new FakeElement('h3'),
      sessions: new FakeElement('div'),
      timeseries: new FakeElement('div'),
      'detail-panel': new FakeElement('div'),
    }
    const doc = new FakeDocument(nodes)
    const win = new FakeWindow('#/projects/project-demo')
    const payloads: Record<string, unknown> = {
      '/api/v1/overview': {
        totals: { events: 8, active_ms: 180_000, wait_ms: 45_000 },
        today: { events: 3, active_ms: 60_000, wait_ms: 10_000 },
        this_week: { events: 6, active_ms: 120_000, wait_ms: 20_000 },
      },
      '/api/v1/breakdown/languages': { items: [{ name: 'TypeScript', changed: 42 }] },
      '/api/v1/breakdown/models': { items: [{ name: 'gpt-5.4', active_ms: 120_000 }] },
      '/api/v1/breakdown/hosts': { items: [{ name: 'codex', active_ms: 120_000 }] },
      '/api/v1/projects/top?limit=5': { items: [{ project_name: 'demo-api', project_ref: 'project-demo', events: 4, active_ms: 120_000, wait_ms: 30_000, changed_files_count: 2, lines_changed: 15, top_language: { name: 'TypeScript', changed: 9 } }] },
      '/api/v1/sessions/recent?limit=10': { items: [] },
      '/api/v1/timeseries': { items: [] },
      '/api/v1/status': {
        api: { status: 'ok', version: '0.1.0' },
        db: { status: 'ok', events: 8, projects: 1, sessions: 0 },
        spool: {
          state_dir: '/tmp/clipulse',
          ready: 3,
          processing: 1,
          quarantine: 0,
        },
      },
    }
    const fetchImpl = async (path: string) => {
      if (path === '/api/v1/projects/project-demo') {
        return {
          ok: false,
          status: 404,
          async json() {
            return {
              detail: {
                code: 'project_not_found',
                message: 'project was not found',
                hint: 'Open the home view and reselect a project from the latest snapshot.',
              },
            }
          },
        }
      }
      return {
        ok: true,
        status: 200,
        async json() {
          return payloads[path]
        },
      }
    }

    const app = createDashboardApp({ doc, win, fetchImpl })
    await app.start()

    expect(nodes['detail-title'].textContent).toBe('Project not found')
    expect(nodes['detail-description'].textContent).toBe(
      'This project is no longer available in the latest dashboard snapshot. Reopen the home view and pick it again.',
    )
    expect(nodes['detail-panel'].children[0].children[1].textContent).toContain('project was not found')
    expect(nodes['detail-panel'].children[1].children[1].textContent).toContain('reselect a project')
  })

  it('keeps project detail visible when the project sessions request fails', async () => {
    const nodes = createDashboardNodes()
    const doc = new FakeDocument(nodes)
    const win = new FakeWindow('#/projects/project-demo')
    const payloads = buildBaseDashboardPayloads({
      '/api/v1/projects/top?limit=5': {
        items: [{
          project_name: 'demo-api',
          project_ref: 'project-demo',
          events: 4,
          active_ms: 120_000,
          wait_ms: 30_000,
          changed_files_count: 2,
          lines_changed: 15,
          top_language: { name: 'TypeScript', changed: 9 },
        }],
      },
      '/api/v1/projects/project-demo': {
        project_name: 'demo-api',
        project_ref: 'project-demo',
        active_ms: 120_000,
        wait_ms: 30_000,
        event_count: 4,
        session_count: 1,
        changed_files_count: 2,
        changed_languages_count: 1,
        lines_added: 12,
        lines_removed: 3,
        lines_changed: 15,
        top_language: { name: 'TypeScript', changed: 15 },
        file_preview: [
          { fingerprint: 'ts-rollup', language: 'TypeScript', added: 12, removed: 3 },
        ],
        languages: [{ name: 'TypeScript', changed: 15 }],
        host_model_mix: [{ host: 'codex', model_name: 'gpt-5.4', active_ms: 120_000 }],
      },
    })
    const fetchImpl = async (path: string) => {
      if (path === '/api/v1/projects/project-demo/sessions?limit=10') {
        return {
          ok: false,
          status: 503,
          async json() {
            return {
              detail: {
                code: 'project_sessions_unavailable',
                message: 'project sessions feed is temporarily unavailable',
                hint: 'Retry the dedicated project sessions request after the API recovers.',
              },
            }
          },
        }
      }

      return okJson(payloads[path])
    }

    const app = createDashboardApp({ doc, win, fetchImpl })
    await app.start()

    expect(nodes['detail-title'].textContent).toBe('Project: demo-api')
    expect(nodes['detail-panel'].children[0].children[1].textContent).toBe('project-demo')
    expect(nodes['sessions-title'].textContent).toBe('Project Sessions')
    expect(nodes.sessions.children[0]?.textContent).toContain('Project sessions unavailable. Retry the dedicated')
    expect(nodes.sessions.children[0]?.textContent).toContain('API recovers.')
  })

  it('keeps project detail visible while project sessions are still pending', async () => {
    const nodes = createDashboardNodes()
    const doc = new FakeDocument(nodes)
    const win = new FakeWindow('#/projects/project-demo')
    const payloads = buildBaseDashboardPayloads({
      '/api/v1/projects/project-demo': {
        project_name: 'demo-api',
        project_ref: 'project-demo',
        active_ms: 120_000,
        wait_ms: 30_000,
        event_count: 4,
        session_count: 1,
        changed_files_count: 2,
        changed_languages_count: 1,
        lines_added: 12,
        lines_removed: 3,
        lines_changed: 15,
        top_language: { name: 'TypeScript', changed: 15 },
        file_preview: [
          { fingerprint: 'ts-rollup', language: 'TypeScript', added: 12, removed: 3 },
        ],
        languages: [{ name: 'TypeScript', changed: 15 }],
        host_model_mix: [{ host: 'codex', model_name: 'gpt-5.4', active_ms: 120_000 }],
      },
    })
    const fetchImpl = async (path: string) => {
      if (path === '/api/v1/projects/project-demo/sessions?limit=10') {
        return new Promise(() => {})
      }

      return okJson(payloads[path])
    }

    const app = createDashboardApp({ doc, win, fetchImpl })
    void app.start()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(nodes['detail-title'].textContent).toBe('Project: demo-api')
    expect(nodes['detail-panel'].children[0].children[1].textContent).toBe('project-demo')
    expect(nodes['sessions-title'].textContent).toBe('Project Sessions')
    expect(nodes.sessions.children[0]?.textContent).toBe('Loading project sessions...')
  })

  it('does not let a successful project sessions response mask a project detail failure', async () => {
    const nodes = createDashboardNodes()
    const doc = new FakeDocument(nodes)
    const win = new FakeWindow('#/projects/project-demo')
    const payloads = buildBaseDashboardPayloads({
      '/api/v1/projects/project-demo/sessions?limit=10': {
        project_name: 'demo-api',
        project_ref: 'project-demo',
        items: [{
          session_id: 'session-2',
          project_name: 'demo-api',
          project_ref: 'project-demo',
          host: 'codex',
          model_name: 'gpt-5.4',
          git_branch: 'feat/v1-alpha',
          first_event_time: '2026-04-05T08:00:00Z',
          last_event_time: '2026-04-05T08:10:00Z',
          event_count: 3,
          events: 3,
          active_ms: 90_000,
          wait_ms: 10_000,
          changed_files_count: 1,
          changed_languages_count: 1,
          lines_added: 5,
          lines_removed: 0,
          lines_changed: 5,
          top_language: { name: 'TypeScript', changed: 5 },
          host_model_mix: [{ host: 'codex', model_name: 'gpt-5.4', active_ms: 90_000 }],
          host_model_mix_count: 1,
          host_model_primary: { host: 'codex', model_name: 'gpt-5.4', active_ms: 90_000 },
        }],
      },
    })
    const fetchImpl = async (path: string) => {
      if (path === '/api/v1/projects/project-demo') {
        return {
          ok: false,
          status: 404,
          async json() {
            return {
              detail: {
                code: 'project_not_found',
                message: 'project was not found',
                hint: 'Open the home view and reselect a project from the latest snapshot.',
              },
            }
          },
        }
      }

      return okJson(payloads[path])
    }

    const app = createDashboardApp({ doc, win, fetchImpl })
    await app.start()

    expect(nodes['detail-title'].textContent).toBe('Project not found')
    expect(nodes.sessions.children[0]?.textContent).toBe('Project sessions unavailable. Open the home view and reselect a project from the latest snapshot.')
    expect(nodes.sessions.children[0]?.textContent).not.toContain('demo-api / session-2')
  })

  it('does not refetch the same project detail route after bootstrap catches up', async () => {
    const nodes = createDashboardNodes()
    const doc = new FakeDocument(nodes)
    const win = new FakeWindow('#/')
    const overview = createDeferred<unknown>()
    const languages = createDeferred<unknown>()
    const models = createDeferred<unknown>()
    const hosts = createDeferred<unknown>()
    const projects = createDeferred<unknown>()
    const sessions = createDeferred<unknown>()
    const timeseries = createDeferred<unknown>()
    const status = createDeferred<unknown>()
    let projectDetailCalls = 0
    let projectSessionCalls = 0
    const fetchImpl = async (path: string) => {
      if (path === '/api/v1/overview') {
        return overview.promise
      }
      if (path === '/api/v1/breakdown/languages') {
        return languages.promise
      }
      if (path === '/api/v1/breakdown/models') {
        return models.promise
      }
      if (path === '/api/v1/breakdown/hosts') {
        return hosts.promise
      }
      if (path === '/api/v1/projects/top?limit=5') {
        return projects.promise
      }
      if (path === '/api/v1/sessions/recent?limit=10') {
        return sessions.promise
      }
      if (path === '/api/v1/timeseries') {
        return timeseries.promise
      }
      if (path === '/api/v1/status') {
        return status.promise
      }
      if (path === '/api/v1/projects/project-demo') {
        projectDetailCalls += 1
        return new Promise(() => {})
      }
      if (path === '/api/v1/projects/project-demo/sessions?limit=10') {
        projectSessionCalls += 1
        return new Promise(() => {})
      }

      return new Promise(() => {})
    }

    const app = createDashboardApp({ doc, win, fetchImpl })
    void app.start()
    await new Promise((resolve) => setTimeout(resolve, 0))

    win.location.hash = '#/projects/project-demo'
    win.dispatch('hashchange')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(projectDetailCalls).toBe(1)
    expect(projectSessionCalls).toBe(1)

    overview.resolve(okJson({
      totals: { events: 8, active_ms: 180_000, wait_ms: 45_000 },
      today: { events: 3, active_ms: 60_000, wait_ms: 10_000 },
      this_week: { events: 6, active_ms: 120_000, wait_ms: 20_000 },
    }))
    languages.resolve(okJson({ items: [] }))
    models.resolve(okJson({ items: [] }))
    hosts.resolve(okJson({ items: [] }))
    projects.resolve(okJson({ items: [] }))
    sessions.resolve(okJson({ items: [] }))
    timeseries.resolve(okJson({ items: [] }))
    status.resolve(okJson({
      api: { status: 'ok', version: '0.1.0' },
      db: { status: 'ok', events: 8, projects: 0, sessions: 0 },
      spool: {
        state_dir: '/tmp/clipulse',
        ready: 0,
        processing: 0,
        quarantine: 0,
        ready_bytes: 0,
        processing_bytes: 0,
        quarantine_bytes: 0,
        oldest_backlog_age_seconds: 0,
        oldest_quarantine_age_seconds: 0,
      },
    }))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(projectDetailCalls).toBe(1)
    expect(projectSessionCalls).toBe(1)
  })

  it('keeps project session scope explicit while project detail is still loading', async () => {
    const nodes = createDashboardNodes()
    const doc = new FakeDocument(nodes)
    const win = new FakeWindow('#/projects/project-demo')
    const payloads = buildBaseDashboardPayloads({
      '/api/v1/sessions/recent?limit=10': {
        items: [{
          session_id: 'session-other',
          project_name: 'other-project',
          project_ref: 'project-other',
          host: 'codex',
          model_name: 'gpt-5.4',
          events: 2,
          active_ms: 45_000,
          wait_ms: 0,
          last_event_time: '2026-04-05T08:00:00Z',
          changed_files_count: 1,
          lines_changed: 5,
          top_language: { name: 'TypeScript', changed: 5 },
          host_model_mix: [{ host: 'codex', model_name: 'gpt-5.4', active_ms: 45_000, events: 2 }],
        }],
      },
    })
    const fetchImpl = async (requestPath: string) => {
      if (
        requestPath === '/api/v1/projects/project-demo'
        || requestPath === '/api/v1/projects/project-demo/sessions?limit=10'
      ) {
        return new Promise(() => {})
      }

      return okJson(payloads[requestPath])
    }

    const app = createDashboardApp({ doc, win, fetchImpl })
    void app.start()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(nodes['sessions-title'].textContent).toBe('Project Sessions')
    expect(nodes.sessions.children[0]?.textContent).toBe('Loading project sessions...')
    expect(nodes.sessions.children[0]?.textContent).not.toContain('other-project')
  })

  it('renders project-scoping guidance when a session detail endpoint is ambiguous', async () => {
    const nodes = {
      'view-title': new FakeElement('h2'),
      'view-description': new FakeElement('p'),
      'view-nav': new FakeElement('nav'),
      'detail-title': new FakeElement('h3'),
      'detail-description': new FakeElement('p'),
      overview: new FakeElement('div'),
      languages: new FakeElement('div'),
      models: new FakeElement('div'),
      hosts: new FakeElement('div'),
      projects: new FakeElement('div'),
      sessions: new FakeElement('div'),
      timeseries: new FakeElement('div'),
      'detail-panel': new FakeElement('div'),
    }
    const doc = new FakeDocument(nodes)
    const win = new FakeWindow('#/sessions/session-2')
    const payloads: Record<string, unknown> = {
      '/api/v1/overview': {
        totals: { events: 8, active_ms: 180_000, wait_ms: 45_000 },
        today: { events: 3, active_ms: 60_000, wait_ms: 10_000 },
        this_week: { events: 6, active_ms: 120_000, wait_ms: 20_000 },
      },
      '/api/v1/breakdown/languages': { items: [] },
      '/api/v1/breakdown/models': { items: [] },
      '/api/v1/breakdown/hosts': { items: [] },
      '/api/v1/projects/top?limit=5': { items: [] },
      '/api/v1/sessions/recent?limit=10': { items: [] },
      '/api/v1/timeseries': { items: [] },
      '/api/v1/status': {
        api: { status: 'ok', version: '0.1.0' },
        db: { status: 'ok', events: 8, projects: 1, sessions: 2 },
        spool: {
          state_dir: '/tmp/clipulse',
          ready: 1,
          processing: 0,
          quarantine: 0,
          ready_bytes: 128,
          processing_bytes: 0,
          quarantine_bytes: 0,
          oldest_backlog_age_seconds: 42,
          oldest_quarantine_age_seconds: 0,
        },
      },
    }
    const fetchImpl = async (path: string) => {
      if (path === '/api/v1/sessions/session-2') {
        return {
          ok: false,
          status: 409,
          async json() {
            return {
              detail: {
                code: 'ambiguous_session',
                message: 'session_id matched multiple projects',
                hint: 'Retry with the matching project_ref from /api/v1/projects/top or /api/v1/sessions/recent.',
              },
            }
          },
        }
      }
      return {
        ok: true,
        status: 200,
        async json() {
          return payloads[path]
        },
      }
    }

    const app = createDashboardApp({ doc, win, fetchImpl })
    await app.start()

    expect(nodes['detail-title'].textContent).toBe('Session detail needs project scope')
    expect(nodes['detail-description'].textContent).toBe(
      'This session id matched more than one project. Open the project-scoped session link or retry with the matching project_ref.',
    )
    expect(nodes['detail-panel'].children[0].children[1].textContent).toContain('multiple projects')
    expect(nodes['detail-panel'].children[1].children[1].textContent).toContain('project_ref')
  })

  it('shows a loading detail state instead of a fake not-found flash on initial deep links', () => {
    const nodes = {
      'view-title': new FakeElement('h2'),
      'view-description': new FakeElement('p'),
      'view-nav': new FakeElement('nav'),
      'detail-title': new FakeElement('h3'),
      'detail-description': new FakeElement('p'),
      overview: new FakeElement('div'),
      languages: new FakeElement('div'),
      models: new FakeElement('div'),
      hosts: new FakeElement('div'),
      projects: new FakeElement('div'),
      sessions: new FakeElement('div'),
      timeseries: new FakeElement('div'),
      'detail-panel': new FakeElement('div'),
    }
    const doc = new FakeDocument(nodes)
    const win = new FakeWindow('#/projects/project-demo')
    const fetchImpl = async () => new Promise(() => {})

    const app = createDashboardApp({ doc, win, fetchImpl })
    void app.start()

    expect(nodes['detail-title'].textContent).toBe('Project detail loading')
    expect(nodes['detail-panel'].children[0].children[1].textContent).toContain('Loading detail data')
  })

  it('shows dashboard status details on the home view', async () => {
    const nodes = {
      'view-title': new FakeElement('h2'),
      'view-description': new FakeElement('p'),
      'view-nav': new FakeElement('nav'),
      'detail-title': new FakeElement('h3'),
      'detail-description': new FakeElement('p'),
      overview: new FakeElement('div'),
      languages: new FakeElement('div'),
      models: new FakeElement('div'),
      hosts: new FakeElement('div'),
      projects: new FakeElement('div'),
      sessions: new FakeElement('div'),
      timeseries: new FakeElement('div'),
      'detail-panel': new FakeElement('div'),
    }
    const doc = new FakeDocument(nodes)
    const win = new FakeWindow('#/')
    const payloads: Record<string, unknown> = {
      '/api/v1/overview': {
        totals: { events: 8, active_ms: 180_000, wait_ms: 45_000 },
        today: { events: 3, active_ms: 60_000, wait_ms: 10_000 },
        this_week: { events: 6, active_ms: 120_000, wait_ms: 20_000 },
      },
      '/api/v1/breakdown/languages': { items: [] },
      '/api/v1/breakdown/models': { items: [] },
      '/api/v1/breakdown/hosts': { items: [] },
      '/api/v1/projects/top?limit=5': { items: [] },
      '/api/v1/sessions/recent?limit=10': { items: [] },
      '/api/v1/timeseries': { items: [] },
      '/api/v1/status': {
        api: { status: 'ok', version: '0.1.0' },
        db: { status: 'ok', events: 8, projects: 0, sessions: 0 },
        spool: {
          state_dir: '/tmp/clipulse',
          ready: 2,
          processing: 1,
          quarantine: 4,
          ready_bytes: 2048,
          processing_bytes: 512,
          quarantine_bytes: 1024,
          oldest_backlog_age_seconds: 3600,
          oldest_quarantine_age_seconds: 7200,
        },
      },
    }
    const fetchImpl = async (path: string) => ({
      ok: true,
      status: 200,
      async json() {
        return payloads[path]
      },
    })

    const app = createDashboardApp({ doc, win, fetchImpl })
    await app.start()

    expect(nodes['detail-title'].textContent).toBe('Home overview')
    expect(nodes['detail-panel'].children[4].children[0].textContent).toBe('System')
    expect(nodes['detail-panel'].children[4].children[1].textContent).toContain('API ok')
    expect(nodes['detail-panel'].children[5].children[0].textContent).toBe('Queue backlog')
    expect(nodes['detail-panel'].children[5].children[1].textContent).toContain('3 jobs pending')
    expect(nodes['detail-panel'].children[5].children[1].textContent).toContain('oldest backlog 1 hr 0 min')
    expect(nodes['detail-panel'].children[5].children[1].textContent).toContain('oldest quarantine 2 hr 0 min')
    expect(nodes['detail-panel'].children[6].children[0].textContent).toBe('Queue storage')
    expect(nodes['detail-panel'].children[6].children[1].textContent).toContain('3.5 KiB local state')
  })

  it('renders an explicit session-not-found state for dedicated session detail failures', async () => {
    const nodes = createDashboardNodes()
    const doc = new FakeDocument(nodes)
    const win = new FakeWindow('#/sessions/project-demo/session-missing')
    const payloads = buildBaseDashboardPayloads({
      '/api/v1/projects/top?limit=5': {
        items: [{ project_name: 'demo-api', project_ref: 'project-demo', events: 4, active_ms: 120_000 }],
      },
      '/api/v1/sessions/recent?limit=10': {
        items: [{
          session_id: 'session-missing',
          project_name: 'demo-api',
          project_ref: 'project-demo',
          host: 'codex',
          model_name: 'gpt-5.4',
          events: 1,
          active_ms: 15_000,
          wait_ms: 0,
          last_event_time: '2026-04-05T08:00:00Z',
          changed_files_count: 0,
          lines_changed: 0,
          top_language: null,
          host_model_mix: [],
        }],
      },
    })
    const fetchImpl = async (path: string) => {
      if (path === '/api/v1/sessions/session-missing?project_ref=project-demo') {
        return {
          ok: false,
          status: 404,
          async json() {
            return {
              detail: {
                code: 'session_not_found',
                message: 'session was not found for this project scope',
                hint: 'Open the project view and choose a session from the latest list.',
              },
            }
          },
        }
      }

      return okJson(payloads[path])
    }

    const app = createDashboardApp({ doc, win, fetchImpl })
    await app.start()

    expect(nodes['detail-title'].textContent).toBe('Session not found')
    expect(nodes['detail-description'].textContent).toBe(
      'This session is no longer available for the selected project scope. Open the project view and choose it again from the latest list.',
    )
    expect(nodes['detail-panel'].children[0].children[1].textContent).toContain('project scope')
    expect(nodes['detail-panel'].children[1].children[1].textContent).toContain('latest list')
  })

  it('makes home status-feed failures explicit in the detail panel', async () => {
    const nodes = createDashboardNodes()
    const doc = new FakeDocument(nodes)
    const win = new FakeWindow('#/')
    const payloads = buildBaseDashboardPayloads()
    const fetchImpl = async (path: string) => {
      if (path === '/api/v1/status') {
        return {
          ok: false,
          status: 503,
          async json() {
            return {
              detail: {
                code: 'status_unavailable',
                message: 'status feed is temporarily unavailable',
              },
            }
          },
        }
      }

      return okJson(payloads[path])
    }

    const app = createDashboardApp({ doc, win, fetchImpl })
    await app.start()

    expect(nodes['detail-title'].textContent).toBe('Home overview')
    expect(nodes['detail-description'].textContent).toContain('Status feed unavailable')
    expect(nodes['detail-panel'].children[4].children[0].textContent).toBe('System')
    expect(nodes['detail-panel'].children[4].children[1].textContent).toContain('/api/v1/status')
  })

  it('treats status 0 detail failures as a network-level issue', async () => {
    const nodes = createDashboardNodes()
    const doc = new FakeDocument(nodes)
    const win = new FakeWindow('#/sessions/project-demo/session-2')
    const payloads = buildBaseDashboardPayloads({
      '/api/v1/sessions/recent?limit=10': {
        items: [{
          session_id: 'session-2',
          project_name: 'demo-api',
          project_ref: 'project-demo',
          host: 'codex',
          model_name: 'gpt-5.4',
          events: 3,
          active_ms: 90_000,
          wait_ms: 10_000,
          last_event_time: '2026-04-05T08:00:00Z',
          changed_files_count: 1,
          lines_changed: 5,
          top_language: { name: 'TypeScript', changed: 5 },
          host_model_mix: [],
        }],
      },
    })
    const fetchImpl = async (path: string) => {
      if (path === '/api/v1/sessions/session-2?project_ref=project-demo') {
        throw new TypeError('fetch failed')
      }

      return okJson(payloads[path])
    }

    const app = createDashboardApp({ doc, win, fetchImpl })
    await app.start()

    expect(nodes['detail-title'].textContent).toBe('Session detail unavailable')
    expect(nodes['detail-description'].textContent).toContain('before the API returned an HTTP status')
    expect(nodes['detail-panel'].children[0].children[1].textContent).toContain('Network request failed')
  })

  it('keeps dedicated session detail visible when the summary session feed fails', async () => {
    const nodes = createDashboardNodes()
    const doc = new FakeDocument(nodes)
    const win = new FakeWindow('#/sessions/project-demo/session-2')
    const payloads = buildBaseDashboardPayloads({
      '/api/v1/projects/top?limit=5': {
        items: [{ project_name: 'demo-api', project_ref: 'project-demo', events: 4, active_ms: 120_000 }],
      },
      '/api/v1/sessions/session-2?project_ref=project-demo': {
        session_id: 'session-2',
        project_name: 'demo-api',
        project_ref: 'project-demo',
        git_branch: 'feat/v1-alpha',
        host: 'codex',
        model_name: 'gpt-5.4',
        event_count: 3,
        active_ms: 90_000,
        wait_ms: 10_000,
        languages: [{ name: 'TypeScript', changed: 5 }],
        file_deltas: [{ fingerprint: 'abc', language: 'TypeScript', added: 5, removed: 0 }],
        file_preview: [{ fingerprint: 'abc', language: 'TypeScript', added: 5, removed: 0 }],
        changed_files_count: 1,
        changed_languages_count: 1,
        lines_added: 5,
        lines_removed: 0,
        lines_changed: 5,
        top_language: { name: 'TypeScript', changed: 5 },
        host_model_mix: [{ host: 'codex', model_name: 'gpt-5.4', active_ms: 90_000 }],
        last_event_time: '2026-04-05T08:00:00Z',
      },
    })
    const fetchImpl = async (path: string) => {
      if (path === '/api/v1/sessions/recent?limit=10') {
        return {
          ok: false,
          status: 503,
          async json() {
            return {
              detail: {
                code: 'recent_sessions_unavailable',
                message: 'recent session feed is offline',
              },
            }
          },
        }
      }

      return okJson(payloads[path])
    }

    const app = createDashboardApp({ doc, win, fetchImpl })
    await app.start()

    expect(nodes['detail-title'].textContent).toBe('Session: demo-api / session-2')
    expect(nodes['detail-panel'].children[0].children[1].textContent).toBe('demo-api')
    expect(nodes.sessions.children[0].textContent).toBe('Unable to load recent sessions yet.')
  })

  it('uses project-scoped empty copy when a project has no sessions yet', async () => {
    const nodes = createDashboardNodes()
    const doc = new FakeDocument(nodes)
    const win = new FakeWindow('#/projects/project-demo')
    const payloads = buildBaseDashboardPayloads({
      '/api/v1/projects/top?limit=5': {
        items: [{ project_name: 'demo-api', project_ref: 'project-demo', events: 4, active_ms: 120_000 }],
      },
      '/api/v1/projects/project-demo': {
        project_name: 'demo-api',
        project_ref: 'project-demo',
        active_ms: 120_000,
        wait_ms: 30_000,
        event_count: 4,
        session_count: 0,
        changed_files_count: 0,
        changed_languages_count: 0,
        lines_added: 0,
        lines_removed: 0,
        lines_changed: 0,
        host_model_mix: [],
      },
      '/api/v1/projects/project-demo/sessions?limit=10': {
        project_name: 'demo-api',
        project_ref: 'project-demo',
        items: [],
      },
    })
    const fetchImpl = async (path: string) => okJson(payloads[path])

    const app = createDashboardApp({ doc, win, fetchImpl })
    await app.start()

    expect(nodes['detail-title'].textContent).toBe('Project: demo-api')
    expect(nodes.sessions.children[0].textContent).toBe('No sessions recorded for this project yet.')
  })
})
