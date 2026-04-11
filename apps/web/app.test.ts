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
import {
  buildCompactProjectSessionsPath,
  buildProjectSessionsPath,
  COMPACT_RECENT_SESSIONS_PATH,
  RECENT_SESSIONS_PATH,
} from './session-list-paths.js'

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
  history: { replaceState: (_state: null, _title: string, nextHash: string) => void }

  constructor(hash = '') {
    this.location = { hash }
    this.listeners = {}
    this.history = {
      replaceState: (_state, _title, nextHash) => {
        this.location.hash = nextHash
      },
    }
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

function isRecentSessionsPath(path: string) {
  return path === RECENT_SESSIONS_PATH || path === COMPACT_RECENT_SESSIONS_PATH
}

function isProjectSessionsPath(path: string, projectRef: string) {
  return (
    path === buildProjectSessionsPath(projectRef)
    || path === buildCompactProjectSessionsPath(projectRef)
  )
}

function buildBaseDashboardPayloads(overrides: Record<string, unknown> = {}) {
  const payloads = {
    '/api/v1/overview': {
      totals: { events: 8, active_ms: 180_000, wait_ms: 45_000 },
      today: { events: 3, active_ms: 60_000, wait_ms: 10_000 },
      this_week: { events: 6, active_ms: 120_000, wait_ms: 20_000 },
    },
    '/api/v1/breakdown/languages': { items: [] },
    '/api/v1/breakdown/models': { items: [] },
    '/api/v1/breakdown/hosts': { items: [] },
    '/api/v1/projects/top?limit=5': { items: [] },
    [RECENT_SESSIONS_PATH]: { items: [] },
    [COMPACT_RECENT_SESSIONS_PATH]: { items: [] },
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

  if (
    Object.prototype.hasOwnProperty.call(overrides, RECENT_SESSIONS_PATH)
    && !Object.prototype.hasOwnProperty.call(overrides, COMPACT_RECENT_SESSIONS_PATH)
  ) {
    payloads[COMPACT_RECENT_SESSIONS_PATH] = overrides[RECENT_SESSIONS_PATH]
  }

  for (const [path, payload] of Object.entries(overrides)) {
    const projectSessionsMatch = path.match(/^\/api\/v1\/projects\/([^/]+)\/sessions\?limit=10$/)
    if (projectSessionsMatch) {
      const projectRef = projectSessionsMatch[1] ?? ''
      const compactPath = buildCompactProjectSessionsPath(projectRef)
      if (!Object.prototype.hasOwnProperty.call(overrides, compactPath)) {
        payloads[compactPath] = payload
      }
    }
  }

  return payloads
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

  it('falls back for invalid timestamps instead of throwing or showing Invalid Date', () => {
    expect(formatTimestampLabel('not-a-real-timestamp')).toBe('Not recorded yet')
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

  it('falls back to home for malformed or over-segmented hashes', () => {
    expect(parseDashboardHash('#/projects/project-demo/extra')).toEqual({ view: 'home' })
    expect(parseDashboardHash('#/sessions/project-demo/session-2/extra')).toEqual({ view: 'home' })
    expect(parseDashboardHash('#/projects/%E0%A4%A')).toEqual({ view: 'home' })
    expect(parseDashboardHash('#/sessions/%E0%A4%A')).toEqual({ view: 'home' })
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

  it('defaults sparse overview payloads to zero-value summary lines', () => {
    expect(buildOverviewLines({})).toEqual([
      'Total events: 0',
      'Total active: 0 sec',
      'Total wait: 0 sec',
      'Today active: 0 sec',
      'This week active: 0 sec',
    ])

    expect(
      buildDetailEntries(
        { view: 'home' },
        {
          overview: {},
          projects: { items: [] },
          sessions: { items: [] },
          status: null,
          loadState: { status: 'fulfilled' },
        },
      ),
    ).toEqual(expect.objectContaining({
      entries: [
        ['Total events', '0'],
        ['Total active', '0 sec'],
        ['Total wait', '0 sec'],
        ['Today active', '0 sec'],
        ['This week active', '0 sec'],
      ],
    }))
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
          host: 'claude-code',
          model_name: 'claude-sonnet',
          project_ref: 'project-demo',
          events: 3,
          active_ms: 90_000,
          wait_ms: 10_000,
          last_event_time: '2026-04-05T08:00:00Z',
          changed_files_count: 1,
          lines_changed: 5,
          top_language: { name: 'TypeScript', changed: 5 },
          host_model_primary: {
            host: 'codex',
            model_name: 'gpt-5.4',
          },
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
        meta: '1 min 30 sec active . 5 lines . TypeScript . 1 file . Primary Codex / gpt-5.4 . +1 host-model combo',
      },
    ])
  })

  it('filters list items that cannot build safe project or session links', () => {
    expect(
      buildProjectListItems([
        {
          project_name: 'missing-ref',
          active_ms: 60_000,
        },
        {
          project_name: 'demo-api',
          project_ref: 'project-demo',
          active_ms: 120_000,
          events: 4,
        },
      ]),
    ).toEqual([
      {
        href: '#/projects/project-demo',
        label: 'demo-api',
        meta: '2 min 0 sec active . 4 events',
      },
    ])

    expect(
      buildRecentSessionItems([
        {
          session_id: 'session-missing-project',
          active_ms: 30_000,
        },
        {
          project_ref: 'project-demo',
          active_ms: 30_000,
        },
        {
          session_id: 'session-2',
          project_name: 'demo-api',
          project_ref: 'project-demo',
          active_ms: 90_000,
        },
      ]),
    ).toEqual([
      {
        href: '#/sessions/project-demo/session-2',
        label: 'demo-api / session-2',
        meta: '1 min 30 sec active',
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
            last_event_time: '2026-04-05T08:00:00Z',
            last_host: 'claude-code',
            last_model_name: 'claude-sonnet',
            last_git_branch: 'feat/handoff',
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
            host_model_primary: { host: 'codex', model_name: 'gpt-5.4', active_ms: 120_000 },
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
        ['Primary host-model', 'Codex / gpt-5.4'],
        ['Host-model mix', '1 host-model combo . Codex / gpt-5.4 (2 min 0 sec active)'],
        ['Last host', 'Claude Code'],
        ['Last model', 'claude-sonnet'],
        ['Last branch', 'feat/handoff'],
        ['Last event', 'Apr 5, 2026, 08:00 UTC'],
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
            git_branch: 'stale-branch',
            last_git_branch: 'feat/handoff',
            host: 'codex',
            last_host: 'claude-code',
            model_name: 'stale-model',
            last_model_name: 'claude-sonnet',
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
            host_model_primary: { host: 'codex', model_name: 'gpt-5.4', active_ms: 90_000 },
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
        ['Primary host-model', 'Codex / gpt-5.4'],
        ['Host-model mix', '1 host-model combo . Codex / gpt-5.4 (1 min 30 sec active)'],
        ['Last host', 'Claude Code'],
        ['Last model', 'claude-sonnet'],
        ['Last branch', 'feat/handoff'],
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
        ['Primary host-model', 'Not recorded yet'],
        ['Host-model mix', 'None'],
        ['Last host', 'Codex'],
        ['Last model', 'gpt-5.4'],
        ['Last branch', 'main'],
        ['Changed files', '0 files'],
        ['Languages', '0 languages'],
        ['Line changes', '0 lines . +0 / -0'],
        ['Change tracking', 'No file delta summary yet. This can be normal for prompt-only activity, read-only commands, or the first Codex snapshot baseline.'],
        ['File identifiers', 'Fingerprints are privacy-safe file IDs, not raw paths or source excerpts.'],
        ['Last event', 'Apr 5, 2026, 08:00 UTC'],
      ],
    })
  })

  it('falls back to file_deltas when file_preview is empty', () => {
    expect(
      buildDetailEntries(
        { view: 'session', sessionId: 'session-fallback', projectRef: 'project-demo' },
        {
          overview: null,
          projects: { items: [] },
          sessions: { items: [] },
        },
        {
          sessionDetail: {
            session_id: 'session-fallback',
            project_name: 'demo-api',
            project_ref: 'project-demo',
            git_branch: 'main',
            host: 'codex',
            model_name: 'gpt-5.4',
            event_count: 1,
            active_ms: 15_000,
            wait_ms: 0,
            languages: [{ name: 'TypeScript', changed: 5 }],
            file_deltas: [{ fingerprint: 'abc1234567890def', language: 'TypeScript', added: 5, removed: 0 }],
            file_preview: [],
            changed_files_count: 1,
            changed_languages_count: 1,
            lines_added: 5,
            lines_removed: 0,
            lines_changed: 5,
            top_language: { name: 'TypeScript', changed: 5 },
            host_model_mix: [{ host: 'codex', model_name: 'gpt-5.4', active_ms: 15_000 }],
            last_event_time: '2026-04-05T08:00:00Z',
          },
        },
      ),
    ).toEqual(expect.objectContaining({
      entries: expect.arrayContaining([
        ['Changed files', '1 file . abc12345 +5/-0'],
      ]),
    }))
  })

  it('keeps changed-file summaries stable when only file_preview truncation metadata is present', () => {
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
            session_count: 2,
            changed_files_count: 4,
            changed_languages_count: 2,
            lines_added: 12,
            lines_removed: 3,
            lines_changed: 15,
            file_preview: [],
            file_preview_truncated_count: 4,
            languages: [{ name: 'TypeScript', changed: 9 }],
            top_language: { name: 'TypeScript', changed: 9 },
            host_model_mix: [],
          },
        },
      ),
    ).toEqual(expect.objectContaining({
      entries: expect.arrayContaining([
        ['Changed files', '4 files . Backend preview truncated before dashboard display'],
      ]),
    }))
  })

  it('accounts for both hidden preview rows and truncated backend rows in changed-file summaries', () => {
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
            session_count: 2,
            changed_files_count: 4,
            changed_languages_count: 2,
            lines_added: 12,
            lines_removed: 3,
            lines_changed: 15,
            file_preview: [
              { fingerprint: 'abc11111', language: 'TypeScript', added: 5, removed: 0 },
              { fingerprint: 'def22222', language: 'Python', added: 4, removed: 1 },
              { fingerprint: 'ghi33333', language: 'Markdown', added: 3, removed: 0 },
            ],
            file_preview_truncated_count: 1,
            languages: [{ name: 'TypeScript', changed: 9 }],
            top_language: { name: 'TypeScript', changed: 9 },
            host_model_mix: [],
          },
        },
      ),
    ).toEqual(expect.objectContaining({
      entries: expect.arrayContaining([
        ['Changed files', '4 files . abc11111 +5/-0, def22222 +4/-1 . +1 more in dashboard preview . +1 more omitted by backend preview'],
      ]),
    }))
  })

  it('distinguishes backend preview truncation from dashboard-only hidden rows', () => {
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
            session_count: 2,
            changed_files_count: 4,
            changed_languages_count: 2,
            lines_added: 12,
            lines_removed: 3,
            lines_changed: 15,
            file_preview: [],
            file_preview_truncated_count: 4,
            languages: [{ name: 'TypeScript', changed: 9 }],
            top_language: { name: 'TypeScript', changed: 9 },
            host_model_mix: [],
          },
        },
      ),
    ).toEqual(expect.objectContaining({
      entries: expect.arrayContaining([
        ['Changed files', '4 files . Backend preview truncated before dashboard display'],
      ]),
    }))

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
            session_count: 2,
            changed_files_count: 4,
            changed_languages_count: 2,
            lines_added: 12,
            lines_removed: 3,
            lines_changed: 15,
            file_preview: [
              { fingerprint: 'abc11111', language: 'TypeScript', added: 5, removed: 0 },
              { fingerprint: 'def22222', language: 'Python', added: 4, removed: 1 },
              { fingerprint: 'ghi33333', language: 'Markdown', added: 3, removed: 0 },
            ],
            file_preview_truncated_count: 1,
            languages: [{ name: 'TypeScript', changed: 9 }],
            top_language: { name: 'TypeScript', changed: 9 },
            host_model_mix: [],
          },
        },
      ),
    ).toEqual(expect.objectContaining({
      entries: expect.arrayContaining([
        ['Changed files', '4 files . abc11111 +5/-0, def22222 +4/-1 . +1 more in dashboard preview . +1 more omitted by backend preview'],
      ]),
    }))
  })

  it('uses lightweight fallbacks for sparse list and detail payloads', () => {
    expect(
      buildProjectListItems([
        {
          project_ref: 'project-demo',
          active_ms: 0,
          events: 0,
        },
      ]),
    ).toEqual([
      {
        href: '#/projects/project-demo',
        label: 'project-demo',
        meta: '0 sec active . 0 events',
      },
    ])

    expect(
      buildRecentSessionItems([
        {
          session_id: 'session-2',
          project_ref: 'project-demo',
          active_ms: 0,
        },
      ]),
    ).toEqual([
      {
        href: '#/sessions/project-demo/session-2',
        label: 'project-demo / session-2',
        meta: '0 sec active',
      },
    ])

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
            project_ref: 'project-demo',
            active_ms: 0,
            wait_ms: 0,
          },
        },
      ),
    ).toEqual(expect.objectContaining({
      title: 'Project: project-demo',
      entries: expect.arrayContaining([
        ['Project ref', 'project-demo'],
        ['Events', '0'],
        ['Sessions', '0'],
        ['Changed files', '0 files'],
        ['Languages', '0 languages'],
      ]),
    }))

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
            project_ref: 'project-demo',
            active_ms: 0,
            wait_ms: 0,
          },
        },
      ),
    ).toEqual(expect.objectContaining({
      title: 'Session: project-demo / session-2',
      entries: expect.arrayContaining([
        ['Project', 'project-demo'],
        ['Project ref', 'project-demo'],
        ['Events', '0'],
        ['Primary host-model', 'Not recorded yet'],
        ['Last host', 'unknown'],
        ['Last model', 'unknown'],
        ['Last branch', 'unknown'],
        ['Changed files', '0 files'],
        ['Languages', '0 languages'],
        ['Last event', 'Not recorded yet'],
      ]),
    }))
  })

  it('prefers host_model_primary labels and normalizes Gemini/OpenCode host names', () => {
    expect(
      buildRecentSessionItems([
        {
          session_id: 'session-gemini',
          project_name: 'demo-api',
          project_ref: 'project-demo',
          active_ms: 60_000,
          changed_files_count: 1,
          host: 'legacy-host',
          model_name: 'legacy-model',
          host_model_primary: {
            host: 'gemini-cli',
            model_name: 'gemini-2.5-pro',
          },
          host_model_mix_count: 2,
        },
        {
          session_id: 'session-opencode',
          project_name: 'demo-api',
          project_ref: 'project-demo',
          active_ms: 30_000,
          host: 'opencode',
          model_name: 'gpt-4.1',
        },
      ]),
    ).toEqual([
      {
        href: '#/sessions/project-demo/session-gemini',
        label: 'demo-api / session-gemini',
        meta: '1 min 0 sec active . 1 file . Primary Gemini CLI / gemini-2.5-pro . +1 host-model combo',
      },
      {
        href: '#/sessions/project-demo/session-opencode',
        label: 'demo-api / session-opencode',
        meta: '30 sec active . Last OpenCode / gpt-4.1',
      },
    ])
  })

  it('uses observed wording when host_model_primary is absent and data comes from fallback sources', () => {
    expect(
      buildRecentSessionItems([
        {
          session_id: 'session-observed',
          project_name: 'demo-api',
          project_ref: 'project-demo',
          active_ms: 45_000,
          host_model_mix: [
            { host: 'codex', model_name: 'gpt-5.4', active_ms: 45_000 },
            { host: 'claude-code', model_name: 'claude-sonnet', active_ms: 15_000 },
          ],
        },
      ]),
    ).toEqual([
      {
        href: '#/sessions/project-demo/session-observed',
        label: 'demo-api / session-observed',
        meta: '45 sec active . Observed Codex / gpt-5.4 . +1 host-model combo',
      },
    ])

    expect(
      buildDetailEntries(
        { view: 'session', sessionId: 'session-observed', projectRef: 'project-demo' },
        {
          overview: null,
          projects: { items: [] },
          sessions: { items: [] },
        },
        {
          sessionDetail: {
            session_id: 'session-observed',
            project_name: 'demo-api',
            project_ref: 'project-demo',
            active_ms: 45_000,
            wait_ms: 0,
            event_count: 2,
            host_model_mix: [{ host: 'codex', model_name: 'gpt-5.4', active_ms: 45_000 }],
          },
        },
      ),
    ).toEqual(expect.objectContaining({
      entries: expect.arrayContaining([
        ['Observed host-model', 'Codex / gpt-5.4'],
      ]),
    }))
  })

  it('keeps home-detail totals aligned with the overview summary including total events', () => {
    expect(
      buildDetailEntries(
        { view: 'home' },
        {
          overview: {
            totals: { events: 8, active_ms: 180_000, wait_ms: 45_000 },
            today: { events: 3, active_ms: 60_000, wait_ms: 10_000 },
            this_week: { events: 6, active_ms: 120_000, wait_ms: 20_000 },
          },
          projects: { items: [] },
          sessions: { items: [] },
          status: null,
          loadState: { status: 'fulfilled' },
        },
      ),
    ).toEqual(expect.objectContaining({
      entries: [
        ['Total events', '8'],
        ['Total active', '3 min 0 sec'],
        ['Total wait', '45 sec'],
        ['Today active', '1 min 0 sec'],
        ['This week active', '2 min 0 sec'],
      ],
    }))
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
      if (isRecentSessionsPath(path)) {
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
        if (isRecentSessionsPath(path)) {
          return payloads[RECENT_SESSIONS_PATH]
        }
        if (isProjectSessionsPath(path, 'project-demo')) {
          return payloads[buildProjectSessionsPath('project-demo')]
        }
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

  it('renders zero-delta session explainability copy through the DOM wiring', async () => {
    const nodes = createDashboardNodes()
    const doc = new FakeDocument(nodes)
    const win = new FakeWindow('#/sessions/project-demo/session-quiet')
    const payloads = buildBaseDashboardPayloads({
      '/api/v1/projects/top?limit=5': {
        items: [{ project_name: 'demo-api', project_ref: 'project-demo', events: 1, active_ms: 15_000, wait_ms: 0 }],
      },
      '/api/v1/sessions/recent?limit=10': {
        items: [{
          session_id: 'session-quiet',
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
      '/api/v1/sessions/session-quiet?project_ref=project-demo': {
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
    })
    const fetchImpl = async (path: string) => okJson(payloads[path])

    const app = createDashboardApp({ doc, win, fetchImpl })
    await app.start()

    expect(nodes['detail-title'].textContent).toBe('Session: demo-api / session-quiet')
    expect(nodes['detail-description'].textContent).toBe(
      'Aggregated session activity and file delta summary. Clipulse reports compact, local-first heuristics instead of a full audit log.',
    )
    const changeTrackingRow = nodes['detail-panel'].children.find(
      (row) => row.children[0]?.textContent === 'Change tracking',
    )
    const fileIdentifiersRow = nodes['detail-panel'].children.find(
      (row) => row.children[0]?.textContent === 'File identifiers',
    )

    expect(changeTrackingRow?.children[0]?.textContent).toBe('Change tracking')
    expect(changeTrackingRow?.children[1]?.textContent).toContain(
      'This can be normal for prompt-only activity, read-only commands, or the first Codex snapshot baseline.',
    )
    expect(fileIdentifiersRow?.children[0]?.textContent).toBe('File identifiers')
    expect(fileIdentifiersRow?.children[1]?.textContent).toBe(
      'Fingerprints are privacy-safe file IDs, not raw paths or source excerpts.',
    )
  })

  it('keeps sparse 200-OK session lists out of empty-state rendering', async () => {
    const nodes = createDashboardNodes()
    const doc = new FakeDocument(nodes)
    const win = new FakeWindow('#/')
    const payloads = buildBaseDashboardPayloads({
      '/api/v1/overview': {},
      '/api/v1/breakdown/languages': { items: null },
      '/api/v1/breakdown/models': {},
      '/api/v1/breakdown/hosts': { items: null },
      '/api/v1/projects/top?limit=5': { items: null },
      '/api/v1/sessions/recent?limit=10': {},
      '/api/v1/timeseries': { items: null },
    })
    const fetchImpl = async (path: string) => okJson(payloads[path])

    const app = createDashboardApp({ doc, win, fetchImpl })
    await app.start()

    expect(nodes.overview.children.map((node) => node.textContent)).toEqual([
      'Total events: 0',
      'Total active: 0 sec',
      'Total wait: 0 sec',
      'Today active: 0 sec',
      'This week active: 0 sec',
    ])
    expect(nodes.languages.children[0]?.textContent).toBe('No language data yet.')
    expect(nodes.models.children[0]?.textContent).toBe('No model data yet.')
    expect(nodes.hosts.children[0]?.textContent).toBe('No host data yet.')
    expect(nodes.projects.children[0]?.textContent).toBe('No project data yet.')
    expect(nodes.sessions.children[0]?.textContent).toBe('Unable to load recent sessions yet.')
    expect(nodes.timeseries.children[0]?.textContent).toBe('No daily activity yet.')
    expect(nodes['detail-title'].textContent).toBe('Home overview')
  })

  it('renders zero-delta project explainability copy through the DOM wiring', async () => {
    const nodes = createDashboardNodes()
    const doc = new FakeDocument(nodes)
    const win = new FakeWindow('#/projects/project-quiet')
    const payloads = buildBaseDashboardPayloads({
      '/api/v1/projects/top?limit=5': {
        items: [{ project_name: 'quiet-api', project_ref: 'project-quiet', events: 1, active_ms: 15_000, wait_ms: 0 }],
      },
      '/api/v1/projects/project-quiet': {
        project_name: 'quiet-api',
        project_ref: 'project-quiet',
        active_ms: 15_000,
        wait_ms: 0,
        event_count: 1,
        session_count: 0,
        changed_files_count: 0,
        changed_languages_count: 0,
        lines_added: 0,
        lines_removed: 0,
        lines_changed: 0,
        top_language: null,
        file_preview: [],
        languages: [],
        host_model_mix: [],
      },
      '/api/v1/projects/project-quiet/sessions?limit=10': {
        project_name: 'quiet-api',
        project_ref: 'project-quiet',
        items: [],
      },
    })
    const fetchImpl = async (path: string) => okJson(payloads[path])

    const app = createDashboardApp({ doc, win, fetchImpl })
    await app.start()

    expect(nodes['detail-title'].textContent).toBe('Project: quiet-api')
    expect(nodes['detail-description'].textContent).toBe(
      'Recent session aggregates for this project. Clipulse reports compact, local-first heuristics instead of a full audit log.',
    )
    expect(nodes['detail-panel'].children[8].children[0].textContent).toBe('Change tracking')
    expect(nodes['detail-panel'].children[8].children[1].textContent).toContain(
      'This can be normal for prompt-only activity, read-only commands, or the first Codex snapshot baseline.',
    )
    expect(nodes['detail-panel'].children[9].children[0].textContent).toBe('File identifiers')
    expect(nodes['detail-panel'].children[9].children[1].textContent).toBe(
      'Fingerprints are privacy-safe file IDs, not raw paths or source excerpts.',
    )
  })

  it('keeps recent-session copy aligned with project-session copy for the same logical session', async () => {
    const nodes = createDashboardNodes()
    const doc = new FakeDocument(nodes)
    const win = new FakeWindow('#/')
    const sessionItem = {
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
      host_model_mix: [{ host: 'codex', model_name: 'gpt-5.4', active_ms: 90_000, events: 3 }],
      host_model_mix_count: 1,
      host_model_primary: { host: 'codex', model_name: 'gpt-5.4', active_ms: 90_000 },
    }
    const payloads = buildBaseDashboardPayloads({
      '/api/v1/projects/top?limit=5': {
        items: [{ project_name: 'demo-api', project_ref: 'project-demo', events: 3, active_ms: 90_000, wait_ms: 10_000 }],
      },
      '/api/v1/sessions/recent?limit=10': {
        items: [sessionItem],
      },
      '/api/v1/projects/project-demo': {
        project_name: 'demo-api',
        project_ref: 'project-demo',
        active_ms: 90_000,
        wait_ms: 10_000,
        event_count: 3,
        session_count: 1,
        changed_files_count: 1,
        changed_languages_count: 1,
        lines_added: 5,
        lines_removed: 0,
        lines_changed: 5,
        top_language: { name: 'TypeScript', changed: 5 },
        file_preview: [{ fingerprint: 'abc', language: 'TypeScript', added: 5, removed: 0 }],
        languages: [{ name: 'TypeScript', changed: 5 }],
        host_model_mix: [{ host: 'codex', model_name: 'gpt-5.4', active_ms: 90_000 }],
      },
      '/api/v1/projects/project-demo/sessions?limit=10': {
        project_name: 'demo-api',
        project_ref: 'project-demo',
        items: [sessionItem],
      },
    })
    const fetchImpl = async (path: string) => okJson(payloads[path])

    const app = createDashboardApp({ doc, win, fetchImpl })
    await app.start()

    const homeLabel = nodes.sessions.children[0]?.children[0]?.textContent
    const homeMeta = nodes.sessions.children[0]?.children[1]?.textContent

    win.location.hash = '#/projects/project-demo'
    win.dispatch('hashchange')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(nodes.sessions.children[0]?.children[0]?.textContent).toBe(homeLabel)
    expect(nodes.sessions.children[0]?.children[1]?.textContent).toBe(homeMeta)
  })

  it('keeps copy and navigation chrome consistent across home, project, and session transitions', async () => {
    const nodes = createDashboardNodes()
    const doc = new FakeDocument(nodes)
    const win = new FakeWindow('#/')
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
    const fetchImpl = async (path: string) => okJson(payloads[path])

    const app = createDashboardApp({ doc, win, fetchImpl })
    await app.start()

    expect(nodes['view-title'].textContent).toBe('Home overview')
    expect(nodes['detail-title'].textContent).toBe('Home overview')
    expect(nodes['detail-description'].textContent).toBe(
      'Current Clipulse alpha snapshot across all tracked agent activity.',
    )
    expect(nodes['sessions-title'].textContent).toBe('Recent Sessions')
    expect(nodes['view-nav'].children).toHaveLength(1)

    win.location.hash = '#/projects/project-demo'
    win.dispatch('hashchange')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(nodes['view-title'].textContent).toBe('Project view')
    expect(nodes['view-description'].textContent).toBe(
      'Inspect project-level rollups. Active, wait, and line-change totals are compact local heuristics, not a full audit log.',
    )
    expect(nodes['detail-title'].textContent).toBe('Project: demo-api')
    expect(nodes['detail-description'].textContent).toBe(
      'Recent session aggregates for this project. Clipulse reports compact, local-first heuristics instead of a full audit log.',
    )
    expect(nodes['sessions-title'].textContent).toBe('Project Sessions')
    expect(nodes['view-nav'].children).toHaveLength(2)
    expect(nodes['view-nav'].children[1].href).toBe('#/projects/project-demo')

    win.location.hash = '#/sessions/project-demo/session-2'
    win.dispatch('hashchange')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(nodes['view-title'].textContent).toBe('Session view')
    expect(nodes['view-description'].textContent).toBe(
      'Inspect a single logical session. Active, wait, and line-change totals are compact local heuristics, not a full audit log.',
    )
    expect(nodes['detail-title'].textContent).toBe('Session: demo-api / session-2')
    expect(nodes['detail-description'].textContent).toBe(
      'Aggregated session activity and file delta summary. Clipulse reports compact, local-first heuristics instead of a full audit log.',
    )
    expect(nodes['sessions-title'].textContent).toBe('Recent Sessions')
    expect(nodes.sessions.children[0].className).toContain('linked-item-active')
    expect(nodes['view-nav'].children).toHaveLength(3)
    expect(nodes['view-nav'].children[1].href).toBe('#/projects/project-demo')
    expect(nodes['view-nav'].children[2].href).toBe('#/sessions/project-demo/session-2')

    win.location.hash = '#/'
    win.dispatch('hashchange')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(nodes['view-title'].textContent).toBe('Home overview')
    expect(nodes['detail-title'].textContent).toBe('Home overview')
    expect(nodes['detail-description'].textContent).toBe(
      'Current Clipulse alpha snapshot across all tracked agent activity.',
    )
    expect(nodes['sessions-title'].textContent).toBe('Recent Sessions')
    expect(nodes['view-nav'].children).toHaveLength(1)
  })

  it('keeps error-copy structure consistent when navigating across project and session failure routes', async () => {
    const nodes = createDashboardNodes()
    const doc = new FakeDocument(nodes)
    const win = new FakeWindow('#/projects/project-missing')
    const payloads = buildBaseDashboardPayloads({
      '/api/v1/projects/top?limit=5': {
        items: [{ project_name: 'demo-api', project_ref: 'project-demo', events: 1, active_ms: 15_000 }],
      },
      '/api/v1/sessions/recent?limit=10': {
        items: [{ session_id: 'session-2', project_name: 'demo-api', project_ref: 'project-demo', host: 'codex', model_name: 'gpt-5.4', events: 1, active_ms: 15_000, wait_ms: 0, last_event_time: '2026-04-05T08:00:00Z', changed_files_count: 0, lines_changed: 0, top_language: null, host_model_mix: [] }],
      },
    })
    const fetchImpl = async (path: string) => {
      if (path === '/api/v1/projects/project-missing') {
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
      if (path === '/api/v1/sessions/session-ambiguous') {
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

    expect(nodes['detail-title'].textContent).toBe('Project not found')
    expect(nodes['detail-panel'].children).toHaveLength(2)

    win.location.hash = '#/sessions/session-ambiguous'
    win.dispatch('hashchange')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(nodes['detail-title'].textContent).toBe('Session detail needs project scope')
    expect(nodes['detail-panel'].children).toHaveLength(2)

    win.location.hash = '#/sessions/project-demo/session-missing'
    win.dispatch('hashchange')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(nodes['detail-title'].textContent).toBe('Session not found')
    expect(nodes['detail-panel'].children).toHaveLength(2)
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
      if (isProjectSessionsPath(path, 'project-b')) {
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
      if (isProjectSessionsPath(path, 'project-a')) {
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

  it('ignores stale errors from an older visit to the same project route', async () => {
    const nodes = createDashboardNodes()
    const doc = new FakeDocument(nodes)
    const win = new FakeWindow('#/projects/project-a')
    const oldProjectDetail = createDeferred<unknown>()
    const oldProjectSessions = createDeferred<unknown>()
    let projectDetailCalls = 0
    let projectSessionCalls = 0
    const payloads = buildBaseDashboardPayloads({
      '/api/v1/projects/top?limit=5': {
        items: [{ project_name: 'demo-a', project_ref: 'project-a', events: 3, active_ms: 90_000, wait_ms: 5_000 }],
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
      if (isProjectSessionsPath(path, 'project-a')) {
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

    win.location.hash = '#/'
    win.dispatch('hashchange')
    win.location.hash = '#/projects/project-a'
    win.dispatch('hashchange')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(nodes['detail-title'].textContent).toBe('Project: demo-a-fresh')
    expect(nodes.sessions.children[0]?.children[0].textContent).toBe('demo-a-fresh / session-fresh')

    oldProjectDetail.resolve({
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
    })
    oldProjectSessions.resolve({
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
    })
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

  it('ignores stale successes from an older visit to the same session route after a newer error', async () => {
    const nodes = createDashboardNodes()
    const doc = new FakeDocument(nodes)
    const win = new FakeWindow('#/sessions/project-demo/session-2')
    const oldSessionDetail = createDeferred<unknown>()
    let sessionDetailCalls = 0
    const payloads = buildBaseDashboardPayloads({
      '/api/v1/projects/top?limit=5': {
        items: [{ project_name: 'demo-api', project_ref: 'project-demo', events: 4, active_ms: 120_000 }],
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
    void app.start()
    await new Promise((resolve) => setTimeout(resolve, 0))

    win.location.hash = '#/'
    win.dispatch('hashchange')
    win.location.hash = '#/sessions/project-demo/session-2'
    win.dispatch('hashchange')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(nodes['detail-title'].textContent).toBe('Session not found')

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

    expect(nodes['detail-title'].textContent).toBe('Session not found')
    expect(nodes['detail-panel'].children[0].children[1].textContent).toContain('project scope')
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
      if (isProjectSessionsPath(path, 'project-demo')) {
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
    expect(nodes.sessions.children[0]?.textContent).toContain('Project sessions unavailable. project sessions feed is temporarily unavailable')
    expect(nodes.sessions.children[0]?.textContent).toContain('Retry the dedicated')
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
      if (isProjectSessionsPath(path, 'project-demo')) {
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

  it('does not render empty project-session copy before project detail settles', async () => {
    const nodes = createDashboardNodes()
    const doc = new FakeDocument(nodes)
    const win = new FakeWindow('#/projects/project-demo')
    const projectDetail = createDeferred<ReturnType<typeof okJson>>()
    const payloads = buildBaseDashboardPayloads({
      '/api/v1/projects/project-demo/sessions?limit=10': {
        project_name: 'demo-api',
        project_ref: 'project-demo',
        items: [],
      },
    })
    const fetchImpl = async (path: string) => {
      if (path === '/api/v1/projects/project-demo') {
        return projectDetail.promise
      }

      return okJson(payloads[path])
    }

    const app = createDashboardApp({ doc, win, fetchImpl })
    void app.start()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(nodes['sessions-title'].textContent).toBe('Project Sessions')
    expect(nodes.sessions.children[0]?.textContent).toBe('Loading project sessions...')
    expect(nodes.sessions.children[0]?.textContent).not.toBe('No sessions recorded for this project yet.')

    projectDetail.resolve(okJson({
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
      top_language: null,
      host_model_mix: [],
    }))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(nodes.sessions.children[0]?.textContent).toBe('No sessions recorded for this project yet.')
  })

  it('keeps fulfilled project-session items visible while project detail is still loading', async () => {
    const nodes = createDashboardNodes()
    const doc = new FakeDocument(nodes)
    const win = new FakeWindow('#/projects/project-demo')
    const projectDetail = createDeferred<ReturnType<typeof okJson>>()
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
        return projectDetail.promise
      }

      return okJson(payloads[path])
    }

    const app = createDashboardApp({ doc, win, fetchImpl })
    void app.start()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(nodes['sessions-title'].textContent).toBe('Project Sessions')
    expect(nodes.sessions.children).toHaveLength(1)
    expect(nodes.sessions.children[0]?.href).toBe('#/sessions/project-demo/session-2')
    expect(nodes.sessions.children[0]?.children[0]?.textContent).toBe('demo-api / session-2')
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
      if (isRecentSessionsPath(path)) {
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
      if (isProjectSessionsPath(path, 'project-demo')) {
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

  it('starts deep-link detail requests before the summary bootstrap settles', async () => {
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
      if (isRecentSessionsPath(path)) {
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
      if (isProjectSessionsPath(path, 'project-demo')) {
        projectSessionCalls += 1
        return new Promise(() => {})
      }

      return new Promise(() => {})
    }

    const app = createDashboardApp({ doc, win, fetchImpl })
    void app.start()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(projectDetailCalls).toBe(1)
    expect(projectSessionCalls).toBe(1)
    expect(nodes['detail-title'].textContent).toBe('Project detail loading')
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
        || isProjectSessionsPath(requestPath, 'project-demo')
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

  it('does not let a stale unscoped session deep-link response rewrite the hash after navigating away', async () => {
    const nodes = createDashboardNodes()
    const doc = new FakeDocument(nodes)
    const win = new FakeWindow('#/sessions/session-2')
    const unscopedSessionDetail = createDeferred<ReturnType<typeof okJson>>()
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
      if (path === '/api/v1/sessions/session-2') {
        return unscopedSessionDetail.promise
      }

      return okJson(payloads[path])
    }

    const app = createDashboardApp({ doc, win, fetchImpl })
    void app.start()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(nodes['detail-title'].textContent).toBe('Session detail loading')
    expect(win.location.hash).toBe('#/sessions/session-2')

    win.location.hash = '#/projects/project-demo'
    win.dispatch('hashchange')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(nodes['detail-title'].textContent).toBe('Project: demo-api')
    expect(win.location.hash).toBe('#/projects/project-demo')

    unscopedSessionDetail.resolve(okJson({
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
    }))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(nodes['detail-title'].textContent).toBe('Project: demo-api')
    expect(win.location.hash).toBe('#/projects/project-demo')
    expect(nodes['view-nav'].children).toHaveLength(2)
    expect(nodes['view-nav'].children[1].href).toBe('#/projects/project-demo')
  })

  it('normalizes unscoped session deep links after detail lookup succeeds', async () => {
    const nodes = createDashboardNodes()
    const doc = new FakeDocument(nodes)
    const win = new FakeWindow('#/sessions/session-2')
    const payloads = buildBaseDashboardPayloads({
      '/api/v1/sessions/session-2': {
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
    const fetchImpl = async (path: string) => okJson(payloads[path])

    const app = createDashboardApp({ doc, win, fetchImpl })
    await app.start()

    expect(nodes['detail-title'].textContent).toBe('Session: demo-api / session-2')
    expect(win.location.hash).toBe('#/sessions/project-demo/session-2')
    expect(nodes['view-nav'].children[1]?.href).toBe('#/projects/project-demo')
    expect(nodes['view-nav'].children[2]?.href).toBe('#/sessions/project-demo/session-2')
  })

  it('does not refetch session detail after unscoped deep links normalize to a scoped hash', async () => {
    const nodes = createDashboardNodes()
    const doc = new FakeDocument(nodes)
    const win = new FakeWindow('#/sessions/session-2')
    let unscopedDetailCalls = 0
    let scopedDetailCalls = 0
    const payloads = buildBaseDashboardPayloads({
      '/api/v1/sessions/session-2': {
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
      if (path === '/api/v1/sessions/session-2') {
        unscopedDetailCalls += 1
      }
      if (path === '/api/v1/sessions/session-2?project_ref=project-demo') {
        scopedDetailCalls += 1
      }
      return okJson(payloads[path])
    }

    const app = createDashboardApp({ doc, win, fetchImpl })
    await app.start()

    expect(unscopedDetailCalls).toBe(1)
    expect(scopedDetailCalls).toBe(0)
    expect(win.location.hash).toBe('#/sessions/project-demo/session-2')

    win.dispatch('hashchange')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(unscopedDetailCalls).toBe(1)
    expect(scopedDetailCalls).toBe(0)
    expect(nodes['detail-title'].textContent).toBe('Session: demo-api / session-2')
  })

  it('starts idempotently without duplicate bootstrap requests or hashchange listeners', async () => {
    const nodes = createDashboardNodes()
    const doc = new FakeDocument(nodes)
    const win = new FakeWindow('#/')
    const callCounts = new Map<string, number>()
    const payloads = buildBaseDashboardPayloads()
    const fetchImpl = async (path: string) => {
      callCounts.set(path, (callCounts.get(path) ?? 0) + 1)
      return okJson(payloads[path])
    }

    const app = createDashboardApp({ doc, win, fetchImpl })
    await app.start()
    await app.start()

    expect((win.listeners.hashchange ?? [])).toHaveLength(1)
    expect(callCounts.get('/api/v1/overview')).toBe(1)
    expect(callCounts.get('/api/v1/projects/top?limit=5')).toBe(1)
    expect(callCounts.get(COMPACT_RECENT_SESSIONS_PATH)).toBe(1)
  })

  it('requests compact recent sessions and renders list items without host_model_mix arrays', async () => {
    const nodes = createDashboardNodes()
    const doc = new FakeDocument(nodes)
    const win = new FakeWindow('#/')
    const payloads = buildBaseDashboardPayloads({
      [COMPACT_RECENT_SESSIONS_PATH]: {
        items: [{
          session_id: 'session-compact',
          project_name: 'demo-api',
          project_ref: 'project-demo',
          host: 'claude-code',
          last_host: 'claude-code',
          model_name: 'claude-sonnet',
          last_model_name: 'claude-sonnet',
          git_branch: 'feat/v1-alpha',
          last_git_branch: 'feat/v1-alpha',
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
          host_model_mix_count: 2,
          host_model_primary: {
            host: 'codex',
            model_name: 'gpt-5.4',
            active_ms: 90_000,
          },
        }],
      },
    })
    const callCounts = new Map<string, number>()
    const fetchImpl = async (path: string) => {
      callCounts.set(path, (callCounts.get(path) ?? 0) + 1)
      return okJson(payloads[path])
    }

    const app = createDashboardApp({ doc, win, fetchImpl })
    await app.start()

    expect(callCounts.get(COMPACT_RECENT_SESSIONS_PATH)).toBe(1)
    expect(nodes.sessions.children[0]?.children[0]?.textContent).toBe('demo-api / session-compact')
    expect(nodes.sessions.children[0]?.children[1]?.textContent).toContain('Primary Codex / gpt-5.4')
  })

  it('falls back to the full recent sessions path when the compact route is unavailable', async () => {
    const nodes = createDashboardNodes()
    const doc = new FakeDocument(nodes)
    const win = new FakeWindow('#/')
    const payloads = buildBaseDashboardPayloads({
      [RECENT_SESSIONS_PATH]: {
        items: [{
          session_id: 'session-fallback',
          project_name: 'demo-api',
          project_ref: 'project-demo',
          host: 'claude-code',
          last_host: 'claude-code',
          model_name: 'claude-sonnet',
          last_model_name: 'claude-sonnet',
          git_branch: 'feat/v1-alpha',
          last_git_branch: 'feat/v1-alpha',
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
    const callCounts = new Map<string, number>()
    const fetchImpl = async (path: string) => {
      callCounts.set(path, (callCounts.get(path) ?? 0) + 1)
      if (path === COMPACT_RECENT_SESSIONS_PATH) {
        return {
          ok: false,
          status: 404,
          async json() {
            return { detail: { code: 'not_found', message: 'missing compact route', hint: 'retry full' } }
          },
        }
      }
      return okJson(payloads[path])
    }

    const app = createDashboardApp({ doc, win, fetchImpl })
    await app.start()

    expect(callCounts.get(COMPACT_RECENT_SESSIONS_PATH)).toBe(1)
    expect(callCounts.get(RECENT_SESSIONS_PATH)).toBe(1)
    expect(nodes.sessions.children[0]?.children[0]?.textContent).toBe('demo-api / session-fallback')
  })

  it('falls back to the full recent sessions path when the compact route returns invalid JSON', async () => {
    const nodes = createDashboardNodes()
    const doc = new FakeDocument(nodes)
    const win = new FakeWindow('#/')
    const payloads = buildBaseDashboardPayloads({
      [RECENT_SESSIONS_PATH]: {
        items: [{
          session_id: 'session-json-fallback',
          project_name: 'demo-api',
          project_ref: 'project-demo',
          host: 'codex',
          last_host: 'codex',
          model_name: 'gpt-5.4',
          last_model_name: 'gpt-5.4',
          git_branch: 'feat/v1-alpha',
          last_git_branch: 'feat/v1-alpha',
          first_event_time: '2026-04-05T08:00:00Z',
          last_event_time: '2026-04-05T08:10:00Z',
          event_count: 2,
          events: 2,
          active_ms: 30_000,
          wait_ms: 5_000,
          changed_files_count: 1,
          changed_languages_count: 1,
          lines_added: 4,
          lines_removed: 1,
          lines_changed: 5,
          top_language: { name: 'TypeScript', changed: 5 },
          host_model_mix: [{ host: 'codex', model_name: 'gpt-5.4', active_ms: 30_000 }],
          host_model_mix_count: 1,
          host_model_primary: { host: 'codex', model_name: 'gpt-5.4', active_ms: 30_000 },
        }],
      },
    })
    const callCounts = new Map<string, number>()
    const fetchImpl = async (path: string) => {
      callCounts.set(path, (callCounts.get(path) ?? 0) + 1)
      if (path === COMPACT_RECENT_SESSIONS_PATH) {
        return {
          ok: true,
          status: 200,
          async json() {
            throw new Error('bad json')
          },
        }
      }
      return okJson(payloads[path])
    }

    const app = createDashboardApp({ doc, win, fetchImpl })
    await app.start()

    expect(callCounts.get(COMPACT_RECENT_SESSIONS_PATH)).toBe(1)
    expect(callCounts.get(RECENT_SESSIONS_PATH)).toBe(1)
    expect(nodes.sessions.children[0]?.children[0]?.textContent).toBe('demo-api / session-json-fallback')
  })

  it('falls back to the full recent sessions path when compact items are skeletal', async () => {
    const nodes = createDashboardNodes()
    const doc = new FakeDocument(nodes)
    const win = new FakeWindow('#/')
    const payloads = buildBaseDashboardPayloads({
      [RECENT_SESSIONS_PATH]: {
        items: [{
          session_id: 'session-shape-fallback',
          project_name: 'demo-api',
          project_ref: 'project-demo',
          host: 'codex',
          last_host: 'codex',
          model_name: 'gpt-5.4',
          last_model_name: 'gpt-5.4',
          git_branch: 'feat/v1-alpha',
          last_git_branch: 'feat/v1-alpha',
          first_event_time: '2026-04-05T08:00:00Z',
          last_event_time: '2026-04-05T08:10:00Z',
          event_count: 2,
          events: 2,
          active_ms: 30_000,
          wait_ms: 5_000,
          changed_files_count: 1,
          changed_languages_count: 1,
          lines_added: 4,
          lines_removed: 1,
          lines_changed: 5,
          top_language: { name: 'TypeScript', changed: 5 },
          host_model_mix: [{ host: 'codex', model_name: 'gpt-5.4', active_ms: 30_000 }],
          host_model_mix_count: 1,
          host_model_primary: { host: 'codex', model_name: 'gpt-5.4', active_ms: 30_000 },
        }],
      },
    })
    const callCounts = new Map<string, number>()
    const fetchImpl = async (path: string) => {
      callCounts.set(path, (callCounts.get(path) ?? 0) + 1)
      if (path === COMPACT_RECENT_SESSIONS_PATH) {
        return okJson({
          items: [{
            session_id: 'session-shape-fallback',
            project_ref: 'project-demo',
            project_name: 'demo-api',
          }],
        })
      }
      return okJson(payloads[path])
    }

    const app = createDashboardApp({ doc, win, fetchImpl })
    await app.start()

    expect(callCounts.get(COMPACT_RECENT_SESSIONS_PATH)).toBe(1)
    expect(callCounts.get(RECENT_SESSIONS_PATH)).toBe(1)
    expect(nodes.sessions.children[0]?.children[0]?.textContent).toBe('demo-api / session-shape-fallback')
  })

  it('does not fall back to the full recent sessions path when the compact route returns 503', async () => {
    const nodes = createDashboardNodes()
    const doc = new FakeDocument(nodes)
    const win = new FakeWindow('#/')
    const payloads = buildBaseDashboardPayloads({
      [RECENT_SESSIONS_PATH]: {
        items: [{
          session_id: 'session-should-not-load',
          project_name: 'demo-api',
          project_ref: 'project-demo',
          active_ms: 30_000,
        }],
      },
    })
    const callCounts = new Map<string, number>()
    const fetchImpl = async (path: string) => {
      callCounts.set(path, (callCounts.get(path) ?? 0) + 1)
      if (path === COMPACT_RECENT_SESSIONS_PATH) {
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

    expect(callCounts.get(COMPACT_RECENT_SESSIONS_PATH)).toBe(1)
    expect(callCounts.get(RECENT_SESSIONS_PATH) ?? 0).toBe(0)
    expect(nodes.sessions.children[0]?.textContent).toBe('Unable to load recent sessions yet.')
  })

  it('does not treat partial recent session items as a successful list payload', async () => {
    const nodes = createDashboardNodes()
    const doc = new FakeDocument(nodes)
    const win = new FakeWindow('#/')
    const callCounts = new Map<string, number>()
    const defaults = buildBaseDashboardPayloads()
    const fetchImpl = async (path: string) => {
      callCounts.set(path, (callCounts.get(path) ?? 0) + 1)
      if (path === COMPACT_RECENT_SESSIONS_PATH) {
        return {
          ok: false,
          status: 404,
          async json() {
            return { detail: { code: 'not_found', message: 'missing compact route', hint: 'retry full' } }
          },
        }
      }

      if (path === RECENT_SESSIONS_PATH) {
        return okJson({
          items: [{
            session_id: 'session-partial',
            project_ref: 'project-demo',
            active_ms: 30_000,
            lines_changed: 5,
          }],
        })
      }

      return okJson(defaults[path])
    }

    const app = createDashboardApp({ doc, win, fetchImpl })
    await app.start()

    expect(callCounts.get(COMPACT_RECENT_SESSIONS_PATH)).toBe(1)
    expect(callCounts.get(RECENT_SESSIONS_PATH)).toBe(1)
    expect(nodes.sessions.children[0]?.textContent).toBe('Unable to load recent sessions yet.')
  })

  it('requests compact project sessions for project routes', async () => {
    const nodes = createDashboardNodes()
    const doc = new FakeDocument(nodes)
    const win = new FakeWindow('#/projects/project-demo')
    const payloads = buildBaseDashboardPayloads({
      '/api/v1/projects/project-demo': {
        project_name: 'demo-api',
        project_ref: 'project-demo',
        active_ms: 90_000,
        wait_ms: 10_000,
        event_count: 3,
        session_count: 1,
        changed_files_count: 1,
        changed_languages_count: 1,
        lines_added: 5,
        lines_removed: 0,
        lines_changed: 5,
        top_language: { name: 'TypeScript', changed: 5 },
        file_preview: [{ fingerprint: 'abc', language: 'TypeScript', added: 5, removed: 0 }],
        languages: [{ name: 'TypeScript', changed: 5 }],
        host_model_mix: [{ host: 'codex', model_name: 'gpt-5.4', active_ms: 90_000 }],
      },
      [buildCompactProjectSessionsPath('project-demo')]: {
        project_name: 'demo-api',
        project_ref: 'project-demo',
        items: [{
          session_id: 'session-compact',
          project_name: 'demo-api',
          project_ref: 'project-demo',
          host: 'claude-code',
          last_host: 'claude-code',
          model_name: 'claude-sonnet',
          last_model_name: 'claude-sonnet',
          git_branch: 'feat/v1-alpha',
          last_git_branch: 'feat/v1-alpha',
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
          host_model_mix_count: 1,
          host_model_primary: { host: 'codex', model_name: 'gpt-5.4', active_ms: 90_000 },
        }],
      },
    })
    const callCounts = new Map<string, number>()
    const fetchImpl = async (path: string) => {
      callCounts.set(path, (callCounts.get(path) ?? 0) + 1)
      return okJson(payloads[path])
    }

    const app = createDashboardApp({ doc, win, fetchImpl })
    await app.start()

    expect(callCounts.get(buildCompactProjectSessionsPath('project-demo'))).toBeGreaterThanOrEqual(1)
    expect(callCounts.get(buildProjectSessionsPath('project-demo'))).toBeUndefined()
    expect(nodes.sessions.children[0]?.children[0]?.textContent).toBe('demo-api / session-compact')
  })

  it('falls back to the full project sessions path when the compact payload shape is invalid', async () => {
    const nodes = createDashboardNodes()
    const doc = new FakeDocument(nodes)
    const win = new FakeWindow('#/projects/project-demo')
    const payloads = buildBaseDashboardPayloads({
      '/api/v1/projects/project-demo': {
        project_name: 'demo-api',
        project_ref: 'project-demo',
        active_ms: 90_000,
        wait_ms: 10_000,
        event_count: 3,
        session_count: 1,
        changed_files_count: 1,
        changed_languages_count: 1,
        lines_added: 5,
        lines_removed: 0,
        lines_changed: 5,
        top_language: { name: 'TypeScript', changed: 5 },
        file_preview: [{ fingerprint: 'abc', language: 'TypeScript', added: 5, removed: 0 }],
        languages: [{ name: 'TypeScript', changed: 5 }],
        host_model_mix: [{ host: 'codex', model_name: 'gpt-5.4', active_ms: 90_000 }],
      },
      [buildProjectSessionsPath('project-demo')]: {
        project_name: 'demo-api',
        project_ref: 'project-demo',
        items: [{
          session_id: 'session-fallback',
          project_name: 'demo-api',
          project_ref: 'project-demo',
          host: 'claude-code',
          last_host: 'claude-code',
          model_name: 'claude-sonnet',
          last_model_name: 'claude-sonnet',
          git_branch: 'feat/v1-alpha',
          last_git_branch: 'feat/v1-alpha',
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
    const callCounts = new Map<string, number>()
    const fetchImpl = async (path: string) => {
      callCounts.set(path, (callCounts.get(path) ?? 0) + 1)
      if (path === buildCompactProjectSessionsPath('project-demo')) {
        return okJson({ project_name: 'demo-api', project_ref: 'project-demo' })
      }
      return okJson(payloads[path])
    }

    const app = createDashboardApp({ doc, win, fetchImpl })
    await app.start()

    expect(callCounts.get(buildCompactProjectSessionsPath('project-demo'))).toBeGreaterThanOrEqual(1)
    expect(callCounts.get(buildProjectSessionsPath('project-demo'))).toBeGreaterThanOrEqual(1)
    expect(nodes.sessions.children[0]?.children[0]?.textContent).toBe('demo-api / session-fallback')
  })

  it('falls back to the full project sessions path when the compact route returns invalid JSON', async () => {
    const nodes = createDashboardNodes()
    const doc = new FakeDocument(nodes)
    const win = new FakeWindow('#/projects/project-demo')
    const payloads = buildBaseDashboardPayloads({
      '/api/v1/projects/project-demo': {
        project_name: 'demo-api',
        project_ref: 'project-demo',
        active_ms: 90_000,
        wait_ms: 10_000,
        event_count: 3,
        session_count: 1,
        changed_files_count: 1,
        changed_languages_count: 1,
        lines_added: 5,
        lines_removed: 0,
        lines_changed: 5,
        top_language: { name: 'TypeScript', changed: 5 },
        file_preview: [{ fingerprint: 'abc', language: 'TypeScript', added: 5, removed: 0 }],
        languages: [{ name: 'TypeScript', changed: 5 }],
        host_model_mix: [{ host: 'codex', model_name: 'gpt-5.4', active_ms: 90_000 }],
      },
      [buildProjectSessionsPath('project-demo')]: {
        project_name: 'demo-api',
        project_ref: 'project-demo',
        items: [{
          session_id: 'session-json-fallback',
          project_name: 'demo-api',
          project_ref: 'project-demo',
          host: 'codex',
          last_host: 'codex',
          model_name: 'gpt-5.4',
          last_model_name: 'gpt-5.4',
          git_branch: 'feat/v1-alpha',
          last_git_branch: 'feat/v1-alpha',
          first_event_time: '2026-04-05T08:00:00Z',
          last_event_time: '2026-04-05T08:10:00Z',
          event_count: 2,
          events: 2,
          active_ms: 30_000,
          wait_ms: 5_000,
          changed_files_count: 1,
          changed_languages_count: 1,
          lines_added: 4,
          lines_removed: 1,
          lines_changed: 5,
          top_language: { name: 'TypeScript', changed: 5 },
          host_model_mix: [{ host: 'codex', model_name: 'gpt-5.4', active_ms: 30_000 }],
          host_model_mix_count: 1,
          host_model_primary: { host: 'codex', model_name: 'gpt-5.4', active_ms: 30_000 },
        }],
      },
    })
    const callCounts = new Map<string, number>()
    const fetchImpl = async (path: string) => {
      callCounts.set(path, (callCounts.get(path) ?? 0) + 1)
      if (path === buildCompactProjectSessionsPath('project-demo')) {
        return {
          ok: true,
          status: 200,
          async json() {
            throw new Error('bad json')
          },
        }
      }
      return okJson(payloads[path])
    }

    const app = createDashboardApp({ doc, win, fetchImpl })
    await app.start()

    expect(callCounts.get(buildCompactProjectSessionsPath('project-demo'))).toBeGreaterThanOrEqual(1)
    expect(callCounts.get(buildProjectSessionsPath('project-demo'))).toBeGreaterThanOrEqual(1)
    expect(nodes.sessions.children[0]?.children[0]?.textContent).toBe('demo-api / session-json-fallback')
  })

  it('falls back to the full project sessions path when compact items miss required session keys', async () => {
    const nodes = createDashboardNodes()
    const doc = new FakeDocument(nodes)
    const win = new FakeWindow('#/projects/project-demo')
    const payloads = buildBaseDashboardPayloads({
      '/api/v1/projects/project-demo': {
        project_name: 'demo-api',
        project_ref: 'project-demo',
        active_ms: 90_000,
        wait_ms: 10_000,
        event_count: 3,
        session_count: 1,
        changed_files_count: 1,
        changed_languages_count: 1,
        lines_added: 5,
        lines_removed: 0,
        lines_changed: 5,
        top_language: { name: 'TypeScript', changed: 5 },
        file_preview: [{ fingerprint: 'abc', language: 'TypeScript', added: 5, removed: 0 }],
        languages: [{ name: 'TypeScript', changed: 5 }],
        host_model_mix: [{ host: 'codex', model_name: 'gpt-5.4', active_ms: 90_000 }],
      },
      [buildProjectSessionsPath('project-demo')]: {
        project_name: 'demo-api',
        project_ref: 'project-demo',
        items: [{
          session_id: 'session-shape-fallback',
          project_name: 'demo-api',
          project_ref: 'project-demo',
          host: 'codex',
          last_host: 'codex',
          model_name: 'gpt-5.4',
          last_model_name: 'gpt-5.4',
          git_branch: 'feat/v1-alpha',
          last_git_branch: 'feat/v1-alpha',
          first_event_time: '2026-04-05T08:00:00Z',
          last_event_time: '2026-04-05T08:10:00Z',
          event_count: 2,
          events: 2,
          active_ms: 30_000,
          wait_ms: 5_000,
          changed_files_count: 1,
          changed_languages_count: 1,
          lines_added: 4,
          lines_removed: 1,
          lines_changed: 5,
          top_language: { name: 'TypeScript', changed: 5 },
          host_model_mix: [{ host: 'codex', model_name: 'gpt-5.4', active_ms: 30_000 }],
          host_model_mix_count: 1,
          host_model_primary: { host: 'codex', model_name: 'gpt-5.4', active_ms: 30_000 },
        }],
      },
    })
    const callCounts = new Map<string, number>()
    const fetchImpl = async (path: string) => {
      callCounts.set(path, (callCounts.get(path) ?? 0) + 1)
      if (path === buildCompactProjectSessionsPath('project-demo')) {
        return okJson({
          project_name: 'demo-api',
          project_ref: 'project-demo',
          items: [{
            session_id: 'session-shape-fallback',
            project_ref: 'project-demo',
            project_name: 'demo-api',
          }],
        })
      }
      return okJson(payloads[path])
    }

    const app = createDashboardApp({ doc, win, fetchImpl })
    await app.start()

    expect(callCounts.get(buildCompactProjectSessionsPath('project-demo'))).toBeGreaterThanOrEqual(1)
    expect(callCounts.get(buildProjectSessionsPath('project-demo'))).toBeGreaterThanOrEqual(1)
    expect(nodes.sessions.children[0]?.children[0]?.textContent).toBe('demo-api / session-shape-fallback')
  })

  it('falls back to the full project sessions path when compact project sessions use the wrong project_ref', async () => {
    const nodes = createDashboardNodes()
    const doc = new FakeDocument(nodes)
    const win = new FakeWindow('#/projects/project-demo')
    const payloads = buildBaseDashboardPayloads({
      '/api/v1/projects/project-demo': {
        project_name: 'demo-api',
        project_ref: 'project-demo',
        active_ms: 90_000,
        wait_ms: 10_000,
        event_count: 3,
        session_count: 1,
        changed_files_count: 1,
        changed_languages_count: 1,
        lines_added: 5,
        lines_removed: 0,
        lines_changed: 5,
        top_language: { name: 'TypeScript', changed: 5 },
        file_preview: [{ fingerprint: 'abc', language: 'TypeScript', added: 5, removed: 0 }],
        languages: [{ name: 'TypeScript', changed: 5 }],
        host_model_mix: [{ host: 'codex', model_name: 'gpt-5.4', active_ms: 90_000 }],
      },
      [buildProjectSessionsPath('project-demo')]: {
        project_name: 'demo-api',
        project_ref: 'project-demo',
        items: [{
          session_id: 'session-project-ref-fallback',
          project_name: 'demo-api',
          project_ref: 'project-demo',
          host: 'codex',
          active_ms: 30_000,
          events: 2,
        }],
      },
    })
    const callCounts = new Map<string, number>()
    const fetchImpl = async (path: string) => {
      callCounts.set(path, (callCounts.get(path) ?? 0) + 1)
      if (path === buildCompactProjectSessionsPath('project-demo')) {
        return okJson({
          project_name: 'demo-api',
          project_ref: 'project-other',
          items: [{
            session_id: 'session-project-ref-fallback',
            project_name: 'demo-api',
            project_ref: 'project-other',
            active_ms: 30_000,
            events: 2,
          }],
        })
      }
      return okJson(payloads[path])
    }

    const app = createDashboardApp({ doc, win, fetchImpl })
    await app.start()

    expect(callCounts.get(buildCompactProjectSessionsPath('project-demo'))).toBeGreaterThanOrEqual(1)
    expect(callCounts.get(buildProjectSessionsPath('project-demo'))).toBeGreaterThanOrEqual(1)
    expect(nodes.sessions.children[0]?.children[0]?.textContent).toBe('demo-api / session-project-ref-fallback')
  })

  it('shows an error state when the final full project sessions payload uses the wrong project_ref', async () => {
    const nodes = createDashboardNodes()
    const doc = new FakeDocument(nodes)
    const win = new FakeWindow('#/projects/project-demo')
    const payloads = buildBaseDashboardPayloads({
      '/api/v1/projects/project-demo': {
        project_name: 'demo-api',
        project_ref: 'project-demo',
        active_ms: 90_000,
        wait_ms: 10_000,
        event_count: 3,
        session_count: 1,
        changed_files_count: 1,
        changed_languages_count: 1,
        lines_added: 5,
        lines_removed: 0,
        lines_changed: 5,
        top_language: { name: 'TypeScript', changed: 5 },
        file_preview: [{ fingerprint: 'abc', language: 'TypeScript', added: 5, removed: 0 }],
        languages: [{ name: 'TypeScript', changed: 5 }],
        host_model_mix: [{ host: 'codex', model_name: 'gpt-5.4', active_ms: 90_000 }],
      },
    })
    const callCounts = new Map<string, number>()
    const fetchImpl = async (path: string) => {
      callCounts.set(path, (callCounts.get(path) ?? 0) + 1)
      if (isProjectSessionsPath(path, 'project-demo')) {
        return okJson({
          project_name: 'demo-api',
          project_ref: 'project-other',
          items: [{
            session_id: 'session-project-ref-error',
            project_name: 'demo-api',
            project_ref: 'project-other',
            active_ms: 30_000,
            events: 2,
          }],
        })
      }
      return okJson(payloads[path])
    }

    const app = createDashboardApp({ doc, win, fetchImpl })
    await app.start()

    expect(callCounts.get(buildCompactProjectSessionsPath('project-demo'))).toBeGreaterThanOrEqual(1)
    expect(callCounts.get(buildProjectSessionsPath('project-demo'))).toBeGreaterThanOrEqual(1)
    expect(nodes['detail-title'].textContent).toBe('Project: demo-api')
    expect(nodes.sessions.children[0]?.textContent).toContain('Project sessions unavailable.')
    expect(nodes.sessions.children[0]?.textContent).toContain('current route project_ref')
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
    expect(nodes['detail-panel'].children[0].children[0].textContent).toBe('Total events')
    expect(nodes['detail-panel'].children[0].children[1].textContent).toBe('8')
    expect(nodes['detail-panel'].children[5].children[0].textContent).toBe('System')
    expect(nodes['detail-panel'].children[5].children[1].textContent).toContain('API ok')
    expect(nodes['detail-panel'].children[6].children[0].textContent).toBe('Queue backlog')
    expect(nodes['detail-panel'].children[6].children[1].textContent).toContain('3 jobs pending')
    expect(nodes['detail-panel'].children[6].children[1].textContent).toContain('oldest backlog 1 hr 0 min')
    expect(nodes['detail-panel'].children[6].children[1].textContent).toContain('oldest quarantine 2 hr 0 min')
    expect(nodes['detail-panel'].children[7].children[0].textContent).toBe('Queue storage')
    expect(nodes['detail-panel'].children[7].children[1].textContent).toContain('3.5 KiB payload spool')
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
    expect(nodes['detail-panel'].children[5].children[0].textContent).toBe('System')
    expect(nodes['detail-panel'].children[5].children[1].textContent).toContain('/api/v1/status')
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

  it('treats 200 detail responses with invalid JSON as invalid payloads instead of network failures', async () => {
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
        return {
          ok: true,
          status: 200,
          async json() {
            throw new SyntaxError('Unexpected end of JSON input')
          },
        }
      }

      return okJson(payloads[path])
    }

    const app = createDashboardApp({ doc, win, fetchImpl })
    await app.start()

    expect(nodes['detail-title'].textContent).toBe('Session detail unavailable')
    expect(nodes['detail-description'].textContent).toContain('returned an invalid detail payload')
    expect(nodes['detail-panel'].children[0].children[1].textContent).toContain('Invalid JSON response')
    expect(nodes['detail-panel'].children[0].children[1].textContent).not.toContain('Network request failed')
  })

  it('treats structurally invalid 200 session detail objects as invalid detail payloads', async () => {
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
      '/api/v1/sessions/session-2?project_ref=project-demo': {
        active_ms: 90_000,
        wait_ms: 10_000,
        event_count: 3,
        host_model_mix: [],
      },
    })
    const fetchImpl = async (path: string) => okJson(payloads[path])

    const app = createDashboardApp({ doc, win, fetchImpl })
    await app.start()

    expect(nodes['detail-title'].textContent).toBe('Session detail unavailable')
    expect(nodes['detail-description'].textContent).toContain('returned an invalid detail payload')
    expect(nodes['detail-panel'].children[0].children[1].textContent).toContain('Missing required detail fields')
    expect(nodes['detail-panel'].children[0].children[1].textContent).not.toContain('Network request failed')
  })

  it('treats 200 session detail bodies for a different route identity as invalid detail payloads', async () => {
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
      '/api/v1/sessions/session-2?project_ref=project-demo': {
        session_id: 'session-other',
        project_name: 'demo-other',
        project_ref: 'project-other',
        host: 'codex',
        last_host: 'codex',
        model_name: 'gpt-5.4',
        last_model_name: 'gpt-5.4',
        git_branch: 'feat/other',
        last_git_branch: 'feat/other',
        first_event_time: '2026-04-05T07:55:00Z',
        events: 3,
        event_count: 3,
        active_ms: 90_000,
        wait_ms: 10_000,
        languages: [],
        file_deltas: [],
        file_preview: [],
        file_preview_truncated_count: 0,
        changed_files_count: 0,
        changed_languages_count: 0,
        lines_added: 0,
        lines_removed: 0,
        lines_changed: 0,
        host_model_mix: [],
        host_model_mix_count: 0,
        last_event_time: '2026-04-05T08:00:00Z',
      },
    })
    const fetchImpl = async (path: string) => okJson(payloads[path])

    const app = createDashboardApp({ doc, win, fetchImpl })
    await app.start()

    expect(nodes['detail-title'].textContent).toBe('Session detail unavailable')
    expect(nodes['detail-description'].textContent).toContain('returned an invalid detail payload')
    expect(nodes['detail-panel'].children[0].children[1].textContent).toContain('route identity')
    expect(win.location.hash).toBe('#/sessions/project-demo/session-2')
  })

  it('treats unscoped 200 session detail responses without project_ref as invalid detail payloads', async () => {
    const nodes = createDashboardNodes()
    const doc = new FakeDocument(nodes)
    const win = new FakeWindow('#/sessions/session-2')
    const payloads = buildBaseDashboardPayloads({
      '/api/v1/sessions/session-2': {
        session_id: 'session-2',
        project_name: 'demo-api',
        active_ms: 90_000,
        wait_ms: 10_000,
        event_count: 3,
        host_model_mix: [],
      },
    })
    const fetchImpl = async (path: string) => okJson(payloads[path])

    const app = createDashboardApp({ doc, win, fetchImpl })
    await app.start()

    expect(nodes['detail-title'].textContent).toBe('Session detail unavailable')
    expect(nodes['detail-description'].textContent).toContain('returned an invalid detail payload')
    expect(nodes['detail-panel'].children[0].children[1].textContent).toContain('project_ref')
    expect(win.location.hash).toBe('#/sessions/session-2')
  })

  it('treats sparse 200 project detail objects as invalid detail payloads', async () => {
    const nodes = createDashboardNodes()
    const doc = new FakeDocument(nodes)
    const win = new FakeWindow('#/projects/project-demo')
    const payloads = buildBaseDashboardPayloads({
      '/api/v1/projects/project-demo': {
        project_name: 'demo-api',
        project_ref: 'project-demo',
      },
      [buildCompactProjectSessionsPath('project-demo')]: {
        project_name: 'demo-api',
        project_ref: 'project-demo',
        items: [],
      },
    })
    const fetchImpl = async (path: string) => okJson(payloads[path])

    const app = createDashboardApp({ doc, win, fetchImpl })
    await app.start()

    expect(nodes['detail-title'].textContent).toBe('Project detail unavailable')
    expect(nodes['detail-description'].textContent).toContain('returned an invalid detail payload')
    expect(nodes['detail-panel'].children[0].children[1].textContent).toContain('Missing required detail fields')
    expect(nodes['detail-panel'].children[0].children[1].textContent).toContain('active_ms')
  })

  it('uses endpoint-neutral copy when project sessions return invalid JSON', async () => {
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
        file_preview: [],
        languages: [{ name: 'TypeScript', changed: 15 }],
        host_model_mix: [],
      },
    })
    const fetchImpl = async (path: string) => {
      if (isProjectSessionsPath(path, 'project-demo')) {
        return {
          ok: true,
          status: 200,
          async json() {
            throw new SyntaxError('Unexpected end of JSON input')
          },
        }
      }

      return okJson(payloads[path])
    }

    const app = createDashboardApp({ doc, win, fetchImpl })
    await app.start()

    expect(nodes['detail-title'].textContent).toBe('Project: demo-api')
    expect(nodes.sessions.children[0]?.textContent).toContain('Project sessions unavailable.')
    expect(nodes.sessions.children[0]?.textContent).toContain('Invalid JSON response')
    expect(nodes.sessions.children[0]?.textContent).not.toContain('detail endpoint')
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
      if (isRecentSessionsPath(path)) {
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
