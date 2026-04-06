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

export interface ProjectContext {
  projectRoot: string
  projectName: string
  gitBranch: string
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

interface BatchResultItem {
  event_id?: string
  status?: string
  retryable?: boolean
}

interface BatchResultPayload {
  results?: BatchResultItem[]
}

interface BatchSendResult {
  retryableBatch: EventBatch
  shouldQuarantine: boolean
}

export interface SessionActivityOptions {
  stateDir: string
  host: string
  sessionId: string
  projectRoot?: string
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
  candidatePaths?: string[]
  clearAfterCapture?: boolean
}

export interface PruneStateOptions {
  now?: Date
  retentionDays?: number
  maxFiles?: number
}

const MAX_ACTIVE_GAP_MS = 15_000
const MAX_TEXT_FILE_BYTES = 262_144
const MAX_TEXT_FILE_LINES = 5_000
const MAX_TEXT_LINE_LENGTH = 2_000
const DEFAULT_STATE_RETENTION_DAYS = 14
const DEFAULT_STATE_MAX_FILES = 200
const STOP_EVENT_NAMES = new Set(['stop', 'session_end', 'stop_failure'])
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  '.c': 'C',
  '.cpp': 'C++',
  '.cs': 'C#',
  '.go': 'Go',
  '.h': 'C',
  '.hpp': 'C++',
  '.java': 'Java',
  '.js': 'JavaScript',
  '.json': 'JSON',
  '.jsx': 'JavaScript',
  '.kt': 'Kotlin',
  '.md': 'Markdown',
  '.php': 'PHP',
  '.py': 'Python',
  '.rb': 'Ruby',
  '.rs': 'Rust',
  '.sh': 'Shell',
  '.sql': 'SQL',
  '.svelte': 'Svelte',
  '.swift': 'Swift',
  '.toml': 'TOML',
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.vue': 'Vue',
  '.yaml': 'YAML',
  '.yml': 'YAML',
  '.zsh': 'Shell',
}
const LANGUAGE_BY_BASENAME: Record<string, string> = {
  'dockerfile': 'Docker',
  'go.mod': 'Go',
  'go.sum': 'Go',
  'makefile': 'Makefile',
  'readme': 'Markdown',
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
  const baseName = path.basename(filePath).toLowerCase()
  const basenameLanguage = LANGUAGE_BY_BASENAME[baseName]
  if (basenameLanguage) {
    return basenameLanguage
  }

  const extension = path.extname(filePath).toLowerCase()
  const extensionLanguage = LANGUAGE_BY_EXTENSION[extension]
  if (extensionLanguage) {
    return extensionLanguage
  }

  return 'Unknown'
}

export async function resolveProjectContext(
  projectRoot: string,
): Promise<ProjectContext> {
  const scopedProjectRoot = await findProjectRoot(projectRoot) ?? projectRoot
  const gitPaths = await resolveGitPaths(scopedProjectRoot)
  const projectName = gitPaths.commonGitDir
    ? path.basename(path.dirname(gitPaths.commonGitDir))
    : path.basename(scopedProjectRoot)
  const gitBranch = gitPaths.gitDir
    ? await readGitBranch(gitPaths.gitDir)
    : 'unknown'

  return {
    projectRoot: scopedProjectRoot,
    projectName: projectName || path.basename(scopedProjectRoot) || 'unknown',
    gitBranch,
  }
}

export async function sendBatch(
  apiBaseUrl: string,
  batch: EventBatch,
  fetchImpl: typeof fetch = fetch,
): Promise<BatchSendResult> {
  const response = await fetchImpl(`${apiBaseUrl}/api/v1/events/batch`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(batch),
  })

  if (!response.ok) {
    return {
      retryableBatch: isRetryableStatus(response.status) ? batch : { events: [] },
      shouldQuarantine: !isRetryableStatus(response.status),
    }
  }

  if (typeof response.json !== 'function') {
    return {
      retryableBatch: { events: [] },
      shouldQuarantine: false,
    }
  }

  const payload = await readBatchResultPayload(response)
  if (payload === null) {
    return {
      retryableBatch: batch,
      shouldQuarantine: false,
    }
  }
  if (!payload.results) {
    return {
      retryableBatch: { events: [] },
      shouldQuarantine: false,
    }
  }

  const retryableEvents: NormalizedActivityEvent[] = []
  let shouldQuarantine = false

  for (const [index, event] of batch.events.entries()) {
    const result = payload.results[index]
    if (!result) {
      retryableEvents.push(event)
      continue
    }

    if (result.retryable) {
      retryableEvents.push(event)
      continue
    }

    if (result.status === 'invalid') {
      shouldQuarantine = true
    }
  }

  return {
    retryableBatch: {
      events: retryableEvents,
    },
    shouldQuarantine,
  }
}

export async function deliverBatch(
  apiBaseUrl: string,
  batch: EventBatch,
  options: DeliveryOptions = {},
): Promise<DeliveryResult> {
  const fetchImpl = options.fetchImpl ?? fetch
  const maxFlushBatches = options.maxFlushBatches ?? 20
  const preparedBatch = dedupePreparedBatch(attachEventIds(batch)).batch
  const stateDir = options.stateDir ?? resolveStateDir()
  const spoolDirs = getSpoolDirectories(stateDir)

  await ensureSpoolDirectories(spoolDirs)
  await pruneStateDirectory(stateDir)
  await recoverProcessingBatches(spoolDirs)

  const flushResult = await flushReadyBatches(apiBaseUrl, spoolDirs, fetchImpl, maxFlushBatches)
  const currentBatch = dedupePreparedBatch(preparedBatch, flushResult.seenEventIds).batch
  if (flushResult.backlogPending) {
    await persistReadyBatch(currentBatch, spoolDirs)

    return {
      delivered: false,
      buffered: true,
      flushed: flushResult.flushed,
    }
  }

  if (!currentBatch.events.length) {
    return {
      delivered: true,
      buffered: false,
      flushed: flushResult.flushed,
    }
  }

  const sendResult = await trySendBatch(apiBaseUrl, currentBatch, fetchImpl)

  if (!sendResult.retryableBatch.events.length) {
    return {
      delivered: true,
      buffered: false,
      flushed: flushResult.flushed,
    }
  }

  await persistReadyBatch(sendResult.retryableBatch, spoolDirs)

  return {
    delivered: false,
    buffered: true,
    flushed: flushResult.flushed,
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
  const sessionStatePath = getSessionStatePath(options)
  const eventTime = parseTimestamp(options.eventTime)
  const previousState = await readJsonFile<{
    lastEventTime?: string
    pendingToolStartedAt?: string
  }>(sessionStatePath)
  let activeMs = 0
  let waitMs = 0
  const lastEventTime = parseTimestamp(previousState?.lastEventTime)
  const pendingToolStartedAt = parseTimestamp(previousState?.pendingToolStartedAt)

  if (eventTime !== null) {
    if (
      pendingToolStartedAt !== null &&
      (isToolWaitCompletionEvent(options.eventName) || isStopEvent(options.eventName)) &&
      eventTime >= pendingToolStartedAt
    ) {
      waitMs = eventTime - pendingToolStartedAt
    } else if (lastEventTime !== null && eventTime >= lastEventTime) {
      activeMs = Math.min(eventTime - lastEventTime, MAX_ACTIVE_GAP_MS)
    }
  }

  if (isStopEvent(options.eventName)) {
    await fs.rm(sessionStatePath, { force: true })

    return {
      activeMs,
      waitMs,
    }
  }

  const nextState = buildNextSessionState(previousState, options.eventName, options.eventTime, eventTime)

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
  const snapshotPath = getSnapshotStatePath(options)
  const previousSnapshot = await readJsonFile<Record<string, string>>(snapshotPath) ?? {}
  const snapshotResult = await collectProjectTextFiles(
    options.projectRoot,
    options.candidatePaths,
  )
  if (!snapshotResult.readable) {
    return []
  }

  const currentSnapshot = options.candidatePaths?.length
    ? mergeSnapshotCandidates(previousSnapshot, snapshotResult)
    : snapshotResult.snapshot
  const changedFiles = new Set(
    options.candidatePaths?.length
      ? snapshotResult.visitedPaths
      : [...Object.keys(previousSnapshot), ...Object.keys(currentSnapshot)],
  )
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

  if (options.clearAfterCapture) {
    await fs.rm(snapshotPath, { force: true })
  } else {
    await fs.mkdir(path.dirname(snapshotPath), { recursive: true })
    await fs.writeFile(snapshotPath, JSON.stringify(currentSnapshot), 'utf-8')
  }

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

interface SnapshotCollectionResult {
  readable: boolean
  snapshot: Record<string, string>
  visitedPaths: string[]
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

export async function pruneStateDirectory(
  stateDir: string,
  options: PruneStateOptions = {},
): Promise<void> {
  const now = options.now ?? new Date()
  const retentionDays = options.retentionDays
    ?? parsePositiveInteger(process.env.CLIPULSE_STATE_RETENTION_DAYS)
    ?? DEFAULT_STATE_RETENTION_DAYS
  const maxFiles = options.maxFiles
    ?? parsePositiveInteger(process.env.CLIPULSE_STATE_MAX_FILES)
    ?? DEFAULT_STATE_MAX_FILES
  const thresholdMs = now.getTime() - retentionDays * 24 * 60 * 60 * 1000

  await pruneDirectoryByAge(path.join(stateDir, 'spool', 'tmp'), thresholdMs)
  await pruneDirectoryByAge(path.join(stateDir, 'spool', 'quarantine'), thresholdMs)
  await pruneDirectoryByAge(path.join(stateDir, 'sessions'), thresholdMs)
  await pruneDirectoryByAge(path.join(stateDir, 'snapshots'), thresholdMs)
  await capDirectoryFiles(path.join(stateDir, 'spool', 'quarantine'), maxFiles)
  await capDirectoryFiles(path.join(stateDir, 'sessions'), maxFiles)
  await capDirectoryFiles(path.join(stateDir, 'snapshots'), maxFiles)
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

async function recoverProcessingBatches(spoolDirs: SpoolDirectories): Promise<void> {
  const files = await safeReadDir(spoolDirs.processing)

  for (const fileName of files.filter((entry) => entry.endsWith('.json')).sort()) {
    const processingPath = path.join(spoolDirs.processing, fileName)
    const readyPath = path.join(spoolDirs.ready, fileName)

    try {
      await fs.rename(processingPath, readyPath)
    } catch {
      await fs.rm(processingPath, { force: true })
    }
  }
}

async function flushReadyBatches(
  apiBaseUrl: string,
  spoolDirs: SpoolDirectories,
  fetchImpl: typeof fetch,
  maxFlushBatches: number,
): Promise<{ flushed: number, backlogPending: boolean, seenEventIds: Set<string> }> {
  const readyFiles = (await fs.readdir(spoolDirs.ready))
    .filter((fileName) => fileName.endsWith('.json'))
    .sort()
    .slice(0, maxFlushBatches)

  let flushed = 0
  let blocked = false
  const seenEventIds = new Set<string>()

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
      const payload = dedupePreparedBatch(
        attachEventIds(JSON.parse(rawPayload) as EventBatch),
        seenEventIds,
      )
      if (!payload.batch.events.length) {
        await fs.rm(processingPath, { force: true })
        continue
      }
      if (payload.removed > 0) {
        await fs.writeFile(processingPath, JSON.stringify(payload.batch), 'utf-8')
      }
      const sendResult = await trySendBatch(apiBaseUrl, payload.batch, fetchImpl)
      const retryableCount = sendResult.retryableBatch.events.length

      if (retryableCount >= payload.batch.events.length && retryableCount > 0) {
        await fs.rename(processingPath, readyPath)
        blocked = true
        break
      }

      if (retryableCount > 0) {
        if (sendResult.shouldQuarantine) {
          await fs.rename(
            processingPath,
            path.join(spoolDirs.quarantine, fileName),
          )
        } else {
          await fs.rm(processingPath, { force: true })
        }
        await fs.writeFile(readyPath, JSON.stringify(sendResult.retryableBatch), 'utf-8')
        blocked = true
        break
      }

      if (sendResult.shouldQuarantine) {
        await fs.rename(
          processingPath,
          path.join(spoolDirs.quarantine, fileName),
        )
        continue
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

  const readyCount = (await safeReadDir(spoolDirs.ready))
    .filter((fileName) => fileName.endsWith('.json'))
    .length

  return {
    flushed,
    backlogPending: blocked || readyCount > 0,
    seenEventIds,
  }
}

async function persistReadyBatch(batch: EventBatch, spoolDirs: SpoolDirectories): Promise<void> {
  const fileName = `${Date.now()}-${process.pid}-${randomUUID()}.json`
  const tmpPath = path.join(spoolDirs.tmp, `${fileName}.tmp`)
  const readyPath = path.join(spoolDirs.ready, fileName)
  const dedupedBatch = dedupePreparedBatch(attachEventIds(batch)).batch

  if (!dedupedBatch.events.length) {
    return
  }

  await fs.writeFile(tmpPath, JSON.stringify(dedupedBatch), 'utf-8')
  await fs.rename(tmpPath, readyPath)
}

async function trySendBatch(
  apiBaseUrl: string,
  batch: EventBatch,
  fetchImpl: typeof fetch,
): Promise<BatchSendResult> {
  try {
    return await sendBatch(apiBaseUrl, batch, fetchImpl)
  } catch {
    return {
      retryableBatch: batch,
      shouldQuarantine: false,
    }
  }
}

async function readBatchResultPayload(response: Response): Promise<BatchResultPayload | null> {
  try {
    return await response.json() as BatchResultPayload
  } catch {
    return null
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const rawPayload = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(rawPayload) as T
  } catch {
    return null
  }
}

function dedupePreparedBatch(
  batch: EventBatch,
  seenEventIds = new Set<string>(),
): { batch: EventBatch, removed: number } {
  const dedupedEvents: NormalizedActivityEvent[] = []
  let removed = 0

  for (const event of batch.events) {
    const eventId = event.event_id ?? createEventId(event)
    if (seenEventIds.has(eventId)) {
      removed += 1
      continue
    }

    seenEventIds.add(eventId)
    dedupedEvents.push({
      ...event,
      event_id: eventId,
    })
  }

  return {
    batch: {
      events: dedupedEvents,
    },
    removed,
  }
}

async function collectProjectTextFiles(
  projectRoot: string,
  candidatePaths?: string[],
): Promise<SnapshotCollectionResult> {
  if (candidatePaths?.length) {
    return collectCandidateProjectFiles(projectRoot, candidatePaths)
  }

  const snapshot: Record<string, string> = {}
  const visitedPaths: string[] = []
  let entries
  try {
    entries = await fs.readdir(projectRoot, { withFileTypes: true })
  } catch {
    return {
      readable: false,
      snapshot,
      visitedPaths,
    }
  }

  for (const entry of entries) {
    if (shouldIgnoreProjectEntry(entry.name)) {
      continue
    }

    const absolutePath = path.join(projectRoot, entry.name)
    if (entry.isDirectory()) {
      const nested = await collectProjectTextFiles(absolutePath)
      if (!nested.readable) {
        continue
      }
      for (const [relativePath, content] of Object.entries(nested.snapshot)) {
        const joinedPath = path.join(entry.name, relativePath)
        snapshot[joinedPath] = content
        visitedPaths.push(joinedPath)
      }
      continue
    }

    const content = await readProjectTextFile(absolutePath)
    if (content === null) {
      continue
    }

    snapshot[entry.name] = content
    visitedPaths.push(entry.name)
  }

  return {
    readable: true,
    snapshot,
    visitedPaths,
  }
}

function shouldIgnoreProjectEntry(name: string): boolean {
  return [
    '.git',
    '.clipulse-private',
    '.mypy_cache',
    '.next',
    '.pytest_cache',
    '.ruff_cache',
    '.venv',
    '.worktrees',
    '__pycache__',
    'build',
    'coverage',
    'dist',
    'node_modules',
  ].includes(name)
}

function countLineChanges(previousContent: string, currentContent: string): {
  added: number
  removed: number
} {
  const previousLines = splitContentLines(previousContent)
  const currentLines = splitContentLines(currentContent)
  const lcsLength = longestCommonSubsequenceLength(previousLines, currentLines)

  return {
    added: Math.max(currentLines.length - lcsLength, 0),
    removed: Math.max(previousLines.length - lcsLength, 0),
  }
}

function splitContentLines(content: string): string[] {
  if (!content) {
    return []
  }

  const lines = content.split('\n')
  if (lines.at(-1) === '') {
    lines.pop()
  }

  return lines
}

function longestCommonSubsequenceLength(left: string[], right: string[]): number {
  if (!left.length || !right.length) {
    return 0
  }

  let previous = new Array<number>(right.length + 1).fill(0)
  let current = new Array<number>(right.length + 1).fill(0)

  for (const leftLine of left) {
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = leftLine === right[column - 1]
        ? previous[column - 1]! + 1
        : Math.max(previous[column]!, current[column - 1]!)
    }

    ;[previous, current] = [current, previous]
    current.fill(0)
  }

  return previous[right.length] ?? 0
}

function getSessionStatePath(options: SessionActivityOptions): string {
  return path.join(
    options.stateDir,
    'sessions',
    createScopedStateFileName(options.host, options.sessionId, options.projectRoot),
  )
}

function getSnapshotStatePath(options: ProjectSnapshotOptions): string {
  return path.join(
    options.stateDir,
    'snapshots',
    createScopedStateFileName(options.host, options.sessionId, options.projectRoot),
  )
}

function createScopedStateFileName(
  host: string,
  sessionId: string,
  projectRoot = '',
): string {
  const stateKey = [host, sessionId, projectRoot].join(':')
  return `${host}-${createHash('sha1').update(stateKey).digest('hex')}.json`
}

function isStopEvent(eventName: string): boolean {
  return STOP_EVENT_NAMES.has(eventName)
}

function isToolWaitCompletionEvent(eventName: string): boolean {
  return eventName === 'post_tool_use' || eventName === 'post_tool_use_failure'
}

function parseTimestamp(input?: string): number | null {
  if (!input) {
    return null
  }

  const parsed = Date.parse(input)
  return Number.isFinite(parsed) ? parsed : null
}

function buildNextSessionState(
  previousState: {
    lastEventTime?: string
    pendingToolStartedAt?: string
  } | null,
  eventName: string,
  eventTime: string,
  parsedEventTime: number | null,
): {
  lastEventTime?: string
  pendingToolStartedAt?: string
} {
  const previousLastTime = parseTimestamp(previousState?.lastEventTime)
  const keepPreviousTime = (
    parsedEventTime === null ||
    (previousLastTime !== null && parsedEventTime < previousLastTime)
  )

  return {
    lastEventTime: keepPreviousTime ? previousState?.lastEventTime : eventTime,
    pendingToolStartedAt: eventName === 'pre_tool_use' && parsedEventTime !== null
      ? eventTime
      : undefined,
  }
}

function mergeSnapshotCandidates(
  previousSnapshot: Record<string, string>,
  snapshotResult: SnapshotCollectionResult,
): Record<string, string> {
  const nextSnapshot = { ...previousSnapshot }

  for (const relativePath of snapshotResult.visitedPaths) {
    const content = snapshotResult.snapshot[relativePath]
    if (content === undefined) {
      delete nextSnapshot[relativePath]
      continue
    }

    nextSnapshot[relativePath] = content
  }

  return nextSnapshot
}

async function collectCandidateProjectFiles(
  projectRoot: string,
  candidatePaths: string[],
): Promise<SnapshotCollectionResult> {
  const snapshot: Record<string, string> = {}
  const visitedPaths = new Set<string>()
  const normalizedCandidates = [...new Set(candidatePaths.map(normalizeRelativePath))]
    .filter((candidate) => candidate.length > 0)
    .filter((candidate) => !shouldIgnoreRelativePath(candidate))

  for (const relativePath of normalizedCandidates) {
    const absolutePath = path.join(projectRoot, relativePath)
    const stat = await readPathStat(absolutePath)

    if (stat?.isDirectory()) {
      const nested = await collectProjectTextFiles(absolutePath)
      if (nested.readable) {
        for (const [nestedPath, content] of Object.entries(nested.snapshot)) {
          const joinedPath = normalizeRelativePath(path.join(relativePath, nestedPath))
          snapshot[joinedPath] = content
          visitedPaths.add(joinedPath)
        }
      }
      continue
    }

    visitedPaths.add(relativePath)
    const content = await readProjectTextFile(absolutePath)
    if (content !== null) {
      snapshot[relativePath] = content
    }
  }

  return {
    readable: true,
    snapshot,
    visitedPaths: [...visitedPaths],
  }
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join('/').replace(/^\.\/+/, '')
}

function shouldIgnoreRelativePath(relativePath: string): boolean {
  return normalizeRelativePath(relativePath)
    .split('/')
    .some((segment) => shouldIgnoreProjectEntry(segment))
}

async function readProjectTextFile(filePath: string): Promise<string | null> {
  try {
    const stat = await fs.stat(filePath)
    if (!stat.isFile() || stat.size > MAX_TEXT_FILE_BYTES) {
      return null
    }

    const buffer = await fs.readFile(filePath)
    if (buffer.includes(0)) {
      return null
    }

    const content = buffer.toString('utf-8')
    const lines = content.split('\n')
    if (lines.length > MAX_TEXT_FILE_LINES) {
      return null
    }
    if (lines.some((line) => line.length > MAX_TEXT_LINE_LENGTH)) {
      return null
    }

    return content
  } catch {
    return null
  }
}

async function readPathStat(filePath: string): Promise<Awaited<ReturnType<typeof fs.stat>> | null> {
  try {
    return await fs.stat(filePath)
  } catch {
    return null
  }
}

async function pruneDirectoryByAge(directoryPath: string, thresholdMs: number): Promise<void> {
  for (const fileName of await safeReadDir(directoryPath)) {
    const filePath = path.join(directoryPath, fileName)
    try {
      const stat = await fs.stat(filePath)
      if (stat.mtimeMs < thresholdMs) {
        await fs.rm(filePath, { recursive: true, force: true })
      }
    } catch {
      continue
    }
  }
}

async function capDirectoryFiles(directoryPath: string, maxFiles: number): Promise<void> {
  const fileStats = await Promise.all(
    (await safeReadDir(directoryPath)).map(async (fileName) => {
      const filePath = path.join(directoryPath, fileName)
      try {
        const stat = await fs.stat(filePath)
        return {
          fileName,
          mtimeMs: stat.mtimeMs,
        }
      } catch {
        return null
      }
    }),
  )

  const staleFiles = fileStats
    .filter((entry): entry is { fileName: string, mtimeMs: number } => entry !== null)
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(maxFiles)

  await Promise.all(staleFiles.map(async (entry) => {
    await fs.rm(path.join(directoryPath, entry.fileName), { force: true, recursive: true })
  }))
}

async function safeReadDir(directoryPath: string): Promise<string[]> {
  try {
    return await fs.readdir(directoryPath)
  } catch {
    return []
  }
}

async function resolveGitPaths(
  projectRoot: string,
): Promise<{ gitDir: string | null, commonGitDir: string | null }> {
  const gitEntryPath = path.join(projectRoot, '.git')
  const gitStat = await readPathStat(gitEntryPath)
  if (!gitStat) {
    return {
      gitDir: null,
      commonGitDir: null,
    }
  }

  if (gitStat.isDirectory()) {
    return {
      gitDir: gitEntryPath,
      commonGitDir: gitEntryPath,
    }
  }

  const gitPointer = await safeReadTextFile(gitEntryPath)
  const gitDirMatch = gitPointer?.match(/^gitdir:\s*(.+)\s*$/m)
  if (!gitDirMatch?.[1]) {
    return {
      gitDir: null,
      commonGitDir: null,
    }
  }

  const gitDir = path.resolve(projectRoot, gitDirMatch[1])
  const commonDirPointer = await safeReadTextFile(path.join(gitDir, 'commondir'))
  const commonGitDir = commonDirPointer
    ? path.resolve(gitDir, commonDirPointer.trim())
    : null

  return {
    gitDir,
    commonGitDir,
  }
}

async function findProjectRoot(startPath: string): Promise<string | null> {
  let currentPath = path.resolve(startPath)
  const initialStat = await readPathStat(currentPath)
  if (initialStat?.isFile()) {
    currentPath = path.dirname(currentPath)
  }

  while (true) {
    const gitEntry = await readPathStat(path.join(currentPath, '.git'))
    if (gitEntry) {
      return currentPath
    }

    const parentPath = path.dirname(currentPath)
    if (parentPath === currentPath) {
      return null
    }

    currentPath = parentPath
  }
}

async function readGitBranch(gitDir: string): Promise<string> {
  const head = await safeReadTextFile(path.join(gitDir, 'HEAD'))
  if (!head) {
    return 'unknown'
  }

  const refMatch = head.match(/^ref:\s*(.+)\s*$/m)
  if (!refMatch?.[1]) {
    return 'unknown'
  }

  const ref = refMatch[1].trim()
  if (ref.startsWith('refs/heads/')) {
    return ref.slice('refs/heads/'.length)
  }

  return path.basename(ref) || 'unknown'
}

async function safeReadTextFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf-8')
  } catch {
    return null
  }
}

function parsePositiveInteger(rawValue?: string): number | null {
  if (!rawValue) {
    return null
  }

  const value = Number.parseInt(rawValue, 10)
  if (!Number.isFinite(value) || value <= 0) {
    return null
  }

  return value
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
