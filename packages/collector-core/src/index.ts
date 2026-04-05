import fs from 'node:fs/promises'
import os from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'

export interface FileDelta {
  fingerprint: string
  language: string
  added: number
  removed: number
}

export interface LanguageSummary {
  added: number
  removed: number
  changed: number
}

export interface NormalizedActivityEvent {
  event_id?: string
  host: string
  host_version: string
  session_id: string
  project_root: string
  project_name: string
  git_branch: string
  event_name: string
  event_time: string
  model_name: string
  os_name: string
  editor_or_terminal: string
  active_ms: number
  wait_ms: number
  privacy_mode: string
  language_stats: Record<string, LanguageSummary>
  file_deltas: FileDelta[]
}

export interface EventBatch {
  events: NormalizedActivityEvent[]
}

export interface DeliveryOptions {
  fetchImpl?: typeof fetch
  stateDir?: string
  maxFlushBatches?: number
}

export interface DeliveryResult {
  delivered: boolean
  buffered: boolean
  flushed: number
}

export interface SessionActivityOptions {
  stateDir: string
  host: string
  sessionId: string
  eventName: string
  eventTime: string
}

export interface SessionActivityResult {
  activeMs: number
  waitMs: number
}

export interface ProjectSnapshotOptions {
  stateDir: string
  host: string
  sessionId: string
  projectRoot: string
}

export function mergeFileDeltas(deltas: FileDelta[]): FileDelta[] {
  const merged = new Map<string, FileDelta>()

  for (const delta of deltas) {
    const current = merged.get(delta.fingerprint)
    if (!current) {
      merged.set(delta.fingerprint, { ...delta })
      continue
    }

    current.added += delta.added
    current.removed += delta.removed
  }

  return [...merged.values()].sort((left, right) =>
    left.fingerprint.localeCompare(right.fingerprint),
  )
}

export function aggregateLanguages(
  deltas: FileDelta[],
): Record<string, LanguageSummary> {
  const summary: Record<string, LanguageSummary> = {}

  for (const delta of deltas) {
    const current = summary[delta.language] ?? { added: 0, removed: 0, changed: 0 }
    current.added += delta.added
    current.removed += delta.removed
    current.changed = current.added + current.removed
    summary[delta.language] = current
  }

  return summary
}

export function createFileFingerprint(
  filePath: string,
  projectRoot: string,
): string {
  const relativePath = path.relative(projectRoot, filePath) || path.basename(filePath)
  const normalizedPath = relativePath.split(path.sep).join('/')

  return createHash('sha256').update(normalizedPath).digest('hex')
}

export function guessLanguage(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase()

  if (extension === '.ts' || extension === '.tsx') {
    return 'TypeScript'
  }
  if (extension === '.js' || extension === '.jsx') {
    return 'JavaScript'
  }
  if (extension === '.py') {
    return 'Python'
  }
  if (extension === '.md') {
    return 'Markdown'
  }

  return 'Unknown'
}

export async function sendBatch(
  apiBaseUrl: string,
  batch: EventBatch,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const response = await fetchImpl(`${apiBaseUrl}/api/v1/events/batch`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(batch),
  })

  return response.ok
}

export async function deliverBatch(
  apiBaseUrl: string,
  batch: EventBatch,
  options: DeliveryOptions = {},
): Promise<DeliveryResult> {
  const fetchImpl = options.fetchImpl ?? fetch
  const maxFlushBatches = options.maxFlushBatches ?? 20
  const preparedBatch = attachEventIds(batch)
  const stateDir = options.stateDir ?? resolveStateDir()
  const spoolDirs = getSpoolDirectories(stateDir)

  await ensureSpoolDirectories(spoolDirs)

  const flushed = await flushReadyBatches(apiBaseUrl, spoolDirs, fetchImpl, maxFlushBatches)
  const delivered = await trySendBatch(apiBaseUrl, preparedBatch, fetchImpl)

  if (delivered) {
    return {
      delivered: true,
      buffered: false,
      flushed,
    }
  }

  await persistReadyBatch(preparedBatch, spoolDirs)

  return {
    delivered: false,
    buffered: true,
    flushed,
  }
}

export function attachEventIds(batch: EventBatch): EventBatch {
  return {
    events: batch.events.map((event) => ({
      ...event,
      event_id: event.event_id ?? createEventId(event),
    })),
  }
}

export function createEventId(event: NormalizedActivityEvent): string {
  const payload = stableStringify({
    ...event,
    event_id: undefined,
  })

  return createHash('sha256').update(payload).digest('hex')
}

export async function trackSessionActivity(
  options: SessionActivityOptions,
): Promise<SessionActivityResult> {
  const sessionStatePath = path.join(
    options.stateDir,
    'sessions',
    `${options.host}-${createHash('sha1').update(options.sessionId).digest('hex')}.json`,
  )
  const eventTime = Date.parse(options.eventTime)
  const previousState = await readJsonFile<{
    lastEventTime?: string
    pendingToolStartedAt?: string
  }>(sessionStatePath)
  let activeMs = 0
  let waitMs = 0

  if (
    previousState?.pendingToolStartedAt &&
    options.eventName === 'post_tool_use'
  ) {
    waitMs = Math.max(eventTime - Date.parse(previousState.pendingToolStartedAt), 0)
  } else if (previousState?.lastEventTime) {
    activeMs = Math.min(Math.max(eventTime - Date.parse(previousState.lastEventTime), 0), 15_000)
  }

  const nextState = {
    lastEventTime: options.eventTime,
    pendingToolStartedAt:
      options.eventName === 'pre_tool_use' ? options.eventTime : undefined,
  }

  await fs.mkdir(path.dirname(sessionStatePath), { recursive: true })
  await fs.writeFile(sessionStatePath, JSON.stringify(nextState), 'utf-8')

  return {
    activeMs,
    waitMs,
  }
}

export async function captureProjectSnapshotDeltas(
  options: ProjectSnapshotOptions,
): Promise<FileDelta[]> {
  const snapshotPath = path.join(
    options.stateDir,
    'snapshots',
    `${options.host}-${createHash('sha1').update(options.sessionId).digest('hex')}.json`,
  )
  const previousSnapshot = await readJsonFile<Record<string, string>>(snapshotPath) ?? {}
  const currentSnapshot = await collectProjectTextFiles(options.projectRoot)
  const changedFiles = new Set([
    ...Object.keys(previousSnapshot),
    ...Object.keys(currentSnapshot),
  ])
  const deltas: FileDelta[] = []

  for (const relativePath of [...changedFiles].sort()) {
    const previousContent = previousSnapshot[relativePath] ?? ''
    const currentContent = currentSnapshot[relativePath] ?? ''
    if (previousContent === currentContent) {
      continue
    }

    const counts = countLineChanges(previousContent, currentContent)
    deltas.push({
      fingerprint: createFileFingerprint(
        path.join(options.projectRoot, relativePath),
        options.projectRoot,
      ),
      language: guessLanguage(path.join(options.projectRoot, relativePath)),
      added: counts.added,
      removed: counts.removed,
    })
  }

  await fs.mkdir(path.dirname(snapshotPath), { recursive: true })
  await fs.writeFile(snapshotPath, JSON.stringify(currentSnapshot), 'utf-8')

  if (!Object.keys(previousSnapshot).length) {
    return []
  }

  return deltas.filter((delta) => delta.added > 0 || delta.removed > 0)
}

interface SpoolDirectories {
  root: string
  tmp: string
  ready: string
  processing: string
  quarantine: string
}

export function resolveStateDir(): string {
  const explicit = process.env.CLIPULSE_STATE_DIR
  if (explicit) {
    return explicit
  }

  const xdgStateHome = process.env.XDG_STATE_HOME
  if (xdgStateHome) {
    return path.join(xdgStateHome, 'clipulse')
  }

  return path.join(os.homedir(), '.local', 'state', 'clipulse')
}

function getSpoolDirectories(stateDir: string): SpoolDirectories {
  const root = path.join(stateDir, 'spool')

  return {
    root,
    tmp: path.join(root, 'tmp'),
    ready: path.join(root, 'ready'),
    processing: path.join(root, 'processing'),
    quarantine: path.join(root, 'quarantine'),
  }
}

async function ensureSpoolDirectories(spoolDirs: SpoolDirectories): Promise<void> {
  await Promise.all([
    fs.mkdir(spoolDirs.tmp, { recursive: true }),
    fs.mkdir(spoolDirs.ready, { recursive: true }),
    fs.mkdir(spoolDirs.processing, { recursive: true }),
    fs.mkdir(spoolDirs.quarantine, { recursive: true }),
  ])
}

async function flushReadyBatches(
  apiBaseUrl: string,
  spoolDirs: SpoolDirectories,
  fetchImpl: typeof fetch,
  maxFlushBatches: number,
): Promise<number> {
  const readyFiles = (await fs.readdir(spoolDirs.ready))
    .filter((fileName) => fileName.endsWith('.json'))
    .sort()
    .slice(0, maxFlushBatches)

  let flushed = 0

  for (const fileName of readyFiles) {
    const readyPath = path.join(spoolDirs.ready, fileName)
    const processingPath = path.join(spoolDirs.processing, fileName)

    try {
      await fs.rename(readyPath, processingPath)
    } catch {
      continue
    }

    try {
      const rawPayload = await fs.readFile(processingPath, 'utf-8')
      const payload = attachEventIds(JSON.parse(rawPayload) as EventBatch)
      const delivered = await trySendBatch(apiBaseUrl, payload, fetchImpl)

      if (!delivered) {
        await fs.rename(processingPath, readyPath)
        break
      }

      await fs.rm(processingPath, { force: true })
      flushed += 1
    } catch {
      await fs.rename(
        processingPath,
        path.join(spoolDirs.quarantine, fileName),
      )
    }
  }

  return flushed
}

async function persistReadyBatch(batch: EventBatch, spoolDirs: SpoolDirectories): Promise<void> {
  const fileName = `${Date.now()}-${process.pid}-${randomUUID()}.json`
  const tmpPath = path.join(spoolDirs.tmp, `${fileName}.tmp`)
  const readyPath = path.join(spoolDirs.ready, fileName)

  await fs.writeFile(tmpPath, JSON.stringify(batch), 'utf-8')
  await fs.rename(tmpPath, readyPath)
}

async function trySendBatch(
  apiBaseUrl: string,
  batch: EventBatch,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  try {
    return await sendBatch(apiBaseUrl, batch, fetchImpl)
  } catch {
    return false
  }
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const rawPayload = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(rawPayload) as T
  } catch {
    return null
  }
}

async function collectProjectTextFiles(projectRoot: string): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {}
  let entries
  try {
    entries = await fs.readdir(projectRoot, { withFileTypes: true })
  } catch {
    return snapshot
  }

  for (const entry of entries) {
    if (shouldIgnoreProjectEntry(entry.name)) {
      continue
    }

    const absolutePath = path.join(projectRoot, entry.name)
    if (entry.isDirectory()) {
      const nestedFiles = await collectProjectTextFiles(absolutePath)
      for (const [relativePath, content] of Object.entries(nestedFiles)) {
        snapshot[path.join(entry.name, relativePath)] = content
      }
      continue
    }

    const stat = await fs.stat(absolutePath)
    if (stat.size > 262_144) {
      continue
    }

    const buffer = await fs.readFile(absolutePath)
    if (buffer.includes(0)) {
      continue
    }

    snapshot[entry.name] = buffer.toString('utf-8')
  }

  return snapshot
}

function shouldIgnoreProjectEntry(name: string): boolean {
  return [
    '.git',
    '.clipulse-private',
    '.venv',
    '.worktrees',
    '__pycache__',
    'coverage',
    'dist',
    'node_modules',
  ].includes(name)
}

function countLineChanges(previousContent: string, currentContent: string): {
  added: number
  removed: number
} {
  const previousLines = previousContent ? previousContent.split('\n') : []
  const currentLines = currentContent ? currentContent.split('\n') : []
  let prefix = 0

  while (
    prefix < previousLines.length &&
    prefix < currentLines.length &&
    previousLines[prefix] === currentLines[prefix]
  ) {
    prefix += 1
  }

  let suffix = 0
  while (
    suffix + prefix < previousLines.length &&
    suffix + prefix < currentLines.length &&
    previousLines[previousLines.length - 1 - suffix] ===
      currentLines[currentLines.length - 1 - suffix]
  ) {
    suffix += 1
  }

  return {
    added: Math.max(currentLines.length - prefix - suffix, 0),
    removed: Math.max(previousLines.length - prefix - suffix, 0),
  }
}

function stableStringify(input: unknown): string {
  if (Array.isArray(input)) {
    return `[${input.map((item) => stableStringify(item)).join(',')}]`
  }

  if (input && typeof input === 'object') {
    const objectEntries = Object.entries(input as Record<string, unknown>)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))

    return `{${objectEntries
      .map(([key, value]) => `${JSON.stringify(key)}:${stableStringify(value)}`)
      .join(',')}}`
  }

  return JSON.stringify(input)
}
