import path from 'node:path'

import {
  aggregateLanguages,
  captureProjectSnapshotDeltas,
  guessLanguage,
  mergeFileDeltas,
  resolveProjectContext,
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
  const projectContext = await resolveProjectContext(input.cwd)
  const eventTime = input.event_time ?? new Date().toISOString()
  const timing = await trackSessionActivity({
    stateDir: options.stateDir,
    host: normalized.host,
    sessionId: normalized.session_id,
    projectRoot: projectContext.projectRoot,
    eventName: normalized.event_name,
    eventTime,
  })
  const candidatePaths = shouldNarrowSnapshot(normalized.event_name)
    ? extractCandidatePaths(
        projectContext.projectRoot,
        input.tool_name,
        input.tool_input?.command,
      )
    : undefined
  const snapshotDeltas = shouldCaptureProjectSnapshot(normalized.event_name)
    ? await captureProjectSnapshotDeltas({
        stateDir: options.stateDir,
        host: normalized.host,
        sessionId: normalized.session_id,
        projectRoot: projectContext.projectRoot,
        candidatePaths,
        clearAfterCapture: shouldClearSnapshot(normalized.event_name),
      })
    : []
  const mergedDeltas = mergeFileDeltas(snapshotDeltas)

  return {
    ...normalized,
    project_root: projectContext.projectRoot,
    project_name: projectContext.projectName,
    git_branch: projectContext.gitBranch,
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

function shouldNarrowSnapshot(eventName: string): boolean {
  return eventName === 'post_tool_use' || eventName === 'stop'
}

function shouldClearSnapshot(eventName: string): boolean {
  return eventName === 'stop'
}

function extractCandidatePaths(
  projectRoot: string,
  toolName?: string,
  command?: string,
): string[] | undefined {
  if (toolName !== 'Bash' || !command) {
    return undefined
  }

  if (shouldFallbackToFullSnapshot(command)) {
    return undefined
  }

  const tokens = command.match(/"[^"]+"|'[^']+'|\S+/g) ?? []
  const candidates = tokens
    .map(sanitizeCandidateToken)
    .filter((token) => token.length > 0)
    .filter((token) => !/[;&|<>]/.test(token))
    .filter((token) => !token.startsWith('-'))
    .filter((token) => !token.includes('='))
    .filter((token) => token.includes('/') || token.includes('.') || guessLanguage(token) !== 'Unknown')
    .filter((token) => !token.startsWith('http://') && !token.startsWith('https://'))
    .map((token) => {
      const absolute = path.isAbsolute(token) ? token : path.join(projectRoot, token)
      const relative = path.relative(projectRoot, absolute)
      return relative.startsWith('..') ? null : relative.split(path.sep).join('/')
    })
    .filter((token): token is string => token !== null && token.length > 0)

  return candidates.length > 0 ? [...new Set(candidates)] : undefined
}

function shouldFallbackToFullSnapshot(command: string): boolean {
  return /(?:&&|\|\||\||<|>|\$\(|`)/.test(command)
}

function sanitizeCandidateToken(token: string): string {
  return token
    .replace(/^['"]|['"]$/g, '')
    .replace(/^[([{]+/, '')
    .replace(/[)\]},:;]+$/, '')
    .replace(/(?:&&|\|\|)+$/, '')
}
