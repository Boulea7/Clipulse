import path from 'node:path'

import {
  aggregateLanguages,
  createFileFingerprint,
  guessLanguage,
  mergeFileDeltas,
  resolveProjectContext,
  trackSessionActivity,
  type FileDelta,
  type NormalizedActivityEvent,
} from '@clipulse/collector-core'

interface OpenCodeFileEdit {
  path: string
  added?: number
  removed?: number
}

interface OpenCodeEventInput {
  session_id: string
  cwd: string
  event_name: string
  model?: string
  event_time?: string
  file_edits?: OpenCodeFileEdit[]
}

interface BuildOpenCodeEventOptions {
  stateDir: string
}

const OPENCODE_EVENT_NAME_MAP: Record<string, string> = {
  'session.created': 'session_start',
  'session.deleted': 'session_end',
  'session.error': 'stop_failure',
  'session.idle': 'session_end',
  'tool.execute.after': 'post_tool_use',
  'tool.execute.before': 'pre_tool_use',
  'tool.execute.error': 'post_tool_use_failure',
}

export function normalizeOpenCodeEvent(
  input: OpenCodeEventInput,
): NormalizedActivityEvent {
  const deltas = mergeFileDeltas(buildFileDeltas(input.cwd, input.file_edits))

  return {
    host: 'opencode',
    host_version: 'unknown',
    session_id: input.session_id,
    project_root: input.cwd,
    project_name: path.basename(input.cwd),
    git_branch: 'unknown',
    event_name: mapOpenCodeEventName(input.event_name),
    event_time: input.event_time ?? new Date(0).toISOString(),
    model_name: input.model ?? 'unknown',
    os_name: process.platform,
    editor_or_terminal: 'terminal',
    active_ms: 0,
    wait_ms: 0,
    privacy_mode: 'hashed',
    language_stats: aggregateLanguages(deltas),
    file_deltas: deltas,
  }
}

export async function buildOpenCodeEvent(
  input: OpenCodeEventInput,
  options: BuildOpenCodeEventOptions,
): Promise<NormalizedActivityEvent> {
  const projectContext = await resolveProjectContext(input.cwd)
  const normalized = normalizeOpenCodeEvent({
    ...input,
    cwd: projectContext.projectRoot,
  })
  const eventTime = input.event_time ?? new Date().toISOString()
  const timing = await trackSessionActivity({
    stateDir: options.stateDir,
    host: normalized.host,
    sessionId: normalized.session_id,
    projectRoot: projectContext.projectRoot,
    eventName: normalized.event_name,
    eventTime,
  })

  return {
    ...normalized,
    project_root: projectContext.projectRoot,
    project_name: projectContext.projectName,
    git_branch: projectContext.gitBranch,
    event_time: eventTime,
    active_ms: timing.activeMs,
    wait_ms: timing.waitMs,
  }
}

function buildFileDeltas(projectRoot: string, edits: OpenCodeFileEdit[] | undefined): FileDelta[] {
  if (!edits?.length) {
    return []
  }

  return edits.flatMap((edit) => {
    const absolutePath = path.isAbsolute(edit.path) ? edit.path : path.join(projectRoot, edit.path)
    const relativePath = path.relative(projectRoot, absolutePath)
    if (relativePath.startsWith('..')) {
      return []
    }

    return [{
      fingerprint: createFileFingerprint(absolutePath, projectRoot),
      language: guessLanguage(absolutePath),
      added: Math.max(edit.added ?? 0, 0),
      removed: Math.max(edit.removed ?? 0, 0),
    }]
  })
}

function mapOpenCodeEventName(input: string): string {
  return OPENCODE_EVENT_NAME_MAP[input] ?? toSnakeCase(input)
}

function toSnakeCase(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[.\-\s]+/g, '_')
    .toLowerCase()
}
