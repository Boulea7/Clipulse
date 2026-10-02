import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
import {
  assertProjectDetailConsistency,
  assertProjectRollupConsistency,
  assertQueueParityConsistency,
  assertSessionDetailConsistency,
  assertSessionListResponseParity,
  findSessionItemById,
  normalizeSessionListItemForParity,
  type SessionListItemLike,
} from './self-hosted-parity.ts'

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
  cookie: string

  constructor(nodes: Record<string, FakeElement>) {
    this.nodes = nodes
    this.cookie = 'clipulse_dashboard_locale=en'
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
      CLIPULSE_ALLOW_INSECURE_NO_AUTH: '1',
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

async function fetchJsonResult(url: string): Promise<{
  body: any
  ok: boolean
  status: number
}> {
  const response = await fetch(url)
  const body = await response.text()

  return {
    body: body === '' ? null : JSON.parse(body),
    ok: response.ok,
    status: response.status,
  }
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

async function runClaudeSmokeFixture(
  apiBaseUrl: string,
  stateDir: string,
  projectRoot: string,
  sessionId: string,
): Promise<void> {
  const args = ['packages/adapter-claude/dist/cli.js']
  const transcriptPath = path.join(projectRoot, 'transcripts', `${sessionId}.jsonl`)
  const filePath = path.join(projectRoot, 'src', 'claude-smoke.ts')

  await mkdir(path.dirname(transcriptPath), { recursive: true })
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, 'export const claudeSmoke = 1;\n', 'utf8')
  await writeFile(
    transcriptPath,
    JSON.stringify({
      timestamp: '2026-04-12T08:00:00.000Z',
      toolUseResult: {
        filePath,
        structuredPatch: [
          {
            lines: ['@@ -1 +1,2 @@', ' export const claudeSmoke = 1;', '+export const claudeStable = true;'],
          },
        ],
      },
    }),
    'utf8',
  )

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
      input: JSON.stringify({
        cwd: projectRoot,
        event_time: '2026-04-12T08:00:01.000Z',
        hook_event_name: 'PostToolUse',
        model: 'claude-sonnet-4',
        session_id: sessionId,
        transcript_path: transcriptPath,
      }),
      stepLabel: 'Claude smoke fixture',
    },
  )

  assertCommandSucceeded(result, {
    args,
    command: 'node',
    cwd: repoRoot,
    stepLabel: 'Claude smoke fixture',
  })
}

async function runCodexSmokeFixture(
  apiBaseUrl: string,
  stateDir: string,
  projectRoot: string,
  sessionId: string,
): Promise<void> {
  const args = ['packages/adapter-codex/dist/cli.js']
  const filePath = path.join(projectRoot, 'src', 'codex-smoke.ts')

  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, 'export const codexSmoke = 1;\n', 'utf8')

  const runCodexStep = async (
    input: Record<string, unknown>,
    stepLabel: string,
  ) => {
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
        input: JSON.stringify(input),
        stepLabel,
      },
    )

    assertCommandSucceeded(result, {
      args,
      command: 'node',
      cwd: repoRoot,
      stepLabel,
    })
  }

  await runCodexStep(
    {
      cwd: projectRoot,
      event_time: '2026-04-12T08:05:00.000Z',
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      session_id: sessionId,
    },
    'Codex smoke session start',
  )

  await writeFile(
    filePath,
    'export const codexSmoke = 1;\nexport const codexStable = true;\n',
    'utf8',
  )

  await runCodexStep(
    {
      cwd: projectRoot,
      event_time: '2026-04-12T08:05:05.000Z',
      hook_event_name: 'PostToolUse',
      model: 'gpt-5.4',
      session_id: sessionId,
      tool_input: {
        command: 'git add src/codex-smoke.ts',
      },
      tool_name: 'Bash',
    },
    'Codex smoke post tool use',
  )
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

async function seedSpoolState(
  stateDir: string,
  mode: 'mixed' | 'processing_only' | 'quarantine_only' = 'mixed',
) {
  const readyPayload = JSON.stringify({ events: [{ event_id: 'ready-1' }] })
  const processingPayload = JSON.stringify({ events: [{ event_id: 'processing-1' }] })
  const quarantinePayload = JSON.stringify({ events: [{ event_id: 'quarantine-1' }] })

  await mkdir(path.join(stateDir, 'spool', 'ready'), { recursive: true })
  await mkdir(path.join(stateDir, 'spool', 'processing'), { recursive: true })
  await mkdir(path.join(stateDir, 'spool', 'quarantine'), { recursive: true })

  if (mode === 'mixed') {
    await writeFile(path.join(stateDir, 'spool', 'ready', 'ready-batch.json'), readyPayload, 'utf8')
  }

  if (mode === 'mixed' || mode === 'processing_only') {
    await writeFile(
      path.join(stateDir, 'spool', 'processing', 'processing-batch.json'),
      processingPayload,
      'utf8',
    )
  }

  if (mode === 'mixed' || mode === 'quarantine_only') {
    await writeFile(
      path.join(stateDir, 'spool', 'quarantine', 'quarantine-batch.json'),
      quarantinePayload,
      'utf8',
    )
    await writeFile(
      path.join(stateDir, 'spool', 'quarantine', 'quarantine-batch.meta.json'),
      JSON.stringify({
        reason: 'http_error',
        source_state: 'ready',
        approx_bytes: Buffer.byteLength(quarantinePayload),
        event_count: 1,
      }),
      'utf8',
    )
  }

  return {
    processingBytes: Buffer.byteLength(processingPayload),
    quarantineBytes: Buffer.byteLength(quarantinePayload),
    readyBytes: Buffer.byteLength(readyPayload),
  }
}

async function seedDirtySpoolState(stateDir: string) {
  const readyDir = path.join(stateDir, 'spool', 'ready')
  const processingDir = path.join(stateDir, 'spool', 'processing')
  const quarantineDir = path.join(stateDir, 'spool', 'quarantine')
  const quarantineHttpPayload = JSON.stringify({ events: [{ event_id: 'dirty-http-1' }] })
  const quarantineStalePayload = JSON.stringify({ events: [{ event_id: 'dirty-stale-1' }] })

  await mkdir(readyDir, { recursive: true })
  await mkdir(processingDir, { recursive: true })
  await mkdir(quarantineDir, { recursive: true })

  await writeFile(path.join(readyDir, 'ready-orphan.meta.json'), '{}', 'utf8')
  await writeFile(path.join(processingDir, 'processing-orphan.meta.json'), '{}', 'utf8')
  await writeFile(path.join(quarantineDir, 'quarantine-orphan.meta.json'), '{}', 'utf8')
  await writeFile(path.join(quarantineDir, 'quarantine-broken.meta.json'), '{"reason":', 'utf8')

  await writeFile(path.join(quarantineDir, 'quarantine-http.json'), quarantineHttpPayload, 'utf8')
  await writeFile(
    path.join(quarantineDir, 'quarantine-http.meta.json'),
    JSON.stringify({
      reason: 'http_error',
      source_state: 'ready',
      first_seen_at: 'broken',
      last_attempted_at: '2026-04-07T09:05:00.000Z',
      attempt_count: 4,
      approx_bytes: 321,
      event_count: 1,
    }),
    'utf8',
  )

  await writeFile(path.join(quarantineDir, 'quarantine-stale.json'), quarantineStalePayload, 'utf8')
  await writeFile(
    path.join(quarantineDir, 'quarantine-stale.meta.json'),
    JSON.stringify({
      reason: 'stale_backlog',
      source_state: 'processing',
      first_seen_at: '2026-04-06T11:00:00.000Z',
      last_attempted_at: '2026-04-06T11:02:00.000Z',
      attempt_count: 5,
      approx_bytes: 654,
      event_count: 1,
    }),
    'utf8',
  )

  return {
    orphanSidecars: { ready: 1, processing: 1, quarantine: 2, total: 4 },
    quarantineReasonCounts: { http_error: 1, stale_backlog: 1 },
    quarantineMetaErrorCounts: { read_error: 0, parse_error: 1 },
  }
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

function hasDetailPanelRow(
  nodes: ReturnType<typeof createDashboardNodes>,
  label: string,
) {
  return nodes['detail-panel'].children.some((row) => row.children[0]?.textContent === label)
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

describe('self-hosted stable wiring smoke', () => {
  it('covers live self-hosted API wiring, Claude/Codex ingest, compact parity, and local operator status cross-checks', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'clipulse-self-hosted-smoke-'))
    const liveStateDir = path.join(tempRoot, 'live-state')
    const missingStateDir = path.join(tempRoot, 'missing-state')
    const stableProjectName = 'stable-project'
    const stableProjectRoot = path.join(tempRoot, 'projects', stableProjectName)
    const stableSiblingProjectRoot = path.join(tempRoot, 'worktrees', stableProjectName)
    const databaseUrl = `sqlite+pysqlite:///${path.join(tempRoot, 'clipulse-smoke.sqlite3')}`
    const claudeSessionId = 'claude-smoke-session'
    const codexSessionId = 'codex-smoke-session'
    const sharedSessionId = 'shared-stable-session'
    let checkpoint = 'starting API'
    const api = await startApi(liveStateDir, databaseUrl)

    try {
      checkpoint = 'healthz and initial status'
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
      expect(initialStatus.compat).toMatchObject({
        pointer: '/contracts/dashboard-compat.v1.json',
        hash: hashDashboardContract(localContractRaw),
        tier: 'minimum',
        artifact_status: 'ok',
        surfaces: ['dashboard-summary', 'dashboard-detail'],
        artifact_version: localContractMeta.version,
        artifact_sections: localContractMeta.sections,
        artifact_section_count: localContractMeta.section_count,
      })
      expect(initialStatus.spool.state_dir).toBe('<redacted>')
      expect(initialStatus.spool.state_dir_kind).toBe('missing')
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

      await runClaudeSmokeFixture(api.baseUrl, liveStateDir, stableProjectRoot, claudeSessionId)
      await runCodexSmokeFixture(api.baseUrl, liveStateDir, stableProjectRoot, codexSessionId)
      await runClaudeSmokeFixture(api.baseUrl, liveStateDir, stableProjectRoot, sharedSessionId)
      await runCodexSmokeFixture(api.baseUrl, liveStateDir, stableSiblingProjectRoot, sharedSessionId)

      expect(await pathExists(liveStateDir)).toBe(true)

      checkpoint = 'live operator parity'
      const statusAfterAdapters = await fetchJson(`${api.baseUrl}/api/v1/status`)
      expect(statusAfterAdapters.db.events).toBeGreaterThanOrEqual(3)
      expect(statusAfterAdapters.compat).toEqual(initialStatus.compat)
      expect(statusAfterAdapters.spool.state_dir).toBe('<redacted>')
      expect(statusAfterAdapters.spool.state_dir_kind).toBe('directory')
      expect(statusAfterAdapters.spool.state_dir_exists).toBe(true)
      expect(statusAfterAdapters.spool.ready).toBe(0)
      expect(statusAfterAdapters.spool.processing).toBe(0)
      expect(statusAfterAdapters.spool.quarantine).toBe(0)
      expect(statusAfterAdapters.spool.ready_bytes).toBeGreaterThanOrEqual(0)
      expect(statusAfterAdapters.spool.processing_bytes).toBeGreaterThanOrEqual(0)
      expect(statusAfterAdapters.spool.quarantine_bytes).toBeGreaterThanOrEqual(0)
      expect(statusAfterAdapters.spool.oldest_backlog_age_seconds).toBeGreaterThanOrEqual(0)
      expect(statusAfterAdapters.spool.oldest_quarantine_age_seconds).toBeGreaterThanOrEqual(0)

      const liveDoctorResult = await runCollectorCliProbe(
        liveStateDir,
        'doctor',
        'collector doctor live state probe',
      )
      expect(liveDoctorResult.stdout).toContain(`state dir: ${liveStateDir}`)
      expect(liveDoctorResult.stdout).toContain(
        `ready: ${statusAfterAdapters.spool.ready} | processing: ${statusAfterAdapters.spool.processing} | quarantine: ${statusAfterAdapters.spool.quarantine}`,
      )
      expect(liveDoctorResult.stdout).toContain(
        `payload bytes: ready=${statusAfterAdapters.spool.ready_bytes} processing=${statusAfterAdapters.spool.processing_bytes} quarantine=${statusAfterAdapters.spool.quarantine_bytes}`,
      )

      const livePendingResult = await runCollectorCliProbe(
        liveStateDir,
        'pending',
        'collector pending live state probe',
      )
      assertQueueParityConsistency(statusAfterAdapters.spool, {
        doctorOutput: liveDoctorResult.stdout,
        doctorStateDir: liveStateDir,
        pendingOutput: livePendingResult.stdout,
      })

      const hosts = await fetchJson(`${api.baseUrl}/api/v1/breakdown/hosts`)
      expect(hosts.items.map((item: { name: string }) => item.name)).toEqual(
        expect.arrayContaining(['claude-code', 'codex']),
      )

      const projects = await fetchJson(`${api.baseUrl}/api/v1/projects/top?limit=10`)
      expect(projects.items.length).toBeGreaterThan(0)
      expect(projects.items.map((item: { project_name: string }) => item.project_name)).toContain(
        path.basename(stableProjectRoot),
      )
      const stableNamedProjects = projects.items.filter((item: { project_name: string }) => (
        item.project_name === stableProjectName
      ))
      expect(stableNamedProjects).toHaveLength(2)
      expect(new Set(stableNamedProjects.map((item: { project_ref: string }) => item.project_ref)).size).toBe(2)

      checkpoint = 'recent session parity'
      const compactRecentSessions = await fetchJson(`${api.baseUrl}/api/v1/sessions/recent?limit=10&compact=true`)
      const fullRecentSessions = await fetchJson(`${api.baseUrl}/api/v1/sessions/recent?limit=10`)
      assertSessionListResponseParity(fullRecentSessions, compactRecentSessions)
      expect(compactRecentSessions.items.map((item: { session_id: string }) => item.session_id)).toEqual(
        expect.arrayContaining([claudeSessionId, codexSessionId, sharedSessionId]),
      )
      expect(fullRecentSessions.items.map((item: { session_id: string }) => item.session_id)).toEqual(
        expect.arrayContaining([claudeSessionId, codexSessionId, sharedSessionId]),
      )

      const claudeRecentSession = findSessionItemById(compactRecentSessions.items, claudeSessionId)
      const codexRecentSession = findSessionItemById(compactRecentSessions.items, codexSessionId)
      const sharedProjectSession = compactRecentSessions.items.find((item: SessionListItemLike) => (
        item.session_id === sharedSessionId
        && item.project_ref === claudeRecentSession?.project_ref
      ))
      const sharedSiblingSession = compactRecentSessions.items.find((item: SessionListItemLike) => (
        item.session_id === sharedSessionId
        && item.project_ref !== claudeRecentSession?.project_ref
      ))
      const claudeRecentSessionFull = findSessionItemById(fullRecentSessions.items, claudeSessionId)
      const codexRecentSessionFull = findSessionItemById(fullRecentSessions.items, codexSessionId)
      const sharedProjectSessionFull = fullRecentSessions.items.find((item: SessionListItemLike) => (
        item.session_id === sharedSessionId
        && item.project_ref === sharedProjectSession?.project_ref
      ))
      const sharedSiblingSessionFull = fullRecentSessions.items.find((item: SessionListItemLike) => (
        item.session_id === sharedSessionId
        && item.project_ref === sharedSiblingSession?.project_ref
      ))

      for (const item of [claudeRecentSession, codexRecentSession]) {
        expect(item).toEqual(expect.objectContaining({
          session_id: expect.any(String),
          project_name: expect.any(String),
          project_ref: expect.any(String),
          active_ms: expect.any(Number),
          changed_files_count: expect.any(Number),
          host_model_primary: expect.any(Object),
          host_model_mix_count: expect.any(Number),
        }))
        expect(item.host ?? item.last_host).toEqual(expect.any(String))
        expect(item.event_count ?? item.events).toEqual(expect.any(Number))
        expect(item.host_model_mix).toBeUndefined()
      }

      for (const [compactItem, fullItem] of [
        [claudeRecentSession, claudeRecentSessionFull],
        [codexRecentSession, codexRecentSessionFull],
      ]) {
        expect(normalizeSessionListItemForParity(fullItem)).toEqual(normalizeSessionListItemForParity(compactItem))
        expect(fullItem.host_model_mix).toEqual(expect.any(Array))
        expect(fullItem.host_model_primary).toEqual(fullItem.host_model_mix[0])
      }

      expect(claudeRecentSession?.host ?? claudeRecentSession?.last_host).toBe('claude-code')
      expect(codexRecentSession?.host ?? codexRecentSession?.last_host).toBe('codex')
      expect(claudeRecentSession?.project_ref).toBe(codexRecentSession?.project_ref)
      expect(sharedProjectSession?.project_name).toBe(stableProjectName)
      expect(sharedSiblingSession?.project_name).toBe(stableProjectName)
      expect(sharedProjectSession?.project_ref).not.toBe(sharedSiblingSession?.project_ref)

      const sharedProjectRef = claudeRecentSession?.project_ref
      expect(typeof sharedProjectRef).toBe('string')
      checkpoint = 'project detail parity'
      const projectDetail = await fetchJson(`${api.baseUrl}/api/v1/projects/${encodeURIComponent(sharedProjectRef!)}`)
      const projectSummary = projects.items.find((item: { project_ref: string }) => item.project_ref === sharedProjectRef)
      expect(projectSummary).toBeDefined()
      const compactSharedProjectSessions = await fetchJson(
        `${api.baseUrl}/api/v1/projects/${encodeURIComponent(sharedProjectRef!)}/sessions?limit=10&compact=true`,
      )
      const fullSharedProjectSessions = await fetchJson(
        `${api.baseUrl}/api/v1/projects/${encodeURIComponent(sharedProjectRef!)}/sessions?limit=10`,
      )
      assertSessionListResponseParity(fullSharedProjectSessions, compactSharedProjectSessions)
      const sharedProjectExpectedHostModels = fullSharedProjectSessions.items.map((item: SessionListItemLike) => ({
        host: String(item.host_model_primary?.host),
        model_name: String(item.host_model_primary?.model_name),
      }))
      assertProjectRollupConsistency(projectDetail, compactSharedProjectSessions, [
        claudeSessionId,
        codexSessionId,
        sharedSessionId,
      ], {
        expectedHostModels: sharedProjectExpectedHostModels,
      })
      assertProjectDetailConsistency({
        detail: projectDetail,
        projectSummary,
        projectSessions: fullSharedProjectSessions,
      })
      expect(projectDetail.last_host).toBe('codex')
      expect(projectDetail.last_model_name).toBe('gpt-5.4')
      expect(projectDetail.last_event_time).toBe('2026-04-12T08:05:05Z')

      const projectScopedExpectations = new Map<string, string[]>()
      const fullProjectSessionsByProjectRef = new Map<string, { items: SessionListItemLike[] }>()
      for (const [projectRef, sessionId] of [
        [claudeRecentSession?.project_ref, claudeSessionId],
        [codexRecentSession?.project_ref, codexSessionId],
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
        fullProjectSessionsByProjectRef.set(projectRef, fullProjectSessions)
        assertSessionListResponseParity(fullProjectSessions, compactProjectSessions)

        for (const sessionId of sessionIds) {
          const projectSessionCompact = findSessionItemById(compactProjectSessions.items, sessionId, projectRef)
          const projectSessionFull = findSessionItemById(fullProjectSessions.items, sessionId, projectRef)

          expect(projectSessionCompact).toBeDefined()
          expect(projectSessionFull).toBeDefined()
          expect(normalizeSessionListItemForParity(projectSessionFull)).toEqual(
            normalizeSessionListItemForParity(projectSessionCompact),
          )
          expect(projectSessionCompact.host_model_mix).toBeUndefined()
          expect(projectSessionFull.host_model_mix).toEqual(expect.any(Array))
          expect(projectSessionFull.host_model_primary).toEqual(projectSessionFull.host_model_mix[0])
        }
      }

      for (const [projectRef, sessionId, expectedHost] of [
        [claudeRecentSession?.project_ref, claudeSessionId, 'claude-code'],
        [codexRecentSession?.project_ref, codexSessionId, 'codex'],
      ]) {
        expect(typeof projectRef).toBe('string')

        const detail = await fetchJson(
          `${api.baseUrl}/api/v1/sessions/${encodeURIComponent(sessionId)}?project_ref=${encodeURIComponent(projectRef!)}`,
        )

        const recentSummary = findSessionItemById(fullRecentSessions.items, sessionId, projectRef!)
        const scopedProjectSessions = fullProjectSessionsByProjectRef.get(projectRef!)
        expect(recentSummary).toBeDefined()
        expect(scopedProjectSessions).toBeDefined()
        const matchedProjectSummary = findSessionItemById(scopedProjectSessions!.items, sessionId, projectRef!)
        expect(matchedProjectSummary).toBeDefined()

        assertSessionDetailConsistency({
          detail,
          expectedHost: expectedHost as string,
          expectedHostModels: [{
            host: String(matchedProjectSummary?.host_model_primary?.host),
            model_name: String(matchedProjectSummary?.host_model_primary?.model_name),
          }],
          projectSummary: matchedProjectSummary!,
          recentSummary: recentSummary!,
        })
      }

      checkpoint = 'unscoped ambiguous and 404 contracts'
      const ambiguousSharedSession = await fetchJsonResult(
        `${api.baseUrl}/api/v1/sessions/${encodeURIComponent(sharedSessionId)}`,
      )
      expect(ambiguousSharedSession.ok).toBe(false)
      expect(ambiguousSharedSession.status).toBe(409)
      expect(ambiguousSharedSession.body).toMatchObject({
        detail: {
          code: 'ambiguous_session',
          message: 'session_id matched multiple projects',
          hint: 'Retry with the matching project_ref from /api/v1/projects/top or /api/v1/sessions/recent.',
          details: {
            session_id: sharedSessionId,
            project_count: 2,
            matches: expect.arrayContaining([
              expect.objectContaining({
                project_ref: sharedProjectSession?.project_ref,
                project_name: stableProjectName,
                last_event_time: sharedProjectSession?.last_event_time,
              }),
              expect.objectContaining({
                project_ref: sharedSiblingSession?.project_ref,
                project_name: stableProjectName,
                last_event_time: sharedSiblingSession?.last_event_time,
              }),
            ]),
          },
        },
      })

      for (const [projectRef, expectedSession] of [
        [sharedProjectSession?.project_ref, sharedProjectSessionFull],
        [sharedSiblingSession?.project_ref, sharedSiblingSessionFull],
      ]) {
        expect(typeof projectRef).toBe('string')
        expect(expectedSession).toBeDefined()
        const scopedSharedSession = await fetchJson(
          `${api.baseUrl}/api/v1/sessions/${encodeURIComponent(sharedSessionId)}?project_ref=${encodeURIComponent(projectRef!)}`,
        )
        const scopedSharedProjectSessions = await fetchJson(
          `${api.baseUrl}/api/v1/projects/${encodeURIComponent(projectRef!)}/sessions?limit=10`,
        )
        const scopedSharedProjectSummary = findSessionItemById(
          scopedSharedProjectSessions.items,
          sharedSessionId,
          projectRef!,
        )

        expect(scopedSharedProjectSummary).toBeDefined()
        assertSessionDetailConsistency({
          detail: scopedSharedSession,
          expectedHost: String(expectedSession?.host ?? expectedSession?.last_host),
          expectedHostModels: [{
            host: String(scopedSharedProjectSummary?.host_model_primary?.host),
            model_name: String(scopedSharedProjectSummary?.host_model_primary?.model_name),
          }],
          projectSummary: scopedSharedProjectSummary!,
          recentSummary: expectedSession!,
        })
      }

      const missingProjectDetail = await fetchJsonResult(
        `${api.baseUrl}/api/v1/projects/${encodeURIComponent('project-does-not-exist')}`,
      )
      expect(missingProjectDetail.status).toBe(404)
      expect(missingProjectDetail.body).toEqual({
        detail: {
          code: 'project_not_found',
          message: 'project was not found',
          hint: 'Fetch a valid project_ref from /api/v1/projects/top or /api/v1/sessions/recent.',
        },
      })

      const missingProjectSessions = await fetchJsonResult(
        `${api.baseUrl}/api/v1/projects/${encodeURIComponent('project-does-not-exist')}/sessions?limit=10`,
      )
      expect(missingProjectSessions.status).toBe(404)
      expect(missingProjectSessions.body).toEqual(missingProjectDetail.body)

      const missingSessionDetail = await fetchJsonResult(
        `${api.baseUrl}/api/v1/sessions/${encodeURIComponent('session-does-not-exist')}`,
      )
      expect(missingSessionDetail.status).toBe(404)
      expect(missingSessionDetail.body).toEqual({
        detail: {
          code: 'session_not_found',
          message: 'session was not found',
          hint: 'Retry with a valid session_id, and include project_ref when the session spans multiple projects.',
        },
      })

      checkpoint = 'backlog scenarios and dashboard'
      for (const scenario of [
        {
          mode: 'processing_only',
          expectedBytes: { processing: 'processingBytes' as const },
          expectedCounts: { processing: 1, quarantine: 0, ready: 0 },
          expectedDoctorHints: ['processing-only backlog'],
          expectedEntries: [
            { state: 'processing' as const, file_name: 'processing-batch.json' },
          ],
          expectedQueueStatus: 'processing-only backlog',
          expectedState: 'partial',
        },
        {
          mode: 'quarantine_only',
          expectedBytes: { quarantine: 'quarantineBytes' as const },
          expectedCounts: { processing: 0, quarantine: 1, ready: 0 },
          expectedDoctorHints: ['quarantine-only backlog'],
          expectedEntries: [
            {
              state: 'quarantine' as const,
              file_name: 'quarantine-batch.json',
              reason: 'http_error',
              source_state: 'ready' as const,
            },
          ],
          expectedQueueStatus: 'quarantine-only backlog',
          expectedState: 'attention',
        },
        {
          mode: 'mixed',
          expectedBytes: {
            processing: 'processingBytes' as const,
            quarantine: 'quarantineBytes' as const,
            ready: 'readyBytes' as const,
          },
          expectedCounts: { processing: 1, quarantine: 1, ready: 1 },
          expectedDoctorHints: ['mixed backlog'],
          expectedEntries: [
            { state: 'ready' as const, file_name: 'ready-batch.json' },
            { state: 'processing' as const, file_name: 'processing-batch.json' },
            {
              state: 'quarantine' as const,
              file_name: 'quarantine-batch.json',
              reason: 'http_error',
              source_state: 'ready' as const,
            },
          ],
          expectedQueueStatus: 'mixed backlog',
          expectedState: 'attention',
          expectedQuarantineReasonCounts: { http_error: 1 },
        },
      ]) {
        await rm(path.join(liveStateDir, 'spool'), { force: true, recursive: true })
        const seededSpool = await seedSpoolState(liveStateDir, scenario.mode)
        const statusWithBacklog = await fetchJson(`${api.baseUrl}/api/v1/status`)

        expect(statusWithBacklog.spool.backlog_mode).toBe(scenario.mode)
        expect(statusWithBacklog.spool.ready).toBe(scenario.expectedCounts.ready)
        expect(statusWithBacklog.spool.processing).toBe(scenario.expectedCounts.processing)
        expect(statusWithBacklog.spool.quarantine).toBe(scenario.expectedCounts.quarantine)
        expect(statusWithBacklog.spool.ready_bytes).toBe(
          scenario.expectedBytes.ready ? seededSpool[scenario.expectedBytes.ready] : 0,
        )
        expect(statusWithBacklog.spool.processing_bytes).toBe(
          scenario.expectedBytes.processing ? seededSpool[scenario.expectedBytes.processing] : 0,
        )
        expect(statusWithBacklog.spool.quarantine_bytes).toBe(
          scenario.expectedBytes.quarantine ? seededSpool[scenario.expectedBytes.quarantine] : 0,
        )

        const backlogDoctorResult = await runCollectorCliProbe(
          liveStateDir,
          'doctor',
          `collector doctor ${scenario.mode} backlog probe`,
        )

        const backlogPendingResult = await runCollectorCliProbe(
          liveStateDir,
          'pending',
          `collector pending ${scenario.mode} backlog probe`,
        )

        assertQueueParityConsistency(statusWithBacklog.spool, {
          doctorOutput: backlogDoctorResult.stdout,
          doctorStateDir: liveStateDir,
          pendingOutput: backlogPendingResult.stdout,
          expectedDoctorHints: scenario.expectedDoctorHints,
          expectedEntries: scenario.expectedEntries,
          expectedQuarantineReasonCounts: scenario.expectedQuarantineReasonCounts,
        })

        const queueNodes = createDashboardNodes()
        const queueDoc = new FakeDocument(queueNodes)
        const queueWin = new FakeWindow('#/')
        const dashboardFetch = createDashboardFetch(api.baseUrl)
        const queueDashboardApp = createDashboardApp({
          doc: queueDoc,
          win: queueWin,
          fetchImpl: dashboardFetch,
          contractFetchImpl: dashboardFetch,
        })

        await queueDashboardApp.start()
        await waitFor(
          async () => queueNodes.projects.children.length > 0 && queueNodes.sessions.children.length > 0,
          `Dashboard never loaded the stable home route for ${scenario.mode}.`,
        )

        expect(queueNodes.sessions.children.some((row) => row.children[1]?.textContent?.includes('Primary Claude Code (stable)'))).toBe(true)
        expect(queueNodes.sessions.children.some((row) => row.children[1]?.textContent?.includes('Primary Codex (stable)'))).toBe(true)
        assertDashboardDetailRow(queueNodes, 'Queue status', (value) => {
          expect(value).toContain(scenario.expectedQueueStatus)
        })
        assertDashboardDetailRow(queueNodes, 'State', (value) => {
          expect(value.toLowerCase()).toContain(scenario.expectedState)
        })
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
        async () => nodes.projects.children.length > 0 && nodes.sessions.children.length > 0,
        'Dashboard never loaded the stable home route.',
      )

      expect(nodes.sessions.children.some((row) => row.children[1]?.textContent?.includes('Primary Claude Code (stable)'))).toBe(true)
      expect(nodes.sessions.children.some((row) => row.children[1]?.textContent?.includes('Primary Codex (stable)'))).toBe(true)
      assertDashboardDetailRow(nodes, 'State', (value) => {
        expect(value.toLowerCase()).toContain('attention')
      })

      win.location.hash = `#/projects/${encodeURIComponent(sharedProjectRef!)}`
      win.dispatch('hashchange')
      await waitFor(
        async () => nodes['detail-title'].textContent.includes(path.basename(stableProjectRoot)),
        'Dashboard never loaded the stable project route.',
      )
      expect(hasDetailPanelRow(nodes, 'Data completeness')).toBe(false)

      win.location.hash = `#/sessions/${encodeURIComponent(sharedProjectRef!)}/${encodeURIComponent(codexSessionId)}`
      win.dispatch('hashchange')
      await waitFor(
        async () => nodes['detail-title'].textContent.includes(codexSessionId),
        'Dashboard never loaded the stable session route.',
      )
      assertDashboardDetailRow(nodes, 'Primary host-model', (value) => {
        expect(value).toContain('Codex (stable) / gpt-5.4')
      })
      assertDashboardDetailRow(nodes, 'Last host', (value) => {
        expect(value).toContain('Codex (stable)')
      })
    } catch (error) {
      throw new Error([
        `checkpoint: ${checkpoint}`,
        '',
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

  it('covers operator dirty-state live status for file-backed state dirs, orphan sidecars, malformed sidecars, and multi-reason quarantine', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'clipulse-self-hosted-dirty-'))
    const dirtyStateDir = path.join(tempRoot, 'dirty-state')
    const dirtyDatabaseUrl = `sqlite+pysqlite:///${path.join(tempRoot, 'clipulse-dirty.sqlite3')}`
    const fileBackedStatePath = path.join(tempRoot, 'state-file')
    const fileBackedDatabaseUrl = `sqlite+pysqlite:///${path.join(tempRoot, 'clipulse-file.sqlite3')}`
    const api = await startApi(dirtyStateDir, dirtyDatabaseUrl)

    try {
      const dirtySeed = await seedDirtySpoolState(dirtyStateDir)
      const dirtyStatus = await fetchJson(`${api.baseUrl}/api/v1/status`)

      expect(dirtyStatus.spool.state_dir).toBe('<redacted>')
      expect(dirtyStatus.spool.state_dir_exists).toBe(true)
      expect(dirtyStatus.spool.state_dir_kind).toBe('directory')
      expect(dirtyStatus.spool.backlog_mode).toBe('quarantine_only')
      expect(dirtyStatus.spool.ready).toBe(0)
      expect(dirtyStatus.spool.processing).toBe(0)
      expect(dirtyStatus.spool.quarantine).toBe(2)
      expect(dirtyStatus.spool.orphan_sidecars).toEqual(dirtySeed.orphanSidecars)
      expect(dirtyStatus.spool.quarantine_reason_counts).toEqual(dirtySeed.quarantineReasonCounts)
      expect(dirtyStatus.spool.quarantine_meta_error_counts).toEqual(dirtySeed.quarantineMetaErrorCounts)

      const dirtyDoctorResult = await runCollectorCliProbe(
        dirtyStateDir,
        'doctor',
        'collector doctor dirty state probe',
      )
      const dirtyPendingResult = await runCollectorCliProbe(
        dirtyStateDir,
        'pending',
        'collector pending dirty state probe',
      )

      assertQueueParityConsistency(dirtyStatus.spool, {
        doctorOutput: dirtyDoctorResult.stdout,
        doctorStateDir: dirtyStateDir,
        pendingOutput: dirtyPendingResult.stdout,
        expectedBacklogMode: 'quarantine_only',
        expectedDoctorHints: [
          'quarantine-only backlog',
          'stale backlog retained in quarantine',
        ],
        expectedEntries: [
          {
            state: 'quarantine',
            file_name: 'quarantine-http.json',
            reason: 'http_error',
            source_state: 'ready',
          },
          {
            state: 'quarantine',
            file_name: 'quarantine-stale.json',
            reason: 'stale_backlog',
            source_state: 'processing',
          },
        ],
        expectedOrphanSidecars: dirtySeed.orphanSidecars,
        expectedQuarantineReasonCounts: dirtySeed.quarantineReasonCounts,
        expectedStateDirKind: 'directory',
      })

      expect(dirtyPendingResult.stdout).toContain('attempts=4')
      expect(dirtyPendingResult.stdout).toContain('attempts=5')
      expect(dirtyPendingResult.stdout).toContain('last_attempted_at=2026-04-07T09:05:00.000Z')
      expect(dirtyPendingResult.stdout).toContain('last_attempted_at=2026-04-06T11:02:00.000Z')
      expect(dirtyPendingResult.stdout).not.toContain('first_seen_at=broken')
      expect(dirtyPendingResult.stdout).not.toContain('quarantine-orphan.json')
      expect(dirtyPendingResult.stdout).not.toContain('quarantine-broken.json')

      await api.stop()

      await writeFile(fileBackedStatePath, 'blocked', 'utf8')
      const fileApi = await startApi(fileBackedStatePath, fileBackedDatabaseUrl)

      try {
        const fileStatus = await fetchJson(`${fileApi.baseUrl}/api/v1/status`)
        expect(fileStatus.spool).toEqual(expect.objectContaining({
          state_dir: '<redacted>',
          state_dir_exists: true,
          state_dir_kind: 'file',
          backlog_mode: 'missing_state_dir',
          ready: 0,
          processing: 0,
          quarantine: 0,
          orphan_sidecars: { ready: 0, processing: 0, quarantine: 0, total: 0 },
          quarantine_reason_counts: {},
          quarantine_meta_error_counts: { read_error: 0, parse_error: 0 },
        }))

        const fileDoctorResult = await runCollectorCliProbe(
          fileBackedStatePath,
          'doctor',
          'collector doctor file state probe',
        )
        const filePendingResult = await runCollectorCliProbe(
          fileBackedStatePath,
          'pending',
          'collector pending file state probe',
        )

        expect(fileDoctorResult.stdout).toContain(`state dir: ${fileBackedStatePath}`)
        expect(fileDoctorResult.stdout).not.toContain('no local state directory yet')
        expect(fileDoctorResult.stdout).toContain('local state path is a file')
        expect(filePendingResult.stdout).toContain('local state path is a file')
        expect(filePendingResult.stdout).toContain('pending backlog unavailable until local state directory is usable')
        expect(filePendingResult.stdout).not.toContain('no payload backlog entries')
        expect(filePendingResult.stdout).not.toContain('pending backlog unavailable without local state yet')
      } finally {
        await fileApi.stop()
      }
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
