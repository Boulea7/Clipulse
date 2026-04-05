import path from 'node:path'

import {
  aggregateLanguages,
  createFileFingerprint,
  guessLanguage,
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
}

export function normalizeClaudeHookEvent(
  input: ClaudeHookInput,
  transcript: string,
): NormalizedActivityEvent {
  const deltas = extractFileDeltas(input.cwd, transcript)
  const merged = mergeFileDeltas(deltas)
  const latestTimestamp = extractLatestTimestamp(transcript)

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
): Promise<NormalizedActivityEvent> {
  const normalized = normalizeClaudeHookEvent(input, transcript)
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

  return {
    ...normalized,
    event_time: eventTime,
    active_ms: timing.activeMs,
    wait_ms: timing.waitMs,
  }
}

function extractFileDeltas(projectRoot: string, transcript: string): FileDelta[] {
  const deltas: FileDelta[] = []

  for (const rawLine of transcript.split('\n')) {
    if (!rawLine.trim()) {
      continue
    }

    let entry: ClaudeTranscriptEntry
    try {
      entry = JSON.parse(rawLine) as ClaudeTranscriptEntry
    } catch {
      continue
    }

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

    deltas.push({
      fingerprint: createFileFingerprint(filePath, projectRoot),
      language: guessLanguage(filePath),
      added,
      removed,
    })
  }

  return deltas
}

function extractLatestTimestamp(transcript: string): string {
  const lines = transcript
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line) as ClaudeTranscriptEntry
      } catch {
        return null
      }
    })
    .filter((line): line is ClaudeTranscriptEntry => line !== null)
    .filter((line) => line.timestamp)

  return lines.at(-1)?.timestamp ?? new Date(0).toISOString()
}

function toSnakeCase(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase()
}
