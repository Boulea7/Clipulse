import { createHash } from 'node:crypto'
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
