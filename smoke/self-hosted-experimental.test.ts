import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { createDashboardApp } from '../apps/web/dashboard.js'
import { runClipulseSmokeScenario } from '../packages/adapter-opencode/examples/clipulse.ts'
import {
  assertCommandSucceeded,
  formatCommandFailureMessage,
  parseJsonBatchLinesOutput,
  parseSingleJsonBatchOutput,
  runCommand,
} from '../scripts/smoke-shared.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const localContractPath = path.join(repoRoot, 'contracts', 'dashboard-compat.v1.json')
const geminiSmokeFixturePath = new URL('../packages/adapter-gemini/examples/after-tool.write-file.json', import.meta.url)

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

  constructor(nodes: Record<string, FakeElement>) {
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

  constructor(hash = '#/') {
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

interface StartedApi {
  baseUrl: string
  logs: () => string
  stop: () => Promise<void>
}

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

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Unable to resolve a free localhost port.')))
        return
      }

      const { port } = address
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve(port)
      })
    })
  })
}

async function waitFor(
  condition: () => boolean | Promise<boolean>,
  errorMessage: string,
  timeoutMs = 15_000,
  intervalMs = 50,
): Promise<void> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (await condition()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  throw new Error(errorMessage)
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

async function startApi(stateDir: string, databaseUrl: string): Promise<StartedApi> {
  const port = await getFreePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const apiProcess = spawnApiProcess(port, stateDir, databaseUrl)
  let stdout = ''
  let stderr = ''

  apiProcess.stdout.on('data', (chunk) => {
    stdout += String(chunk)
  })
  apiProcess.stderr.on('data', (chunk) => {
    stderr += String(chunk)
  })

  await waitFor(
    async () => {
      if (apiProcess.exitCode !== null) {
        throw new Error(`API exited before becoming ready.\n${stdout}${stderr}`)
      }

      try {
        const response = await fetch(`${baseUrl}/healthz`)
        return response.status === 204
      } catch {
        return false
      }
    },
    'Timed out waiting for the API to answer /healthz.',
    20_000,
  )

  return {
    baseUrl,
    logs: () => `${stdout}${stderr}`,
    stop: async () => {
      if (apiProcess.exitCode !== null) {
        return
      }

      apiProcess.kill('SIGTERM')
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (apiProcess.exitCode === null) {
            apiProcess.kill('SIGKILL')
          }
        }, 5_000)

        apiProcess.once('close', () => {
          clearTimeout(timer)
          resolve()
        })
      })
    },
  }
}

function spawnApiProcess(
  port: number,
  stateDir: string,
  databaseUrl: string,
): ChildProcessWithoutNullStreams {
  const pythonScript = [
    'from clipulse_api.app import create_app',
    'import uvicorn',
    `uvicorn.run(create_app(database_url=${JSON.stringify(databaseUrl)}), host="127.0.0.1", port=${port}, log_level="warning")`,
  ].join('\n')

  return spawn('uv', ['run', 'python', '-c', pythonScript], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CLIPULSE_STATE_DIR: stateDir,
      PYTHONPATH: 'apps/api',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url)
  const body = await response.text()

  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status} ${body}`)
  }

  return JSON.parse(body)
}

async function runGeminiSmokeFixture(
  apiBaseUrl: string,
  stateDir: string,
): Promise<void> {
  const args = ['packages/adapter-gemini/dist/cli.js']
  const fixtureInput = await readFile(geminiSmokeFixturePath, 'utf8')
  const result = await runCommand(
    'node',
    args,
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        CLIPULSE_API_URL: apiBaseUrl,
        CLIPULSE_STATE_DIR: stateDir,
      },
      input: fixtureInput,
      stepLabel: 'Gemini smoke fixture',
    },
  )

  assertCommandSucceeded(result, {
    args,
    command: 'node',
    cwd: repoRoot,
    stepLabel: 'Gemini smoke fixture',
  })
}

async function withPatchedEnv<T>(
  nextValues: Record<string, string>,
  action: () => Promise<T>,
): Promise<T> {
  const previousValues = new Map<string, string | undefined>()

  for (const [key, value] of Object.entries(nextValues)) {
    previousValues.set(key, process.env[key])
    process.env[key] = value
  }

  try {
    return await action()
  } finally {
    for (const [key, previousValue] of previousValues.entries()) {
      if (typeof previousValue === 'string') {
        process.env[key] = previousValue
      } else {
        delete process.env[key]
      }
    }
  }
}

function createDashboardFetch(baseUrl: string) {
  return async (input: string | URL) => {
    if (typeof input === 'string') {
      return fetch(new URL(input, baseUrl))
    }

    if (input.pathname.endsWith('/contracts/dashboard-compat.v1.json')) {
      return fetch(new URL('/contracts/dashboard-compat.v1.json', baseUrl))
    }

    return fetch(input)
  }
}

function hasCompatibilityFallbackHint(nodes: ReturnType<typeof createDashboardNodes>): boolean {
  return nodes['detail-panel'].children.some((row) => (
    row.children[0]?.textContent === 'Compatibility checks'
    && row.children[1]?.textContent === 'Using built-in dashboard contract fallback.'
  ))
}

async function runCollectorCliProbe(
  stateDir: string,
  subcommand: string,
  stepLabel: string,
) {
  const args = ['packages/collector-core/dist/cli.js', subcommand]
  const result = await runCommand(
    'node',
    args,
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        CLIPULSE_STATE_DIR: stateDir,
      },
      stepLabel,
    },
  )
  assertCommandSucceeded(result, {
    args,
    command: 'node',
    cwd: repoRoot,
    stepLabel,
  })
  return result
}

async function assertMissingStateCliProbe(
  stateDir: string,
  subcommand: string,
  expectedTitle: string,
  expectedHint: string,
) {
  const result = await runCollectorCliProbe(
    stateDir,
    subcommand,
    `collector ${subcommand} with missing state dir`,
  )
  expect(result.stdout).toContain(expectedTitle)
  expect(result.stdout).toContain(expectedHint)
  expect(await pathExists(stateDir)).toBe(false)
  return result
}

function getEventCount(item: { event_count?: number; events?: number } | undefined) {
  return item.event_count ?? item.events ?? null
}

function getPrimaryHost(item: { host?: string; last_host?: string } | undefined) {
  return item.host ?? item.last_host ?? null
}

interface SessionListItemLike {
  active_ms?: number
  event_count?: number
  events?: number
  host?: string
  host_model_mix?: unknown[]
  host_model_mix_count?: number
  host_model_primary?: Record<string, unknown> | null
  last_event_time?: string
  last_host?: string
  last_model_name?: string
  project_name?: string
  project_ref?: string
  session_id?: string
  wait_ms?: number
}

function normalizeSessionListItemForParity(item: SessionListItemLike | undefined) {
  return {
    active_ms: item?.active_ms ?? null,
    event_count: getEventCount(item),
    host: getPrimaryHost(item),
    host_model_mix_count: item?.host_model_mix_count ?? null,
    host_model_primary: item?.host_model_primary ?? null,
    last_event_time: item?.last_event_time ?? null,
    last_model_name: item?.last_model_name ?? null,
    project_name: item?.project_name ?? null,
    project_ref: item?.project_ref ?? null,
    session_id: item?.session_id ?? null,
    wait_ms: item?.wait_ms ?? null,
  }
}

function findSessionItemById(items: SessionListItemLike[], sessionId: string) {
  return items.find((item) => item.session_id === sessionId)
}

function assertSessionListResponseParity(
  fullResponse: { items: SessionListItemLike[]; [key: string]: unknown },
  compactResponse: { items: SessionListItemLike[]; [key: string]: unknown },
) {
  expect(compactResponse).toEqual({
    ...fullResponse,
    items: fullResponse.items.map((item) => {
      const { host_model_mix: _hostModelMix, ...sharedFields } = item
      return sharedFields
    }),
  })
}

function assertDashboardDetailRow(
  nodes: ReturnType<typeof createDashboardNodes>,
  label: string,
  expectedValue: (value: string) => void,
) {
  const row = nodes['detail-panel'].children.find((candidate) => candidate.children[0]?.textContent === label)
  expect(row).toBeDefined()
  expectedValue(row?.children[1]?.textContent ?? '')
}

function hashDashboardContract(content: string | Buffer) {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`
}

describe('command diagnostics helpers', () => {
  it('formats step labels with cwd, exit code, stdout, and stderr context', () => {
    const message = formatCommandFailureMessage({
      args: ['packages/collector-core/dist/cli.js', 'pending'],
      command: 'node',
      cwd: '/tmp/clipulse-smoke',
      exitCode: 3,
      reason: 'exit',
      stepLabel: 'pending backlog probe',
      stderr: 'stderr line\n',
      stdout: 'stdout line\n',
    })

    expect(message).toContain('pending backlog probe')
    expect(message).toContain('cwd: /tmp/clipulse-smoke')
    expect(message).toContain('exit code: 3')
    expect(message).toContain('stdout:\nstdout line')
    expect(message).toContain('stderr:\nstderr line')
  })

  it('includes timeout context for timed out commands', async () => {
    await expect(runCommand(
      'node',
      ['-e', 'setTimeout(() => {}, 200)'],
      {
        cwd: repoRoot,
        env: process.env,
        stepLabel: 'timeout probe',
        timeoutMs: 50,
      },
    )).rejects.toThrowError(/timeout probe/)
  })

  it('parses a single JSON smoke batch and enforces required Gemini event fields', () => {
    const payload = parseSingleJsonBatchOutput(JSON.stringify({
      events: [
        {
          host: 'gemini-cli',
          session_id: 'gemini-smoke-session',
          event_name: 'post_tool_use',
          privacy_mode: 'hashed',
        },
      ],
    }), {
      expectedHost: 'gemini-cli',
      expectedSessionId: 'gemini-smoke-session',
      requiredEventNames: ['post_tool_use'],
    })

    expect(payload.events).toHaveLength(1)
    expect(payload.events[0]?.privacy_mode).toBe('hashed')
  })

  it('parses multi-line JSON smoke batches and enforces stable OpenCode event flow', () => {
    const payloads = parseJsonBatchLinesOutput([
      JSON.stringify({
        events: [{ host: 'opencode', session_id: 'opencode-smoke-session', event_name: 'session_start' }],
      }),
      JSON.stringify({
        events: [{ host: 'opencode', session_id: 'opencode-smoke-session', event_name: 'pre_tool_use' }],
      }),
      JSON.stringify({
        events: [{ host: 'opencode', session_id: 'opencode-smoke-session', event_name: 'file_edited' }],
      }),
      JSON.stringify({
        events: [{ host: 'opencode', session_id: 'opencode-smoke-session', event_name: 'post_tool_use' }],
      }),
    ].join('\n'), {
      expectedHost: 'opencode',
      expectedSessionId: 'opencode-smoke-session',
      requiredEventNames: ['session_start', 'pre_tool_use', 'file_edited', 'post_tool_use'],
    })

    expect(payloads).toHaveLength(4)
  })
})

describe('self-hosted experimental wiring smoke', () => {
  it('covers live self-hosted API wiring, operator CLI behavior, Gemini, OpenCode, and dashboard contract refresh', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'clipulse-self-hosted-smoke-'))
    const liveStateDir = path.join(tempRoot, 'live-state')
    const missingStateDir = path.join(tempRoot, 'missing-state')
    const databaseUrl = `sqlite+pysqlite:///${path.join(tempRoot, 'clipulse-smoke.sqlite3')}`
    const geminiSessionId = 'gemini-smoke-session'
    const opencodeSessionId = 'opencode-smoke-session'
    const api = await startApi(liveStateDir, databaseUrl)

    try {
      const healthz = await fetch(`${api.baseUrl}/healthz`)
      expect(healthz.status).toBe(204)
      expect(await healthz.text()).toBe('')

      const localContractRaw = await readFile(localContractPath)
      const localContract = JSON.parse(localContractRaw.toString('utf8'))
      const localContractMeta = localContract._meta as {
        section_count: number
        sections: string[]
        version: string
      }
      const initialStatus = await fetchJson(`${api.baseUrl}/api/v1/status`)
      expect(initialStatus).toEqual(expect.objectContaining({
        api: expect.any(Object),
        compat: expect.any(Object),
        db: expect.any(Object),
        spool: expect.any(Object),
      }))
      expect(initialStatus.compat).toEqual({
        pointer: '/contracts/dashboard-compat.v1.json',
        hash: hashDashboardContract(localContractRaw),
        tier: 'minimum',
        surfaces: ['dashboard-summary', 'dashboard-detail'],
        artifact_version: localContractMeta.version,
        artifact_sections: localContractMeta.sections,
        artifact_section_count: localContractMeta.section_count,
      })
      expect(initialStatus.spool.state_dir).toBe(liveStateDir)
      expect(initialStatus.spool.state_dir_exists).toBe(false)
      expect(initialStatus.spool.ready).toBe(0)
      expect(initialStatus.spool.processing).toBe(0)
      expect(initialStatus.spool.quarantine).toBe(0)
      expect(initialStatus.spool.ready_bytes).toBeGreaterThanOrEqual(0)
      expect(initialStatus.spool.processing_bytes).toBeGreaterThanOrEqual(0)
      expect(initialStatus.spool.quarantine_bytes).toBeGreaterThanOrEqual(0)
      expect(initialStatus.spool.oldest_backlog_age_seconds).toBeGreaterThanOrEqual(0)
      expect(initialStatus.spool.oldest_quarantine_age_seconds).toBeGreaterThanOrEqual(0)

      expect(await fetchJson(`${api.baseUrl}/contracts/dashboard-compat.v1.json`)).toEqual(localContract)

      expect(await pathExists(missingStateDir)).toBe(false)

      const doctorResult = await assertMissingStateCliProbe(
        missingStateDir,
        'doctor',
        'Clipulse local operator doctor',
        'no local state directory yet',
      )

      const pendingResult = await assertMissingStateCliProbe(
        missingStateDir,
        'pending',
        'Clipulse local operator pending',
        'pending backlog unavailable without local state yet',
      )

      const fallbackDoctorResult = await assertMissingStateCliProbe(
        missingStateDir,
        'mystery',
        'Clipulse local operator doctor',
        'unknown command "mystery"; falling back to doctor',
      )
      expect(fallbackDoctorResult.stdout).toContain('no local state directory yet')
      expect(fallbackDoctorResult.stdout).not.toContain('Clipulse local operator pending')

      await runGeminiSmokeFixture(api.baseUrl, liveStateDir)

      expect(await pathExists(liveStateDir)).toBe(true)

      await withPatchedEnv(
        {
          CLIPULSE_API_URL: api.baseUrl,
          CLIPULSE_STATE_DIR: liveStateDir,
        },
        async () => {
          await runClipulseSmokeScenario({
            directory: repoRoot,
            worktree: repoRoot,
          })
        },
      )

      const statusAfterAdapters = await fetchJson(`${api.baseUrl}/api/v1/status`)
      expect(statusAfterAdapters.db.events).toBeGreaterThanOrEqual(1)
      expect(statusAfterAdapters.compat).toEqual(initialStatus.compat)
      expect(statusAfterAdapters.spool.state_dir).toBe(liveStateDir)
      expect(statusAfterAdapters.spool.state_dir_exists).toBe(true)
      expect(statusAfterAdapters.spool.ready_bytes).toBeGreaterThanOrEqual(0)
      expect(statusAfterAdapters.spool.processing_bytes).toBeGreaterThanOrEqual(0)
      expect(statusAfterAdapters.spool.quarantine_bytes).toBeGreaterThanOrEqual(0)
      expect(statusAfterAdapters.spool.oldest_backlog_age_seconds).toBeGreaterThanOrEqual(0)
      expect(statusAfterAdapters.spool.oldest_quarantine_age_seconds).toBeGreaterThanOrEqual(0)

      const hosts = await fetchJson(`${api.baseUrl}/api/v1/breakdown/hosts`)
      expect(hosts.items.map((item: { name: string }) => item.name)).toEqual(
        expect.arrayContaining(['gemini-cli', 'opencode']),
      )

      const projects = await fetchJson(`${api.baseUrl}/api/v1/projects/top?limit=5`)
      expect(projects.items.length).toBeGreaterThan(0)
      expect(projects.items.map((item: { project_name: string }) => item.project_name)).toContain('Clipulse')

      const compactRecentSessions = await fetchJson(`${api.baseUrl}/api/v1/sessions/recent?limit=10&compact=true`)
      const fullRecentSessions = await fetchJson(`${api.baseUrl}/api/v1/sessions/recent?limit=10`)
      assertSessionListResponseParity(fullRecentSessions, compactRecentSessions)
      expect(compactRecentSessions.items.map((item: { session_id: string }) => item.session_id)).toEqual(
        expect.arrayContaining([geminiSessionId, opencodeSessionId]),
      )
      expect(fullRecentSessions.items.map((item: { session_id: string }) => item.session_id)).toEqual(
        expect.arrayContaining([geminiSessionId, opencodeSessionId]),
      )

      const geminiRecentSession = findSessionItemById(compactRecentSessions.items, geminiSessionId)
      const opencodeRecentSession = findSessionItemById(compactRecentSessions.items, opencodeSessionId)
      const geminiRecentSessionFull = findSessionItemById(fullRecentSessions.items, geminiSessionId)
      const opencodeRecentSessionFull = findSessionItemById(fullRecentSessions.items, opencodeSessionId)

      for (const item of [geminiRecentSession, opencodeRecentSession]) {
        expect(item).toEqual(expect.objectContaining({
          session_id: expect.any(String),
          project_name: expect.any(String),
          project_ref: expect.any(String),
          active_ms: expect.any(Number),
          host_model_primary: expect.any(Object),
          host_model_mix_count: expect.any(Number),
        }))
        expect(item.host ?? item.last_host).toEqual(expect.any(String))
        expect(item.event_count ?? item.events).toEqual(expect.any(Number))
        expect(item.host_model_mix).toBeUndefined()
      }

      for (const [compactItem, fullItem] of [
        [geminiRecentSession, geminiRecentSessionFull],
        [opencodeRecentSession, opencodeRecentSessionFull],
      ]) {
        expect(normalizeSessionListItemForParity(fullItem)).toEqual(normalizeSessionListItemForParity(compactItem))
        expect(fullItem.host_model_mix).toEqual(expect.any(Array))
      }

      const geminiProjectRef = geminiRecentSession?.project_ref
      expect(typeof geminiProjectRef).toBe('string')

      const projectScopedExpectations = new Map<string, string[]>()
      for (const [projectRef, sessionId] of [
        [geminiRecentSession?.project_ref, geminiSessionId],
        [opencodeRecentSession?.project_ref, opencodeSessionId],
      ]) {
        expect(typeof projectRef).toBe('string')
        projectScopedExpectations.set(projectRef, [
          ...(projectScopedExpectations.get(projectRef) ?? []),
          sessionId,
        ])
      }

      for (const [projectRef, sessionIds] of projectScopedExpectations.entries()) {
        const compactProjectSessions = await fetchJson(
          `${api.baseUrl}/api/v1/projects/${encodeURIComponent(projectRef)}/sessions?limit=10&compact=true`,
        )
        const fullProjectSessions = await fetchJson(
          `${api.baseUrl}/api/v1/projects/${encodeURIComponent(projectRef)}/sessions?limit=10`,
        )
        assertSessionListResponseParity(fullProjectSessions, compactProjectSessions)

        for (const sessionId of sessionIds) {
          const projectSessionCompact = findSessionItemById(compactProjectSessions.items, sessionId)
          const projectSessionFull = findSessionItemById(fullProjectSessions.items, sessionId)

          expect(projectSessionCompact).toBeDefined()
          expect(projectSessionFull).toBeDefined()
          expect(normalizeSessionListItemForParity(projectSessionFull)).toEqual(
            normalizeSessionListItemForParity(projectSessionCompact),
          )
          expect(projectSessionCompact.host_model_mix).toBeUndefined()
          expect(projectSessionFull.host_model_mix).toEqual(expect.any(Array))
        }
      }

      const nodes = createDashboardNodes()
      const doc = new FakeDocument(nodes)
      const win = new FakeWindow('#/')
      const dashboardFetch = createDashboardFetch(api.baseUrl)
      const dashboardApp = createDashboardApp({
        doc,
        win,
        fetchImpl: dashboardFetch,
        contractFetchImpl: dashboardFetch,
      })

      await dashboardApp.start()
      await waitFor(
        async () => (
          nodes.projects.children.length > 0
          && nodes.sessions.children.length > 0
          && !hasCompatibilityFallbackHint(nodes)
        ),
        'Dashboard never cleared the built-in contract fallback hint against the live contract.',
      )

      expect(nodes.projects.children.length).toBeGreaterThan(0)
      expect(nodes.sessions.children.length).toBeGreaterThan(0)
      expect(hasCompatibilityFallbackHint(nodes)).toBe(false)
      expect(nodes.sessions.children.some((row) => row.children[1]?.textContent?.includes('Primary Gemini CLI (experimental) / gemini-2.5-pro'))).toBe(true)

      win.location.hash = `#/sessions/${encodeURIComponent(geminiProjectRef)}/${encodeURIComponent(geminiSessionId)}`
      win.dispatch('hashchange')

      await waitFor(
        async () => nodes['detail-title'].textContent.includes(geminiSessionId),
        'Dashboard never loaded the Gemini session detail route.',
      )

      assertDashboardDetailRow(nodes, 'Changed files', (value) => {
        expect(value).toContain('1 file')
      })
      assertDashboardDetailRow(nodes, 'Primary host-model', (value) => {
        expect(value).toBe('Gemini CLI (experimental) / gemini-2.5-pro')
      })
    } catch (error) {
      throw new Error([
        error instanceof Error ? error.message : String(error),
        '',
        'API logs:',
        api.logs(),
      ].join('\n'))
    } finally {
      await api.stop()
      await rm(tempRoot, { force: true, recursive: true })
    }
  }, 120_000)
})
