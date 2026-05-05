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
  workspaceRoot: string
  projectName: string
  gitBranch: string
}

export interface DeliveryOptions {
  fetchImpl?: typeof fetch
  stateDir?: string
  maxFlushBatches?: number
  apiBearerToken?: string
}

export interface DeliveryResult {
  delivered: boolean
  buffered: boolean
  flushed: number
}

export interface PreparedAdapterEvent {
  event: NormalizedActivityEvent | null
  commit: () => Promise<void>
}

export interface PreparedAdapterEventHandoffOptions {
  apiBaseUrl?: string | null
  apiBearerToken?: string
  deliverBatch?: typeof deliverBatch
  stateDir: string
  writeStdout?: (chunk: string) => void
}

interface BatchResultItem {
  event_id?: string
  status?: string
  retryable?: boolean
}

interface BatchResultPayload {
  results?: BatchResultItem[]
}

interface QuarantineMetadata {
  reason: string
  status: number | null
  event_count: number
  first_seen_at: string
  last_attempted_at: string
  source_state?: string
  attempt_count?: number
  approx_bytes?: number
}

interface SpoolBatchMetadata {
  first_seen_at: string
  last_attempted_at?: string
  attempt_count?: number
}

interface BatchSendResult {
  retryableBatch: EventBatch
  quarantineBatch: EventBatch
  quarantineMetadata: QuarantineMetadata | null
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

export interface SessionActivityTransition extends SessionActivityResult {
  statePath: string
  nextState: {
    lastEventTime?: string
    pendingToolStartedAt?: string
  } | null
}

export interface ProjectSnapshotOptions {
  stateDir: string
  host: string
  sessionId: string
  projectRoot: string
  candidatePaths?: string[]
  clearAfterCapture?: boolean
}

export interface ProjectSnapshotTransition {
  deltas: FileDelta[]
  nextSnapshot: ProjectSnapshotState | null
  statePath: string
}

export interface PruneStateOptions {
  now?: Date
  retentionDays?: number
  maxFiles?: number
  maxSpoolBytes?: number
}

export interface LocalOperatorStateEntry {
  state: 'ready' | 'processing' | 'quarantine'
  fileName: string
  eventCount: number
  approxBytes: number
  firstSeenAt: string | null
  lastAttemptedAt: string | null
  attemptCount: number | null
  reason: string | null
  sourceState: string | null
}

export interface LocalOperatorStateSummary {
  stateDir: string
  stateDirExists: boolean
  stateDirKind: 'directory' | 'file' | 'missing'
  payloadCounts: Record<'ready' | 'processing' | 'quarantine', number>
  orphanMetadataCounts: Record<'ready' | 'processing' | 'quarantine', number>
  payloadBytes: Record<'ready' | 'processing' | 'quarantine', number>
  oldestAgeSeconds: Record<'ready' | 'processing' | 'quarantine', number>
  reasonCounts: Record<string, number>
  metadataErrorCounts: Record<'ready' | 'processing' | 'quarantine', {
    readError: number
    parseError: number
  }>
  quarantineMetadataErrorCounts: {
    readError: number
    parseError: number
  }
  entries: LocalOperatorStateEntry[]
}

const MAX_ACTIVE_GAP_MS = 15_000
const MAX_TEXT_FILE_BYTES = 262_144
const MAX_TEXT_FILE_LINES = 5_000
const MAX_TEXT_LINE_LENGTH = 2_000
const DEFAULT_STATE_RETENTION_DAYS = 14
const DEFAULT_STATE_MAX_FILES = 200
const DEFAULT_STATE_MAX_SPOOL_BYTES = 64 * 1024 * 1024
const SNAPSHOT_STATE_VERSION = 3
const PROJECT_SCOPE_KEY_LENGTH = 12
const PROJECT_SCOPE_KEY_PATTERN = /^[0-9a-f]{12}$/
const STOP_EVENT_NAMES = new Set(['stop', 'session_end', 'stop_failure'])
const LOCAL_OPERATOR_STATE_ORDER: Record<LocalOperatorStateEntry['state'], number> = {
  ready: 0,
  processing: 1,
  quarantine: 2,
}
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

export function normalizeSessionId(sessionId: string): string {
  const normalizedSessionId = sessionId.trim()
  if (normalizedSessionId.length === 0) {
    throw new Error('session_id must be a non-empty string.')
  }

  return normalizedSessionId
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
  const currentPath = await resolveProjectLookupPath(projectRoot)
  const markerRoot = await findClipulseProjectRoot(currentPath)
  const gitProjectRoot = await findProjectRoot(currentPath)
  const scopedWorkspaceRoot = await resolveWorkspaceRoot(markerRoot, gitProjectRoot, currentPath)
  const gitPaths = gitProjectRoot
    ? await resolveGitPaths(gitProjectRoot)
    : { gitDir: null, commonGitDir: null }
  const stableGitProjectRoot = gitProjectRoot
    ? await resolveStableProjectRoot(gitProjectRoot, gitPaths)
    : await resolveRealPath(scopedWorkspaceRoot)
  const detectedProjectName = markerRoot
    ? path.basename(markerRoot)
    : gitPaths.commonGitDir
    ? path.basename(path.dirname(gitPaths.commonGitDir))
    : path.basename(scopedWorkspaceRoot)
  const detectedGitBranch = gitPaths.gitDir
    ? await readGitBranch(gitPaths.gitDir)
    : 'unknown'
  const projectOverride = await readClipulseProjectOverride(markerRoot ?? scopedWorkspaceRoot)
  const projectName = projectOverride.projectName ?? detectedProjectName
  const gitBranch = projectOverride.gitBranch ?? detectedGitBranch
  const workspaceRoot = path.resolve(scopedWorkspaceRoot)
  const stableProjectRoot = projectOverride.scope === 'workspace'
    ? await resolveRealPath(workspaceRoot)
    : stableGitProjectRoot

  return {
    projectRoot: stableProjectRoot,
    workspaceRoot,
    projectName: projectName || path.basename(workspaceRoot) || 'unknown',
    gitBranch,
  }
}

export function prepareOutboundBatch(batch: EventBatch): EventBatch {
  return attachEventIds(sanitizeBatchProjectScopes(batch))
}

export async function shouldSkipUnmarkedProject(
  projectContext: Pick<ProjectContext, 'workspaceRoot'>,
  env: NodeJS.ProcessEnv,
): Promise<boolean> {
  if (!isRequireProjectFileEnabled(env.CLIPULSE_REQUIRE_PROJECT_FILE)) {
    return false
  }

  return !(await hasClipulseProjectFile(projectContext.workspaceRoot))
}

export async function handoffPreparedEvent(
  prepared: PreparedAdapterEvent,
  options: PreparedAdapterEventHandoffOptions,
): Promise<void> {
  if (!prepared.event) {
    await prepared.commit()
    return
  }

  const batch = { events: [prepared.event] }
  const writeStdout = options.writeStdout ?? process.stdout.write.bind(process.stdout)

  if (options.apiBaseUrl) {
    const deliverBatchFn = options.deliverBatch ?? deliverBatch
    await deliverBatchFn(options.apiBaseUrl, batch, {
      apiBearerToken: options.apiBearerToken,
      stateDir: options.stateDir,
    })
    await prepared.commit()
    return
  }

  writeStdout(`${JSON.stringify(prepareOutboundBatch(batch))}\n`)
  await prepared.commit()
}

export async function sendBatch(
  apiBaseUrl: string,
  batch: EventBatch,
  fetchImpl: typeof fetch = fetch,
  apiBearerToken?: string,
): Promise<BatchSendResult> {
  const preparedBatch = prepareOutboundBatch(batch)
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  }

  if (apiBearerToken) {
    headers.Authorization = `Bearer ${apiBearerToken}`
  }

  const response = await fetchImpl(`${apiBaseUrl}/api/v1/events/batch`, {
    method: 'POST',
    headers,
    body: JSON.stringify(preparedBatch),
  })

  if (!response.ok) {
    return {
      retryableBatch: isRetryableStatus(response.status) ? preparedBatch : { events: [] },
      quarantineBatch: isRetryableStatus(response.status) ? { events: [] } : preparedBatch,
      quarantineMetadata: !isRetryableStatus(response.status)
        ? buildQuarantineMetadata(preparedBatch.events.length, 'http_error', response.status)
        : null,
    }
  }

  if (typeof response.json !== 'function') {
    return {
      retryableBatch: { events: [] },
      quarantineBatch: { events: [] },
      quarantineMetadata: null,
    }
  }

  const payload = await readBatchResultPayload(response)
  if (payload === null) {
    return {
      retryableBatch: preparedBatch,
      quarantineBatch: { events: [] },
      quarantineMetadata: null,
    }
  }
  if (!payload.results) {
    return {
      retryableBatch: { events: [] },
      quarantineBatch: { events: [] },
      quarantineMetadata: null,
    }
  }

  const retryableEvents: NormalizedActivityEvent[] = []
  const quarantineEvents: NormalizedActivityEvent[] = []
  const resultsByEventId = new Map<string, BatchResultItem>()
  let hasEventIdResults = false

  for (const result of payload.results) {
    if (!result.event_id) {
      continue
    }

    hasEventIdResults = true
    resultsByEventId.set(result.event_id, result)
  }

  for (const [index, event] of preparedBatch.events.entries()) {
    const result = hasEventIdResults
      ? resultsByEventId.get(event.event_id ?? '')
      : payload.results.length === batch.events.length
        ? payload.results[index]
        : undefined
    if (!result) {
      retryableEvents.push(event)
      continue
    }

    if (shouldRetryResult(result)) {
      retryableEvents.push(event)
      continue
    }

    if (shouldQuarantineResult(result)) {
      quarantineEvents.push(event)
      continue
    }

    if (!isSuccessfulResult(result)) {
      retryableEvents.push(event)
    }
  }

  return {
    retryableBatch: {
      events: retryableEvents,
    },
    quarantineBatch: {
      events: quarantineEvents,
    },
    quarantineMetadata: quarantineEvents.length > 0
      ? buildQuarantineMetadata(quarantineEvents.length, 'invalid_results', response.status)
      : null,
  }
}

export async function deliverBatch(
  apiBaseUrl: string,
  batch: EventBatch,
  options: DeliveryOptions = {},
): Promise<DeliveryResult> {
  const fetchImpl = options.fetchImpl ?? fetch
  const maxFlushBatches = options.maxFlushBatches ?? 20
  const apiBearerToken = options.apiBearerToken ?? process.env.CLIPULSE_API_BEARER_TOKEN
  const preparedBatch = dedupePreparedBatch(prepareOutboundBatch(batch)).batch
  const stateDir = options.stateDir ?? resolveStateDir()
  const spoolDirs = getSpoolDirectories(stateDir)

  await ensureSpoolDirectories(spoolDirs)
  await pruneStateDirectory(stateDir)
  await recoverProcessingBatches(spoolDirs)

  const flushResult = await flushReadyBatches(
    apiBaseUrl,
    spoolDirs,
    fetchImpl,
    maxFlushBatches,
    apiBearerToken,
  )
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

  const sendResult = await trySendBatch(apiBaseUrl, currentBatch, fetchImpl, apiBearerToken)
  const currentAttemptMetadata = buildSpoolBatchMetadata(null, null, {
    markAttempted: true,
  })

  if (sendResult.quarantineBatch.events.length > 0) {
    await persistQuarantineBatch(
      sendResult.quarantineBatch,
      spoolDirs,
      buildQuarantineMetadataFromSpool(
        currentAttemptMetadata,
        sendResult.quarantineBatch.events.length,
        sendResult.quarantineMetadata?.reason ?? 'invalid_results',
        sendResult.quarantineMetadata?.status ?? null,
        {
          approxBytes: Buffer.byteLength(JSON.stringify(sendResult.quarantineBatch), 'utf-8'),
        },
      ),
    )
  }

  if (!sendResult.retryableBatch.events.length) {
    return {
      delivered: sendResult.quarantineBatch.events.length === 0,
      buffered: false,
      flushed: flushResult.flushed,
    }
  }

  await persistReadyBatchWithMetadata(sendResult.retryableBatch, spoolDirs, currentAttemptMetadata)

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
      event_id: createEventId(event),
    })),
  }
}

export function createEventId(event: NormalizedActivityEvent): string {
  const payload = stableStringify({
    ...normalizeEventForEventId(event),
    event_id: undefined,
  })

  return createHash('sha256').update(payload).digest('hex')
}

export async function trackSessionActivity(
  options: SessionActivityOptions,
): Promise<SessionActivityResult> {
  const transition = await planSessionActivity(options)
  await applySessionActivityTransition(transition)

  return {
    activeMs: transition.activeMs,
    waitMs: transition.waitMs,
  }
}

export async function planSessionActivity(
  options: SessionActivityOptions,
): Promise<SessionActivityTransition> {
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

  return {
    activeMs,
    waitMs,
    statePath: sessionStatePath,
    nextState: isStopEvent(options.eventName)
      ? null
      : buildNextSessionState(previousState, options.eventName, options.eventTime, eventTime),
  }
}

export async function captureProjectSnapshotDeltas(
  options: ProjectSnapshotOptions,
): Promise<FileDelta[]> {
  const transition = await planProjectSnapshotDeltas(options)
  await applyProjectSnapshotTransition(transition)
  return transition.deltas
}

export async function applySessionActivityTransition(
  transition: SessionActivityTransition,
): Promise<void> {
  if (transition.nextState === null) {
    await fs.rm(transition.statePath, { force: true })
    return
  }

  await fs.mkdir(path.dirname(transition.statePath), { recursive: true })
  await fs.writeFile(transition.statePath, JSON.stringify(transition.nextState), 'utf-8')
}

export async function planProjectSnapshotDeltas(
  options: ProjectSnapshotOptions,
): Promise<ProjectSnapshotTransition> {
  const snapshotPath = getSnapshotStatePath(options)
  const previousSnapshotState = normalizeProjectSnapshotState(
    await readJsonFile<unknown>(snapshotPath),
  )
  const previousSnapshot = previousSnapshotState?.files ?? {}
  const snapshotSalt = previousSnapshotState?.salt ?? randomUUID()
  const snapshotResult = await collectProjectTextFiles(
    options.projectRoot,
    options.candidatePaths,
  )
  if (!snapshotResult.readable) {
    return {
      deltas: [],
      nextSnapshot: null,
      statePath: snapshotPath,
    }
  }

  const currentSnapshotFiles = options.candidatePaths?.length
    ? mergeSnapshotCandidates(previousSnapshot, snapshotResult, snapshotSalt)
    : createSnapshotFiles(snapshotResult.snapshot, snapshotSalt)
  const changedFiles = new Set(
    options.candidatePaths?.length
      ? snapshotResult.visitedPaths
      : [...Object.keys(previousSnapshot), ...Object.keys(currentSnapshotFiles)],
  )
  if (options.candidatePaths?.length) {
    for (const visitedPath of snapshotResult.visitedPaths) {
      if (snapshotResult.snapshot[visitedPath] !== undefined) {
        continue
      }

      for (const previousPath of Object.keys(previousSnapshot)) {
        if (previousPath === visitedPath || previousPath.startsWith(`${visitedPath}/`)) {
          changedFiles.add(previousPath)
        }
      }
    }
  }
  const deltas: FileDelta[] = []

  for (const relativePath of [...changedFiles].sort()) {
    const previousFile = previousSnapshot[relativePath] ?? null
    const currentFile = currentSnapshotFiles[relativePath] ?? null
    if (previousFile?.contentHash === currentFile?.contentHash) {
      continue
    }

    const counts = countLineChanges(
      previousFile?.lineHashes ?? [],
      currentFile?.lineHashes ?? [],
    )
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

  if (!Object.keys(previousSnapshot).length) {
    return {
      deltas: [],
      nextSnapshot: options.clearAfterCapture ? null : {
        version: SNAPSHOT_STATE_VERSION,
        salt: snapshotSalt,
        files: currentSnapshotFiles,
      },
      statePath: snapshotPath,
    }
  }

  return {
    deltas: deltas.filter((delta) => delta.added > 0 || delta.removed > 0),
    nextSnapshot: options.clearAfterCapture ? null : {
      version: SNAPSHOT_STATE_VERSION,
      salt: snapshotSalt,
      files: currentSnapshotFiles,
    },
    statePath: snapshotPath,
  }
}

export async function applyProjectSnapshotTransition(
  transition: ProjectSnapshotTransition,
): Promise<void> {
  if (transition.nextSnapshot === null) {
    await fs.rm(transition.statePath, { force: true })
    return
  }

  await fs.mkdir(path.dirname(transition.statePath), { recursive: true })
  await fs.writeFile(transition.statePath, JSON.stringify(transition.nextSnapshot), 'utf-8')
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

interface ProjectSnapshotState {
  version: 3
  salt: string
  files: Record<string, SnapshotFileState>
}

interface SnapshotFileState {
  contentHash: string
  lineHashes: string[]
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
  const maxSpoolBytes = options.maxSpoolBytes
    ?? parsePositiveInteger(process.env.CLIPULSE_STATE_MAX_SPOOL_BYTES)
    ?? DEFAULT_STATE_MAX_SPOOL_BYTES
  const thresholdMs = now.getTime() - retentionDays * 24 * 60 * 60 * 1000
  const spoolDirs = getSpoolDirectories(stateDir)

  await ensureSpoolDirectories(spoolDirs)
  await quarantineStaleBacklogFiles(spoolDirs, thresholdMs)
  await capBacklogDirectoryBytes(spoolDirs, maxSpoolBytes)
  await pruneDirectoryByAge(path.join(stateDir, 'spool', 'tmp'), thresholdMs)
  await pruneQuarantineDirectoryByAge(path.join(stateDir, 'spool', 'quarantine'), thresholdMs)
  await pruneDirectoryByAge(path.join(stateDir, 'sessions'), thresholdMs)
  await pruneDirectoryByAge(path.join(stateDir, 'snapshots'), thresholdMs)
  await capQuarantineDirectoryFiles(path.join(stateDir, 'spool', 'quarantine'), maxFiles)
  await capDirectoryFiles(path.join(stateDir, 'sessions'), maxFiles)
  await capDirectoryFiles(path.join(stateDir, 'snapshots'), maxFiles)
}

export async function inspectLocalOperatorState(
  stateDir = resolveStateDir(),
): Promise<LocalOperatorStateSummary> {
  const spoolDirs = getSpoolDirectories(stateDir)
  const stateDirStat = await readPathStat(stateDir)
  const stateDirExists = Boolean(stateDirStat)
  const stateDirKind: LocalOperatorStateSummary['stateDirKind'] = stateDirStat
    ? stateDirStat.isDirectory()
      ? 'directory'
      : 'file'
    : 'missing'

  const states = [
    ['ready', spoolDirs.ready],
    ['processing', spoolDirs.processing],
    ['quarantine', spoolDirs.quarantine],
  ] as const
  const payloadCounts: LocalOperatorStateSummary['payloadCounts'] = {
    ready: 0,
    processing: 0,
    quarantine: 0,
  }
  const orphanMetadataCounts: LocalOperatorStateSummary['orphanMetadataCounts'] = {
    ready: 0,
    processing: 0,
    quarantine: 0,
  }
  const payloadBytes: LocalOperatorStateSummary['payloadBytes'] = {
    ready: 0,
    processing: 0,
    quarantine: 0,
  }
  const oldestAgeSeconds: LocalOperatorStateSummary['oldestAgeSeconds'] = {
    ready: 0,
    processing: 0,
    quarantine: 0,
  }
  const metadataErrorCounts: LocalOperatorStateSummary['metadataErrorCounts'] = {
    ready: { readError: 0, parseError: 0 },
    processing: { readError: 0, parseError: 0 },
    quarantine: { readError: 0, parseError: 0 },
  }
  const reasonCounts = new Map<string, number>()
  const entries: LocalOperatorStateEntry[] = []

  for (const [state, directoryPath] of states) {
    metadataErrorCounts[state] = await collectMetadataErrorCounts(directoryPath)
    const summary = await collectOperatorStateEntries(directoryPath, state)
    payloadCounts[state] = summary.payloadCount
    orphanMetadataCounts[state] = summary.orphanMetadataCount
    payloadBytes[state] = summary.payloadBytes
    oldestAgeSeconds[state] = summary.oldestAgeSeconds

    for (const entry of summary.entries) {
      entries.push(entry)
      if (!entry.reason) {
        continue
      }

      reasonCounts.set(entry.reason, (reasonCounts.get(entry.reason) ?? 0) + 1)
    }
  }

  return {
    stateDir,
    stateDirExists,
    stateDirKind,
    payloadCounts,
    orphanMetadataCounts,
    payloadBytes,
    oldestAgeSeconds,
    reasonCounts: Object.fromEntries(
      [...reasonCounts.entries()].sort(([left], [right]) => left.localeCompare(right)),
    ),
    metadataErrorCounts,
    quarantineMetadataErrorCounts: metadataErrorCounts.quarantine,
    entries: entries.sort((left, right) => (
      LOCAL_OPERATOR_STATE_ORDER[left.state] - LOCAL_OPERATOR_STATE_ORDER[right.state]
      || left.fileName.localeCompare(right.fileName)
    )),
  }
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

  for (const fileName of files.filter(isPayloadFile).sort()) {
    const processingPath = path.join(spoolDirs.processing, fileName)
    const readyPath = path.join(spoolDirs.ready, fileName)
    const processingStat = await readPathStat(processingPath)
    const existingMetadata = await readSpoolBatchMetadata(
      spoolDirs.processing,
      fileName,
      processingStat,
    )

    try {
      if (await readPathStat(readyPath)) {
        const displacedFileName = `${Date.now()}-${process.pid}-${randomUUID()}-${fileName}`
        await fs.rename(readyPath, path.join(spoolDirs.ready, displacedFileName))
        await renameSpoolBatchMetadataIfPresent(
          spoolDirs.ready,
          fileName,
          spoolDirs.ready,
          displacedFileName,
        )
      }
      await fs.rename(processingPath, readyPath)
      await removeSpoolBatchMetadata(spoolDirs.processing, fileName)
      await writeSpoolBatchMetadata(
        spoolDirs.ready,
        fileName,
        buildSpoolBatchMetadata(existingMetadata, processingStat),
      )
    } catch {
      await moveSpoolBatchToQuarantine(
        processingPath,
        spoolDirs,
        fileName,
        buildQuarantineMetadataFromSpool(
          existingMetadata,
          await readBatchEventCount(processingPath),
          'recovery_failed',
          null,
          {
          sourceState: 'processing',
          approxBytes: await readFileSize(processingPath),
          },
        ),
      )
      await removeSpoolBatchMetadata(spoolDirs.processing, fileName)
    }
  }
}

async function flushReadyBatches(
  apiBaseUrl: string,
  spoolDirs: SpoolDirectories,
  fetchImpl: typeof fetch,
  maxFlushBatches: number,
  apiBearerToken?: string,
): Promise<{ flushed: number, backlogPending: boolean, seenEventIds: Set<string> }> {
  const readyFiles = (await fs.readdir(spoolDirs.ready))
    .filter(isPayloadFile)
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
      await renameSpoolBatchMetadataIfPresent(
        spoolDirs.ready,
        fileName,
        spoolDirs.processing,
      )
    } catch {
      continue
    }

    try {
      const processingStat = await readPathStat(processingPath)
      const existingMetadata = await readSpoolBatchMetadata(
        spoolDirs.processing,
        fileName,
        processingStat,
      )
      const attemptedMetadata = buildSpoolBatchMetadata(existingMetadata, processingStat, {
        markAttempted: true,
      })
      const rawPayload = await fs.readFile(processingPath, 'utf-8')
      const parsedBatch = JSON.parse(rawPayload) as EventBatch
      const payload = dedupePreparedBatch(
        prepareOutboundBatch(parsedBatch),
        seenEventIds,
      )
      if (!payload.batch.events.length) {
        await fs.rm(processingPath, { force: true })
        await removeSpoolBatchMetadata(spoolDirs.processing, fileName)
        continue
      }
      if (payload.removed > 0) {
        await fs.writeFile(processingPath, JSON.stringify(payload.batch), 'utf-8')
      }
      await writeSpoolBatchMetadata(spoolDirs.processing, fileName, attemptedMetadata)
      const sendResult = await trySendBatch(apiBaseUrl, payload.batch, fetchImpl, apiBearerToken)
      const retryableCount = sendResult.retryableBatch.events.length
      const quarantinedCount = sendResult.quarantineBatch.events.length

      if (retryableCount >= payload.batch.events.length && retryableCount > 0) {
        await fs.rename(processingPath, readyPath)
        await removeSpoolBatchMetadata(spoolDirs.processing, fileName)
        await writeSpoolBatchMetadata(spoolDirs.ready, fileName, attemptedMetadata)
        blocked = true
        break
      }

      if (quarantinedCount > 0) {
        const quarantineMetadata = buildQuarantineMetadataFromSpool(
          attemptedMetadata,
          sendResult.quarantineBatch.events.length,
          sendResult.quarantineMetadata?.reason ?? 'invalid_results',
          sendResult.quarantineMetadata?.status ?? null,
          {
            sourceState: 'processing',
            approxBytes: await readFileSize(processingPath),
          },
        )
        await fs.rm(processingPath, { force: true })
        await removeSpoolBatchMetadata(spoolDirs.processing, fileName)
        await persistQuarantineBatch(
          sendResult.quarantineBatch,
          spoolDirs,
          quarantineMetadata,
          fileName,
        )
      }

      if (retryableCount > 0) {
        if (quarantinedCount === 0) {
          await fs.rm(processingPath, { force: true })
          await removeSpoolBatchMetadata(spoolDirs.processing, fileName)
        }
        await fs.writeFile(readyPath, JSON.stringify(sendResult.retryableBatch), 'utf-8')
        await writeSpoolBatchMetadata(spoolDirs.ready, fileName, attemptedMetadata)
        if (retryableCount < payload.batch.events.length) {
          continue
        }

        blocked = true
        break
      }

      if (quarantinedCount > 0) {
        continue
      }

      await fs.rm(processingPath, { force: true })
      await removeSpoolBatchMetadata(spoolDirs.processing, fileName)
      flushed += 1
    } catch {
      const processingStat = await readPathStat(processingPath)
      const existingMetadata = await readSpoolBatchMetadata(
        spoolDirs.processing,
        fileName,
        processingStat,
      )
      await moveSpoolBatchToQuarantine(
        processingPath,
        spoolDirs,
        fileName,
        buildQuarantineMetadataFromSpool(existingMetadata, 0, 'invalid_spool_payload', null, {
          sourceState: 'processing',
          approxBytes: await readFileSize(processingPath),
        }),
      )
    }
  }

  const readyCount = (await safeReadDir(spoolDirs.ready))
    .filter(isPayloadFile)
    .length

  return {
    flushed,
    backlogPending: blocked || readyCount > 0,
    seenEventIds,
  }
}

async function persistReadyBatch(batch: EventBatch, spoolDirs: SpoolDirectories): Promise<void> {
  return persistReadyBatchWithMetadata(batch, spoolDirs)
}

async function persistReadyBatchWithMetadata(
  batch: EventBatch,
  spoolDirs: SpoolDirectories,
  metadata: SpoolBatchMetadata | null = null,
): Promise<void> {
  const fileName = `${Date.now()}-${process.pid}-${randomUUID()}.json`
  const tmpPath = path.join(spoolDirs.tmp, `${fileName}.tmp`)
  const readyPath = path.join(spoolDirs.ready, fileName)
  const dedupedBatch = dedupePreparedBatch(prepareOutboundBatch(batch)).batch

  if (!dedupedBatch.events.length) {
    return
  }

  await fs.writeFile(tmpPath, JSON.stringify(dedupedBatch), 'utf-8')
  await fs.rename(tmpPath, readyPath)
  await writeSpoolBatchMetadata(
    spoolDirs.ready,
    fileName,
    metadata ?? buildSpoolBatchMetadata(null, await readPathStat(readyPath)),
  )
}

async function persistQuarantineBatch(
  batch: EventBatch,
  spoolDirs: SpoolDirectories,
  metadata: QuarantineMetadata | null,
  preferredFileName?: string,
): Promise<void> {
  const fileName = preferredFileName ?? `${Date.now()}-${process.pid}-${randomUUID()}.json`
  const tmpPath = path.join(spoolDirs.tmp, `${fileName}.tmp`)
  const quarantinePath = path.join(spoolDirs.quarantine, fileName)
  const metadataPath = path.join(spoolDirs.quarantine, fileName.replace(/\.json$/, '.meta.json'))
  const dedupedBatch = dedupePreparedBatch(prepareOutboundBatch(batch)).batch

  if (!dedupedBatch.events.length) {
    return
  }

  await fs.writeFile(tmpPath, JSON.stringify(dedupedBatch), 'utf-8')
  await fs.rename(tmpPath, quarantinePath)
  if (metadata) {
    await fs.writeFile(metadataPath, JSON.stringify(metadata), 'utf-8')
  }
}

async function moveSpoolBatchToQuarantine(
  sourcePath: string,
  spoolDirs: SpoolDirectories,
  fileName: string,
  metadata: QuarantineMetadata,
): Promise<void> {
  const quarantinePath = path.join(spoolDirs.quarantine, fileName)
  const metadataPath = path.join(spoolDirs.quarantine, fileName.replace(/\.json$/, '.meta.json'))
  const sourceDirectory = path.dirname(sourcePath)

  await fs.rename(sourcePath, quarantinePath)
  await removeSpoolBatchMetadata(sourceDirectory, fileName)
  await fs.writeFile(metadataPath, JSON.stringify(metadata), 'utf-8')
}

async function trySendBatch(
  apiBaseUrl: string,
  batch: EventBatch,
  fetchImpl: typeof fetch,
  apiBearerToken?: string,
): Promise<BatchSendResult> {
  try {
    return await sendBatch(apiBaseUrl, batch, fetchImpl, apiBearerToken)
  } catch {
    return {
      retryableBatch: batch,
      quarantineBatch: { events: [] },
      quarantineMetadata: null,
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

function shouldQuarantineResult(result: BatchResultItem): boolean {
  if (result.status !== 'invalid') {
    return false
  }

  return result.retryable === false
}

function shouldRetryResult(result: BatchResultItem): boolean {
  if (result.retryable === true) {
    return true
  }

  if (result.status === 'invalid') {
    return result.retryable !== false
  }

  return false
}

function isSuccessfulResult(result: BatchResultItem): boolean {
  return result.status === 'accepted' || result.status === 'duplicate'
}

function buildQuarantineMetadata(
  eventCount: number,
  reason: string,
  status: number | null,
  options: {
    sourceState?: string
    attemptCount?: number
    approxBytes?: number
  } = {},
): QuarantineMetadata {
  const timestamp = new Date().toISOString()

  return {
    reason,
    status,
    event_count: eventCount,
    first_seen_at: timestamp,
    last_attempted_at: timestamp,
    source_state: options.sourceState,
    attempt_count: options.attemptCount,
    approx_bytes: options.approxBytes,
  }
}

function buildQuarantineMetadataFromSpool(
  metadata: SpoolBatchMetadata | null,
  eventCount: number,
  reason: string,
  status: number | null,
  options: {
    sourceState?: string
    approxBytes?: number
  } = {},
): QuarantineMetadata {
  const baseMetadata = buildSpoolBatchMetadata(metadata, null)

  return {
    reason,
    status,
    event_count: eventCount,
    first_seen_at: baseMetadata.first_seen_at,
    last_attempted_at: baseMetadata.last_attempted_at ?? baseMetadata.first_seen_at,
    source_state: options.sourceState,
    attempt_count: baseMetadata.attempt_count,
    approx_bytes: options.approxBytes,
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

function isPayloadFile(fileName: string): boolean {
  return fileName.endsWith('.json') && !fileName.endsWith('.meta.json')
}

function getSpoolMetadataPath(directoryPath: string, fileName: string): string {
  return path.join(directoryPath, fileName.replace(/\.json$/, '.meta.json'))
}

function normalizeTextField(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null
}

function normalizeApproxBytes(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null
}

function normalizeAttemptCount(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return undefined
  }

  return value
}

function normalizeIsoTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  return Number.isFinite(Date.parse(value)) ? value : undefined
}

function buildSpoolBatchMetadata(
  existing: Partial<SpoolBatchMetadata> | null,
  fileStat: Awaited<ReturnType<typeof fs.stat>> | null,
  options: {
    markAttempted?: boolean
    fallbackNow?: string
  } = {},
): SpoolBatchMetadata {
  const fallbackNow = options.fallbackNow ?? new Date().toISOString()
  const firstSeenAt = existing?.first_seen_at
    ?? (fileStat ? new Date(Number(fileStat.mtimeMs)).toISOString() : fallbackNow)
  const attemptCount = existing?.attempt_count ?? 0

  return {
    first_seen_at: firstSeenAt,
    last_attempted_at: options.markAttempted
      ? fallbackNow
      : existing?.last_attempted_at,
    attempt_count: options.markAttempted ? attemptCount + 1 : attemptCount,
  }
}

async function readSpoolBatchMetadata(
  directoryPath: string,
  fileName: string,
  fileStat: Awaited<ReturnType<typeof fs.stat>> | null = null,
): Promise<SpoolBatchMetadata | null> {
  const rawMetadata = await readJsonFile<Partial<SpoolBatchMetadata>>(
    getSpoolMetadataPath(directoryPath, fileName),
  )
  if (rawMetadata === null && fileStat === null) {
    return null
  }

  const normalizedMetadata = rawMetadata
    ? {
        first_seen_at: normalizeIsoTimestamp(rawMetadata.first_seen_at),
        last_attempted_at: normalizeIsoTimestamp(rawMetadata.last_attempted_at),
        attempt_count: normalizeAttemptCount(rawMetadata.attempt_count),
      }
    : null

  return buildSpoolBatchMetadata(
    normalizedMetadata,
    fileStat,
  )
}

async function writeSpoolBatchMetadata(
  directoryPath: string,
  fileName: string,
  metadata: SpoolBatchMetadata,
): Promise<void> {
  await fs.writeFile(
    getSpoolMetadataPath(directoryPath, fileName),
    JSON.stringify(metadata),
    'utf-8',
  )
}

async function removeSpoolBatchMetadata(
  directoryPath: string,
  fileName: string,
): Promise<void> {
  await fs.rm(getSpoolMetadataPath(directoryPath, fileName), { force: true })
}

async function renameSpoolBatchMetadataIfPresent(
  fromDirectoryPath: string,
  fromFileName: string,
  toDirectoryPath: string,
  toFileName = fromFileName,
): Promise<void> {
  const fromPath = getSpoolMetadataPath(fromDirectoryPath, fromFileName)
  if (!await readPathStat(fromPath)) {
    return
  }

  await fs.rename(fromPath, getSpoolMetadataPath(toDirectoryPath, toFileName))
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
  const normalizedName = name.toLowerCase()

  if (
    normalizedName.startsWith('.env')
    || normalizedName === '.envrc'
    || normalizedName === '.netrc'
    || normalizedName === '.npmrc'
    || normalizedName === '.pypirc'
    || normalizedName.startsWith('credentials')
    || normalizedName.endsWith('.pem')
    || normalizedName.endsWith('.key')
    || normalizedName.endsWith('.p12')
    || normalizedName.endsWith('.pfx')
  ) {
    return true
  }

  return [
    '.aider',
    '.aws',
    '.claude',
    '.git',
    '.clipulse-private',
    '.codex',
    '.cursor',
    '.direnv',
    '.gemini',
    '.idea',
    '.mypy_cache',
    '.next',
    '.opencode',
    '.pytest_cache',
    '.ruff_cache',
    '.venv',
    '.vscode',
    '.worktrees',
    '__pycache__',
    'build',
    'coverage',
    'dist',
    'node_modules',
  ].includes(normalizedName)
}

function countLineChanges(previousLines: string[], currentLines: string[]): {
  added: number
  removed: number
} {
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

function createSnapshotFiles(
  snapshot: Record<string, string>,
  salt: string,
): Record<string, SnapshotFileState> {
  const files: Record<string, SnapshotFileState> = {}

  for (const [relativePath, content] of Object.entries(snapshot)) {
    files[relativePath] = createSnapshotFileState(content, salt)
  }

  return files
}

function createSnapshotFileState(content: string, salt: string): SnapshotFileState {
  return {
    contentHash: hashSnapshotText(content, salt),
    lineHashes: splitContentLines(content).map((line) => hashSnapshotText(line, salt)),
  }
}

function hashSnapshotText(value: string, salt: string): string {
  return createHash('sha256').update(`${salt}\0${value}`).digest('hex')
}

function sanitizeBatchProjectScopes(batch: EventBatch): EventBatch {
  return {
    events: batch.events.map((event) => ({
      ...event,
      project_root: normalizeProjectScopeKey(event.project_root),
    })),
  }
}

function normalizeProjectScopeKey(projectRoot: string): string {
  const trimmedProjectRoot = projectRoot.trim()
  if (PROJECT_SCOPE_KEY_PATTERN.test(trimmedProjectRoot)) {
    return trimmedProjectRoot
  }
  return createHash('sha1').update(trimmedProjectRoot).digest('hex').slice(0, PROJECT_SCOPE_KEY_LENGTH)
}

function isRequireProjectFileEnabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase()
  return normalized === '1' || normalized === 'true'
}

async function hasClipulseProjectFile(projectRoot: string): Promise<boolean> {
  return Boolean((await readPathStat(path.join(projectRoot, '.clipulse-project')))?.isFile())
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
    pendingToolStartedAt: resolveNextPendingToolStartedAt(
      previousState?.pendingToolStartedAt,
      eventName,
      eventTime,
      parsedEventTime,
    ),
  }
}

function resolveNextPendingToolStartedAt(
  previousPendingToolStartedAt: string | undefined,
  eventName: string,
  eventTime: string,
  parsedEventTime: number | null,
): string | undefined {
  if (eventName === 'pre_tool_use' && parsedEventTime !== null) {
    return eventTime
  }

  if (isToolWaitCompletionEvent(eventName) || isStopEvent(eventName)) {
    return undefined
  }

  return previousPendingToolStartedAt
}

function mergeSnapshotCandidates(
  previousSnapshot: Record<string, SnapshotFileState>,
  snapshotResult: SnapshotCollectionResult,
  salt: string,
): Record<string, SnapshotFileState> {
  const nextSnapshot = { ...previousSnapshot }

  for (const relativePath of snapshotResult.visitedPaths) {
    const content = snapshotResult.snapshot[relativePath]
    if (content === undefined) {
      delete nextSnapshot[relativePath]
      for (const previousPath of Object.keys(nextSnapshot)) {
        if (previousPath.startsWith(`${relativePath}/`)) {
          delete nextSnapshot[previousPath]
        }
      }
      continue
    }

    nextSnapshot[relativePath] = createSnapshotFileState(content, salt)
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
  const slashNormalized = relativePath
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')

  if (
    slashNormalized.length === 0
    || slashNormalized.startsWith('/')
    || /^[a-zA-Z]:\//.test(slashNormalized)
  ) {
    return ''
  }

  const collapsed = path.posix.normalize(slashNormalized)
  if (collapsed === '.' || collapsed === '..' || collapsed.startsWith('../')) {
    return ''
  }

  return collapsed
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

function normalizeProjectSnapshotState(input: unknown): ProjectSnapshotState | null {
  if (
    !isRecord(input)
    || input.version !== SNAPSHOT_STATE_VERSION
    || !isRecord(input.files)
    || typeof input.salt !== 'string'
    || input.salt.length === 0
  ) {
    return null
  }

  const files: Record<string, SnapshotFileState> = {}

  for (const [relativePath, value] of Object.entries(input.files)) {
    if (!isSnapshotFileState(value)) {
      continue
    }

    files[relativePath] = value
  }

  return {
    version: SNAPSHOT_STATE_VERSION,
    salt: input.salt,
    files,
  }
}

function isSnapshotFileState(value: unknown): value is SnapshotFileState {
  return isRecord(value)
    && typeof value.contentHash === 'string'
    && Array.isArray(value.lineHashes)
    && value.lineHashes.every((lineHash) => typeof lineHash === 'string')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function collectOperatorStateEntries(
  directoryPath: string,
  state: LocalOperatorStateEntry['state'],
): Promise<{
  payloadCount: number
  orphanMetadataCount: number
  payloadBytes: number
  oldestAgeSeconds: number
  entries: LocalOperatorStateEntry[]
}> {
  const fileNames = await safeReadDir(directoryPath)
  const payloadFileNames = fileNames.filter(isPayloadFile).sort()
  const metadataFileNames = fileNames.filter((fileName) => fileName.endsWith('.meta.json'))
  const payloadFileNameSet = new Set(payloadFileNames)
  let payloadBytes = 0
  let oldestMtimeMs: number | null = null
  const entries: LocalOperatorStateEntry[] = []

  for (const fileName of payloadFileNames) {
    const filePath = path.join(directoryPath, fileName)
    const stat = await readPathStat(filePath)
    if (!stat) {
      continue
    }

    payloadBytes += Number(stat.size)
    oldestMtimeMs = oldestMtimeMs === null
      ? Number(stat.mtimeMs)
      : Math.min(oldestMtimeMs, Number(stat.mtimeMs))
    const metadata = await readOperatorMetadata(directoryPath, fileName)
    entries.push({
      state,
      fileName,
      eventCount: await readBatchEventCount(filePath),
      approxBytes: metadata?.approxBytes ?? Number(stat.size),
      firstSeenAt: metadata?.firstSeenAt ?? null,
      lastAttemptedAt: metadata?.lastAttemptedAt ?? null,
      attemptCount: metadata?.attemptCount ?? null,
      reason: metadata?.reason ?? null,
      sourceState: metadata?.sourceState ?? null,
    })
  }

  return {
    payloadCount: entries.length,
    orphanMetadataCount: metadataFileNames
      .filter((fileName) => !payloadFileNameSet.has(fileName.replace(/\.meta\.json$/, '.json')))
      .length,
    payloadBytes,
    oldestAgeSeconds: computeAgeSeconds(oldestMtimeMs),
    entries,
  }
}

async function readOperatorMetadata(
  directoryPath: string,
  fileName: string,
): Promise<{
  firstSeenAt: string | null
  lastAttemptedAt: string | null
  attemptCount: number | null
  reason: string | null
  sourceState: string | null
  approxBytes: number | null
} | null> {
  const rawMetadata = await readJsonFile<Record<string, unknown>>(
    getSpoolMetadataPath(directoryPath, fileName),
  )
  if (!rawMetadata) {
    return null
  }

  return {
    firstSeenAt: normalizeIsoTimestamp(rawMetadata.first_seen_at) ?? null,
    lastAttemptedAt: normalizeIsoTimestamp(rawMetadata.last_attempted_at) ?? null,
    attemptCount: normalizeAttemptCount(rawMetadata.attempt_count) ?? null,
    reason: normalizeTextField(rawMetadata.reason),
    sourceState: normalizeTextField(rawMetadata.source_state),
    approxBytes: normalizeApproxBytes(rawMetadata.approx_bytes),
  }
}

async function collectMetadataErrorCounts(
  directoryPath: string,
): Promise<LocalOperatorStateSummary['quarantineMetadataErrorCounts']> {
  const fileNames = await safeReadDir(directoryPath)
  const errorCounts = {
    readError: 0,
    parseError: 0,
  }

  for (const fileName of fileNames) {
    if (!fileName.endsWith('.meta.json')) {
      continue
    }

    try {
      const rawBytes = await fs.readFile(path.join(directoryPath, fileName))
      const rawPayload = new TextDecoder('utf-8', { fatal: true }).decode(rawBytes)
      JSON.parse(rawPayload)
    } catch (error) {
      if (error instanceof SyntaxError) {
        errorCounts.parseError += 1
      } else {
        errorCounts.readError += 1
      }
    }
  }

  return errorCounts
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

async function pruneQuarantineDirectoryByAge(directoryPath: string, thresholdMs: number): Promise<void> {
  const entries = await listQuarantineEntries(directoryPath)

  await Promise.all(entries
    .filter((entry) => entry.latestMtimeMs < thresholdMs)
    .flatMap((entry) => entry.fileNames)
    .map(async (fileName) => {
      await fs.rm(path.join(directoryPath, fileName), { recursive: true, force: true })
    }))
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

async function capQuarantineDirectoryFiles(directoryPath: string, maxFiles: number): Promise<void> {
  const staleEntries = (await listQuarantineEntries(directoryPath))
    .sort((left, right) => right.latestMtimeMs - left.latestMtimeMs)
    .slice(maxFiles)

  await Promise.all(staleEntries.flatMap((entry) => entry.fileNames).map(async (fileName) => {
    await fs.rm(path.join(directoryPath, fileName), { force: true, recursive: true })
  }))
}

async function safeReadDir(directoryPath: string): Promise<string[]> {
  try {
    return await fs.readdir(directoryPath)
  } catch {
    return []
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.stat(targetPath)
    return true
  } catch {
    return false
  }
}

async function quarantineStaleBacklogFiles(
  spoolDirs: SpoolDirectories,
  thresholdMs: number,
): Promise<void> {
  for (const [sourceState, directoryPath] of [
    ['ready', spoolDirs.ready],
    ['processing', spoolDirs.processing],
  ] as const) {
    for (const fileName of (await safeReadDir(directoryPath)).filter(isPayloadFile).sort()) {
      const filePath = path.join(directoryPath, fileName)
      const stat = await readPathStat(filePath)
      if (!stat || stat.mtimeMs >= thresholdMs) {
        continue
      }
      const existingMetadata = await readSpoolBatchMetadata(directoryPath, fileName, stat)

      await moveSpoolBatchToQuarantine(
        filePath,
        spoolDirs,
        fileName,
        buildQuarantineMetadataFromSpool(
          existingMetadata,
          await readBatchEventCount(filePath),
          'stale_backlog',
          null,
          {
          sourceState,
          approxBytes: Number(stat.size),
          },
        ),
      )
    }
  }
}

async function capBacklogDirectoryBytes(
  spoolDirs: SpoolDirectories,
  maxSpoolBytes: number,
): Promise<void> {
  if (maxSpoolBytes <= 0) {
    return
  }

  const entries = await listBacklogEntries(spoolDirs)
  let totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0)

  for (const entry of entries.sort((left, right) => left.mtimeMs - right.mtimeMs)) {
    if (totalBytes <= maxSpoolBytes) {
      break
    }

    await moveSpoolBatchToQuarantine(
      entry.filePath,
      spoolDirs,
      entry.fileName,
      buildQuarantineMetadataFromSpool(
        entry.metadata,
        await readBatchEventCount(entry.filePath),
        'spool_size_cap',
        null,
        {
          sourceState: entry.sourceState,
          approxBytes: entry.size,
        },
      ),
    )
    totalBytes -= entry.size
  }
}

async function listBacklogEntries(
  spoolDirs: SpoolDirectories,
): Promise<Array<{
  fileName: string
  filePath: string
  metadata: SpoolBatchMetadata | null
  mtimeMs: number
  size: number
  sourceState: 'ready' | 'processing'
}>> {
  const entries: Array<{
    fileName: string
    filePath: string
    metadata: SpoolBatchMetadata | null
    mtimeMs: number
    size: number
    sourceState: 'ready' | 'processing'
  }> = []

  for (const [sourceState, directoryPath] of [
    ['ready', spoolDirs.ready],
    ['processing', spoolDirs.processing],
  ] as const) {
    for (const fileName of (await safeReadDir(directoryPath)).filter(isPayloadFile)) {
      const filePath = path.join(directoryPath, fileName)
      const stat = await readPathStat(filePath)
      if (!stat) {
        continue
      }

      entries.push({
        fileName,
        filePath,
        metadata: await readSpoolBatchMetadata(directoryPath, fileName, stat),
        mtimeMs: Number(stat.mtimeMs),
        size: Number(stat.size),
        sourceState,
      })
    }
  }

  return entries
}

async function readBatchEventCount(filePath: string): Promise<number> {
  const batch = await readJsonFile<EventBatch>(filePath)
  return Array.isArray(batch?.events) ? batch.events.length : 0
}

async function readFileSize(filePath: string): Promise<number | undefined> {
  const stat = await readPathStat(filePath)
  return stat ? Number(stat.size) : undefined
}

async function listQuarantineEntries(
  directoryPath: string,
): Promise<Array<{ baseName: string, latestMtimeMs: number, fileNames: string[] }>> {
  const grouped = new Map<string, { latestMtimeMs: number, fileNames: string[] }>()

  for (const fileName of await safeReadDir(directoryPath)) {
    const filePath = path.join(directoryPath, fileName)
    const stat = await readPathStat(filePath)
    if (!stat) {
      continue
    }

    const baseName = fileName.endsWith('.meta.json')
      ? fileName.slice(0, -'.meta.json'.length)
      : fileName.endsWith('.json')
        ? fileName.slice(0, -'.json'.length)
        : fileName
    const entry = grouped.get(baseName) ?? { latestMtimeMs: 0, fileNames: [] }
    entry.latestMtimeMs = Math.max(entry.latestMtimeMs, Number(stat.mtimeMs))
    entry.fileNames.push(fileName)
    grouped.set(baseName, entry)
  }

  return [...grouped.entries()].map(([baseName, entry]) => ({
    baseName,
    latestMtimeMs: entry.latestMtimeMs,
    fileNames: entry.fileNames.sort(),
  }))
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

async function resolveStableProjectRoot(
  workspaceRoot: string,
  gitPaths: { gitDir: string | null, commonGitDir: string | null },
): Promise<string> {
  if (gitPaths.commonGitDir) {
    return resolveRealPath(path.dirname(gitPaths.commonGitDir))
  }

  return resolveRealPath(workspaceRoot)
}

async function findProjectRoot(startPath: string): Promise<string | null> {
  let currentPath = await resolveProjectLookupPath(startPath)

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

async function findClipulseProjectRoot(startPath: string): Promise<string | null> {
  let currentPath = await resolveProjectLookupPath(startPath)

  while (true) {
    const projectMarker = await readPathStat(path.join(currentPath, '.clipulse-project'))
    if (projectMarker?.isFile()) {
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

async function readClipulseProjectOverride(projectRoot: string): Promise<{
  projectName?: string
  gitBranch?: string
  scope?: 'git' | 'workspace'
}> {
  const projectFilePath = path.join(projectRoot, '.clipulse-project')
  const rawValue = await safeReadTextFile(projectFilePath)
  if (!rawValue) {
    return {}
  }

  const lines = rawValue
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
  const keyedEntries = lines
    .filter((line) => line.includes('='))
    .map((line): [string, string] => {
      const [rawKey, ...rawValueParts] = line.split('=')
      return [(rawKey ?? '').trim().toLowerCase(), rawValueParts.join('=').trim()]
    })
  const keyedMode = keyedEntries.length > 0

  if (!keyedMode) {
    const [projectNameLine, gitBranchLine] = lines

    return {
      projectName: projectNameLine || undefined,
      gitBranch: gitBranchLine || undefined,
    }
  }

  const keyedValues = new Map(
    keyedEntries.filter(([key, value]) => Boolean(key) && value.length > 0),
  )
  const scopeValue = keyedValues.get('scope')

  return {
    projectName: keyedValues.get('project_name') || keyedValues.get('name') || undefined,
    gitBranch: keyedValues.get('git_branch') || keyedValues.get('branch') || undefined,
    scope: scopeValue === 'workspace'
      ? 'workspace'
      : scopeValue === 'git'
        ? 'git'
        : undefined,
  }
}

async function resolveProjectLookupPath(startPath: string): Promise<string> {
  let currentPath = path.resolve(startPath)
  const initialStat = await readPathStat(currentPath)
  if (initialStat?.isFile()) {
    currentPath = path.dirname(currentPath)
  }
  return currentPath
}

async function resolveWorkspaceRoot(
  markerRoot: string | null,
  gitProjectRoot: string | null,
  fallbackRoot: string,
): Promise<string> {
  if (markerRoot) {
    return markerRoot
  }
  if (gitProjectRoot) {
    return gitProjectRoot
  }
  return path.resolve(fallbackRoot)
}

async function safeReadTextFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf-8')
  } catch {
    return null
  }
}

async function resolveRealPath(targetPath: string): Promise<string> {
  try {
    return await fs.realpath(targetPath)
  } catch {
    return path.resolve(targetPath)
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

function normalizeEventForEventId(event: NormalizedActivityEvent): NormalizedActivityEvent {
  const normalizedEventTime = normalizeEventTimeForEventId(event.event_time)
  if (!normalizedEventTime || normalizedEventTime === event.event_time) {
    return event
  }

  return {
    ...event,
    event_time: normalizedEventTime,
  }
}

function normalizeEventTimeForEventId(value: string): string | null {
  const normalizedInput = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}Z`
  const parsed = Date.parse(normalizedInput)
  if (!Number.isFinite(parsed)) {
    return null
  }

  return new Date(parsed).toISOString().replace(/\.000Z$/, 'Z')
}

function computeAgeSeconds(oldestMtimeMs: number | null): number {
  if (oldestMtimeMs === null) {
    return 0
  }

  return Math.max(Math.floor((Date.now() - oldestMtimeMs) / 1000), 0)
}
