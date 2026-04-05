import path from 'node:path'

import {
  aggregateLanguages,
  captureProjectSnapshotDeltas,
  mergeFileDeltas,
  trackSessionActivity,
  type NormalizedActivityEvent,
} from '@clipulse/collector-core'

interface CodexHookInput {
  session_id: string
  cwd: string
  hook_event_name: string
  model?: string
  event_time?: string
  transcript_path?: string
  tool_name?: string
  tool_input?: {
    command?: string
  }
  turn_id?: string
}

interface BuildCodexEventOptions {
  stateDir: string
}

export function normalizeCodexHookEvent(
  input: CodexHookInput,
): NormalizedActivityEvent {
  return {
    host: 'codex',
    host_version: 'unknown',
    session_id: input.session_id,
    project_root: input.cwd,
    project_name: path.basename(input.cwd),
    git_branch: 'unknown',
    event_name: toSnakeCase(input.hook_event_name),
    event_time: input.event_time ?? new Date(0).toISOString(),
    model_name: input.model ?? 'unknown',
    os_name: process.platform,
    editor_or_terminal: 'terminal',
    active_ms: 0,
    wait_ms: 0,
    privacy_mode: 'hashed',
    language_stats: {},
    file_deltas: [],
  }
}

export async function buildCodexHookEvent(
  input: CodexHookInput,
  options: BuildCodexEventOptions,
): Promise<NormalizedActivityEvent> {
  const normalized = normalizeCodexHookEvent(input)
  const eventTime = input.event_time ?? new Date().toISOString()
  const timing = await trackSessionActivity({
    stateDir: options.stateDir,
    host: normalized.host,
    sessionId: normalized.session_id,
    eventName: normalized.event_name,
    eventTime,
  })
  const snapshotDeltas = shouldCaptureProjectSnapshot(normalized.event_name)
    ? await captureProjectSnapshotDeltas({
        stateDir: options.stateDir,
        host: normalized.host,
        sessionId: normalized.session_id,
        projectRoot: normalized.project_root,
      })
    : []
  const mergedDeltas = mergeFileDeltas(snapshotDeltas)

  return {
    ...normalized,
    event_time: eventTime,
    active_ms: timing.activeMs,
    wait_ms: timing.waitMs,
    file_deltas: mergedDeltas,
    language_stats: aggregateLanguages(mergedDeltas),
  }
}

function toSnakeCase(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase()
}

function shouldCaptureProjectSnapshot(eventName: string): boolean {
  return eventName === 'session_start' || eventName === 'post_tool_use' || eventName === 'stop'
}
