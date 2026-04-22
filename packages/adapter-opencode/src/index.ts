import path from 'node:path'

import {
  aggregateLanguages,
  applySessionActivityTransition,
  createFileFingerprint,
  guessLanguage,
  mergeFileDeltas,
  planSessionActivity,
  resolveProjectContext,
  type FileDelta,
  type NormalizedActivityEvent,
  type PreparedAdapterEvent,
} from '@clipulse/collector-core'

export interface OpenCodeFileEdit {
  path: string
  added?: number
  removed?: number
  additions?: number
  deletions?: number
}

export interface OpenCodeEventInput {
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

export interface PreparedOpenCodeEvent extends PreparedAdapterEvent {
  event: NormalizedActivityEvent
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
  const deltas = mergeFileDeltas(buildFileDeltas(input.cwd, input.cwd, input.file_edits))

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
  const prepared = await prepareOpenCodeEvent(input, options)

  await prepared.commit()

  return prepared.event
}

export async function prepareOpenCodeEvent(
  input: OpenCodeEventInput,
  options: BuildOpenCodeEventOptions,
): Promise<PreparedOpenCodeEvent> {
  const projectContext = await resolveProjectContext(input.cwd)
  const normalized = normalizeOpenCodeEvent(input)
  const eventTime = input.event_time ?? new Date().toISOString()
  const timingTransition = await planSessionActivity({
    stateDir: options.stateDir,
    host: normalized.host,
    sessionId: normalized.session_id,
    projectRoot: projectContext.projectRoot,
    eventName: normalized.event_name,
    eventTime,
  })
  const fileDeltas = mergeFileDeltas(
    buildFileDeltas(input.cwd, projectContext.workspaceRoot, input.file_edits),
  )

  return {
    event: {
      ...normalized,
      project_root: projectContext.projectRoot,
      project_name: projectContext.projectName,
      git_branch: projectContext.gitBranch,
      event_time: eventTime,
      active_ms: timingTransition.activeMs,
      wait_ms: timingTransition.waitMs,
      file_deltas: fileDeltas,
      language_stats: aggregateLanguages(fileDeltas),
    },
    commit: async (): Promise<void> => {
      await applySessionActivityTransition(timingTransition)
    },
  }
}

export function isPathInsideProjectRoot(projectRoot: string, absolutePath: string): boolean {
  const relativePath = path.relative(projectRoot, absolutePath)
  return !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
}

function buildFileDeltas(
  cwd: string,
  projectRoot: string,
  edits: OpenCodeFileEdit[] | undefined,
): FileDelta[] {
  if (!edits?.length) {
    return []
  }

  return edits.flatMap((edit) => {
    const absolutePath = path.isAbsolute(edit.path)
      ? path.normalize(edit.path)
      : path.resolve(cwd, edit.path)
    if (!isPathInsideProjectRoot(projectRoot, absolutePath)) {
      return []
    }

    return [{
      fingerprint: createFileFingerprint(absolutePath, projectRoot),
      language: guessLanguage(absolutePath),
      added: Math.max(resolveFileEditCount(edit.added, edit.additions), 0),
      removed: Math.max(resolveFileEditCount(edit.removed, edit.deletions), 0),
    }]
  })
}

function resolveFileEditCount(primary: number | undefined, fallback: number | undefined): number {
  return primary ?? fallback ?? 0
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
