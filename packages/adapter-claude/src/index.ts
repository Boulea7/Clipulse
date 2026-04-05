import path from 'node:path'

import {
  aggregateLanguages,
  createFileFingerprint,
  mergeFileDeltas,
  type FileDelta,
  type NormalizedActivityEvent,
} from '../../collector-core/src/index.js'

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
  transcript_path: string
  cwd: string
  hook_event_name: string
  model?: string
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
    event_name: input.hook_event_name.toLowerCase(),
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

function extractFileDeltas(projectRoot: string, transcript: string): FileDelta[] {
  const deltas: FileDelta[] = []

  for (const rawLine of transcript.split('\n')) {
    if (!rawLine.trim()) {
      continue
    }

    const entry = JSON.parse(rawLine) as ClaudeTranscriptEntry
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
    .map((line) => JSON.parse(line) as ClaudeTranscriptEntry)
    .filter((line) => line.timestamp)

  return lines.at(-1)?.timestamp ?? new Date(0).toISOString()
}

function guessLanguage(filePath: string): string {
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
