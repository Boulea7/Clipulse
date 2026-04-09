import path from 'node:path'

import {
  resolveProjectContext,
  trackSessionActivity,
  type NormalizedActivityEvent,
} from '@clipulse/collector-core'

interface GeminiHookInput {
  session_id: string
  cwd: string
  hook_event_name: string
  model?: string
  event_time?: string
  tool_name?: string
}

interface BuildGeminiEventOptions {
  stateDir: string
}

const GEMINI_EVENT_NAME_MAP: Record<string, string> = {
  after_agent: 'post_tool_use',
  after_model: 'post_tool_use',
  after_tool: 'post_tool_use',
  after_tool_failure: 'post_tool_use_failure',
  before_agent: 'pre_tool_use',
  before_model: 'pre_tool_use',
  before_tool: 'pre_tool_use',
  session_end: 'session_end',
  session_start: 'session_start',
  user_prompt_submit: 'user_prompt_submit',
}

export function normalizeGeminiHookEvent(
  input: GeminiHookInput,
): NormalizedActivityEvent {
  return {
    host: 'gemini-cli',
    host_version: 'unknown',
    session_id: input.session_id,
    project_root: input.cwd,
    project_name: path.basename(input.cwd),
    git_branch: 'unknown',
    event_name: mapGeminiEventName(input.hook_event_name),
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

export async function buildGeminiHookEvent(
  input: GeminiHookInput,
  options: BuildGeminiEventOptions,
): Promise<NormalizedActivityEvent> {
  const normalized = normalizeGeminiHookEvent(input)
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

function mapGeminiEventName(input: string): string {
  const snakeCase = toSnakeCase(input)
  return GEMINI_EVENT_NAME_MAP[snakeCase] ?? snakeCase
}

function toSnakeCase(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[.\-\s]+/g, '_')
    .toLowerCase()
}
