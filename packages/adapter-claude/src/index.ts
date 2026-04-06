import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

import {
  aggregateLanguages,
  createFileFingerprint,
  guessLanguage,
  resolveProjectContext,
  mergeFileDeltas,
  trackSessionActivity,
  type FileDelta,
  type NormalizedActivityEvent,
} from '@clipulse/collector-core'

interface ClaudePatch {
  lines?: string[]
}

interface ClaudeTranscriptEntry {
  timestamp?: string
  toolUseResult?: {
    filePath?: string
    structuredPatch?: ClaudePatch[]
  }
}

interface ClaudeHookInput {
  session_id: string
  transcript_path?: string
  cwd: string
  hook_event_name: string
  model?: string
  event_time?: string
}

interface BuildClaudeEventOptions {
  stateDir: string
  previousState?: ClaudeTranscriptState | null
}

const NOISY_EMPTY_EVENT_NAMES = new Set(['session_start', 'subagent_start', 'subagent_stop'])
const CLAUDE_EMPTY_EVENT_DEBOUNCE_MS = 15_000
const CLAUDE_TRANSCRIPT_STATE_SCHEMA_VERSION = 2

export interface ClaudeTranscriptState {
  lineCount: number
  lastSubmittedAt?: string
  lastEntryHash?: string
  lastEntryTimestamp?: string
  noisyEmptyEventSubmittedAt?: Record<string, string>
}

interface PersistedClaudeTranscriptState extends ClaudeTranscriptState {
  schemaVersion?: number
  sessionId?: string
  projectRoot?: string
  transcriptPath?: string
}

export interface ClaudeHookBuildResult {
  event: NormalizedActivityEvent | null
  nextState: ClaudeTranscriptState
}

export function normalizeClaudeHookEvent(
  input: ClaudeHookInput,
  transcript: string,
): NormalizedActivityEvent {
  const deltas = extractFileDeltas(input.cwd, parseTranscriptEntries(transcript))
  const merged = mergeFileDeltas(deltas)
  const latestTimestamp = extractLatestTimestamp(parseTranscriptEntries(transcript))

  return {
    host: 'claude-code',
    host_version: 'unknown',
    session_id: input.session_id,
    project_root: input.cwd,
    project_name: path.basename(input.cwd),
    git_branch: 'unknown',
    event_name: toSnakeCase(input.hook_event_name),
    event_time: latestTimestamp,
    model_name: input.model ?? 'unknown',
    os_name: process.platform,
    editor_or_terminal: 'terminal',
    active_ms: 0,
    wait_ms: 0,
    privacy_mode: 'hashed',
    language_stats: aggregateLanguages(merged),
    file_deltas: merged,
  }
}

export async function buildClaudeHookEvent(
  input: ClaudeHookInput,
  transcript: string,
  options: BuildClaudeEventOptions,
): Promise<ClaudeHookBuildResult> {
  const previousState = options.previousState ?? null
  const entries = parseTranscriptEntries(transcript)
  const startLine = resolveTranscriptStartLine(entries, previousState)
  const latestEntry = entries.at(-1)
  const nextState: ClaudeTranscriptState = {
    lineCount: entries.length,
    lastSubmittedAt: previousState?.lastSubmittedAt,
    lastEntryHash: latestEntry ? buildTranscriptEntryHash(latestEntry) : previousState?.lastEntryHash,
    lastEntryTimestamp: latestEntry?.timestamp ?? previousState?.lastEntryTimestamp,
    noisyEmptyEventSubmittedAt: { ...(previousState?.noisyEmptyEventSubmittedAt ?? {}) },
  }
  const newEntries = entries.slice(startLine)
  const deltas = extractFileDeltas(input.cwd, newEntries)
  const merged = mergeFileDeltas(deltas)
  const projectContext = await resolveProjectContext(input.cwd)
  const normalized: NormalizedActivityEvent = {
    host: 'claude-code',
    host_version: 'unknown',
    session_id: input.session_id,
    project_root: projectContext.projectRoot,
    project_name: projectContext.projectName,
    git_branch: projectContext.gitBranch,
    event_name: toSnakeCase(input.hook_event_name),
    event_time: extractLatestTimestamp(newEntries),
    model_name: input.model ?? 'unknown',
    os_name: process.platform,
    editor_or_terminal: 'terminal',
    active_ms: 0,
    wait_ms: 0,
    privacy_mode: 'hashed',
    language_stats: aggregateLanguages(merged),
    file_deltas: merged,
  }
  const eventTime =
    input.event_time ??
    (normalized.event_time === new Date(0).toISOString()
      ? new Date().toISOString()
      : normalized.event_time)
  const timing = await trackSessionActivity({
    stateDir: options.stateDir,
    host: normalized.host,
    sessionId: normalized.session_id,
    projectRoot: normalized.project_root,
    eventName: normalized.event_name,
    eventTime,
  })

  const event = {
    ...normalized,
    event_time: eventTime,
    active_ms: timing.activeMs,
    wait_ms: timing.waitMs,
  }

  if (!shouldCaptureClaudeEvent(event, previousState)) {
    return {
      event: null,
      nextState,
    }
  }

  nextState.lastSubmittedAt = event.event_time
  if (NOISY_EMPTY_EVENT_NAMES.has(event.event_name) && event.file_deltas.length === 0) {
    nextState.noisyEmptyEventSubmittedAt = {
      ...(nextState.noisyEmptyEventSubmittedAt ?? {}),
      [event.event_name]: event.event_time,
    }
  }

  return {
    event,
    nextState,
  }
}

function extractFileDeltas(projectRoot: string, entries: ClaudeTranscriptEntry[]): FileDelta[] {
  const deltas: FileDelta[] = []

  for (const entry of entries) {
    const filePath = entry.toolUseResult?.filePath
    if (!filePath) {
      continue
    }

    const patches = entry.toolUseResult?.structuredPatch ?? []
    let added = 0
    let removed = 0

    for (const patch of patches) {
      for (const line of patch.lines ?? []) {
        if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) {
          continue
        }
        if (line.startsWith('+')) {
          added += 1
        } else if (line.startsWith('-')) {
          removed += 1
        }
      }
    }

    if (added > 0 || removed > 0) {
      deltas.push({
        fingerprint: createFileFingerprint(filePath, projectRoot),
        language: guessLanguage(filePath),
        added,
        removed,
      })
    }
  }

  return deltas
}

function extractLatestTimestamp(entries: ClaudeTranscriptEntry[]): string {
  const lines = entries.filter((line) => line.timestamp)
  return lines.at(-1)?.timestamp ?? new Date(0).toISOString()
}

function buildTranscriptEntryHash(entry: ClaudeTranscriptEntry): string {
  return createHash('sha1').update(JSON.stringify(entry)).digest('hex')
}

function parseTranscriptEntries(transcript: string): ClaudeTranscriptEntry[] {
  return transcript
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line) as ClaudeTranscriptEntry
      } catch {
        return null
      }
    })
    .filter((entry): entry is ClaudeTranscriptEntry => entry !== null)
}

function shouldCaptureClaudeEvent(
  event: NormalizedActivityEvent,
  previousState: ClaudeTranscriptState | null,
): boolean {
  if (event.file_deltas.length > 0) {
    return true
  }

  if (event.event_name === 'user_prompt_submit') {
    return true
  }

  if (
    event.event_name === 'stop'
    || event.event_name === 'stop_failure'
    || event.event_name === 'session_end'
    || event.event_name === 'pre_compact'
  ) {
    return true
  }

  if (
    (event.event_name === 'pre_tool_use'
      || event.event_name === 'post_tool_use'
      || event.event_name === 'post_tool_use_failure')
    && event.active_ms === 0
    && event.wait_ms === 0
  ) {
    return false
  }

  if (!NOISY_EMPTY_EVENT_NAMES.has(event.event_name)) {
    return true
  }

  const previousSubmittedAt = Date.parse(
    previousState?.noisyEmptyEventSubmittedAt?.[event.event_name]
    ?? (previousState?.noisyEmptyEventSubmittedAt ? '' : (previousState?.lastSubmittedAt ?? '')),
  )
  const currentSubmittedAt = Date.parse(event.event_time)
  if (!Number.isFinite(previousSubmittedAt) || !Number.isFinite(currentSubmittedAt)) {
    return true
  }

  return currentSubmittedAt - previousSubmittedAt >= CLAUDE_EMPTY_EVENT_DEBOUNCE_MS
}

export function getClaudeTranscriptStatePath(
  stateDir: string,
  input: ClaudeHookInput,
): string {
  const scope = [input.session_id, input.cwd, input.transcript_path ?? ''].join(':')
  const fileName = `claude-${createHash('sha1').update(scope).digest('hex')}.json`
  return path.join(stateDir, 'claude-transcripts', fileName)
}

export async function readClaudeTranscriptState(
  stateDir: string,
  input: ClaudeHookInput,
): Promise<ClaudeTranscriptState | null> {
  try {
    const raw = await fs.readFile(getClaudeTranscriptStatePath(stateDir, input), 'utf-8')
    return normalizeClaudeTranscriptState(JSON.parse(raw))
  } catch {
    return null
  }
}

export async function writeClaudeTranscriptState(
  stateDir: string,
  input: ClaudeHookInput,
  nextState: ClaudeTranscriptState,
): Promise<void> {
  const statePath = getClaudeTranscriptStatePath(stateDir, input)
  await fs.mkdir(path.dirname(statePath), { recursive: true })
  const persistedState: PersistedClaudeTranscriptState = {
    schemaVersion: CLAUDE_TRANSCRIPT_STATE_SCHEMA_VERSION,
    ...nextState,
    sessionId: input.session_id,
    projectRoot: input.cwd,
    transcriptPath: input.transcript_path ?? '',
  }
  await fs.writeFile(statePath, JSON.stringify(persistedState), 'utf-8')
}

export async function clearClaudeTranscriptState(
  stateDir: string,
  input: ClaudeHookInput,
): Promise<void> {
  await fs.rm(getClaudeTranscriptStatePath(stateDir, input), { force: true })
}

export async function clearClaudeTranscriptStateVariants(
  stateDir: string,
  input: ClaudeHookInput,
): Promise<void> {
  const stateDirPath = path.join(stateDir, 'claude-transcripts')
  const currentStatePath = getClaudeTranscriptStatePath(stateDir, input)

  await fs.rm(currentStatePath, { force: true })

  let stateFiles: string[]
  try {
    stateFiles = await fs.readdir(stateDirPath)
  } catch {
    return
  }

  await Promise.all(
    stateFiles.map(async (fileName) => {
      const candidatePath = path.join(stateDirPath, fileName)
      if (candidatePath === currentStatePath) {
        return
      }

      try {
        const raw = await fs.readFile(candidatePath, 'utf-8')
        const state = JSON.parse(raw) as PersistedClaudeTranscriptState
        if (state.sessionId === input.session_id && state.projectRoot === input.cwd) {
          await fs.rm(candidatePath, { force: true })
        }
      } catch {
        // Ignore unreadable or concurrently removed files.
      }
    }),
  )
}

function normalizeClaudeTranscriptState(raw: unknown): ClaudeTranscriptState | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const parsed = raw as PersistedClaudeTranscriptState
  return {
    lineCount: typeof parsed.lineCount === 'number' ? parsed.lineCount : 0,
    lastSubmittedAt: typeof parsed.lastSubmittedAt === 'string' ? parsed.lastSubmittedAt : undefined,
    lastEntryHash: typeof parsed.lastEntryHash === 'string' ? parsed.lastEntryHash : undefined,
    lastEntryTimestamp: typeof parsed.lastEntryTimestamp === 'string' ? parsed.lastEntryTimestamp : undefined,
    noisyEmptyEventSubmittedAt:
      parsed.noisyEmptyEventSubmittedAt && typeof parsed.noisyEmptyEventSubmittedAt === 'object'
        ? parsed.noisyEmptyEventSubmittedAt
        : undefined,
  }
}

function resolveTranscriptStartLine(
  entries: ClaudeTranscriptEntry[],
  previousState: ClaudeTranscriptState | null,
): number {
  const currentLineCount = entries.length
  const previousLineCount = previousState?.lineCount ?? 0
  if (currentLineCount < previousLineCount) {
    return 0
  }

  if (currentLineCount === previousLineCount && previousState?.lastEntryHash) {
    const latestEntry = entries.at(-1)
    if (!latestEntry || buildTranscriptEntryHash(latestEntry) !== previousState.lastEntryHash) {
      return 0
    }
  }

  return previousLineCount
}

function toSnakeCase(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase()
}
