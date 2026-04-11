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

interface GeminiToolInput {
  content?: string
  file_path?: string
  new_string?: string
  old_string?: string
  [key: string]: unknown
}

export interface GeminiHookInput {
  session_id: string
  cwd: string
  hook_event_name: string
  model?: string
  event_time?: string
  timestamp?: string
  prompt?: string
  tool_name?: string
  tool_input?: GeminiToolInput
}

interface BuildGeminiEventOptions {
  stateDir: string
}

const GEMINI_EVENT_NAME_ALLOWLIST: Record<string, string> = {
  AfterAgent: 'after_agent',
  AfterTool: 'post_tool_use',
  AfterToolFailure: 'post_tool_use_failure',
  BeforeAgent: 'user_prompt_submit',
  BeforeTool: 'pre_tool_use',
  SessionEnd: 'session_end',
  SessionStart: 'session_start',
  UserPromptSubmit: 'user_prompt_submit',
}

export function normalizeGeminiHookEvent(
  input: GeminiHookInput,
): NormalizedActivityEvent | null {
  const eventName = mapGeminiEventName(input.hook_event_name)
  if (!eventName) {
    return null
  }

  return {
    host: 'gemini-cli',
    host_version: 'unknown',
    session_id: input.session_id,
    project_root: input.cwd,
    project_name: path.basename(input.cwd),
    git_branch: 'unknown',
    event_name: eventName,
    event_time: getInputEventTime(input) ?? new Date(0).toISOString(),
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
): Promise<NormalizedActivityEvent | null> {
  const normalized = normalizeGeminiHookEvent(input)
  if (!normalized) {
    return null
  }

  const projectContext = await resolveProjectContext(input.cwd)
  const eventTime = getInputEventTime(input) ?? new Date().toISOString()
  const timing = await trackSessionActivity({
    stateDir: options.stateDir,
    host: normalized.host,
    sessionId: normalized.session_id,
    projectRoot: projectContext.projectRoot,
    eventName: normalized.event_name,
    eventTime,
  })
  const fileDeltas = mergeFileDeltas(
    buildGeminiFileDeltas(input, normalized.event_name, projectContext.projectRoot),
  )

  return {
    ...normalized,
    project_root: projectContext.projectRoot,
    project_name: projectContext.projectName,
    git_branch: projectContext.gitBranch,
    event_time: eventTime,
    active_ms: timing.activeMs,
    wait_ms: timing.waitMs,
    file_deltas: fileDeltas,
    language_stats: aggregateLanguages(fileDeltas),
  }
}

function mapGeminiEventName(input: string): string | null {
  return GEMINI_EVENT_NAME_ALLOWLIST[input] ?? null
}

function getInputEventTime(input: GeminiHookInput): string | undefined {
  return input.event_time ?? input.timestamp
}

function buildGeminiFileDeltas(
  input: GeminiHookInput,
  eventName: string,
  projectRoot: string,
): FileDelta[] {
  if (eventName !== 'post_tool_use' || input.hook_event_name !== 'AfterTool') {
    return []
  }

  const toolName = input.tool_name ?? ''
  const rawFilePath = getStringValue(input.tool_input?.file_path)
  if (!rawFilePath) {
    return []
  }

  const relativePath = resolveProjectRelativePath(input.cwd, projectRoot, rawFilePath)
  if (!relativePath) {
    return []
  }

  if (toolName === 'write_file') {
    const content = getStringValue(input.tool_input?.content) ?? ''
    const counts = countLineChanges('', content)
    return [createGeminiFileDelta(projectRoot, relativePath, counts.added, counts.removed)]
  }

  if (toolName === 'replace') {
    const oldString = getStringValue(input.tool_input?.old_string) ?? ''
    const newString = getStringValue(input.tool_input?.new_string) ?? ''
    const counts = countLineChanges(oldString, newString)
    return [createGeminiFileDelta(projectRoot, relativePath, counts.added, counts.removed)]
  }

  return []
}

function createGeminiFileDelta(
  projectRoot: string,
  relativePath: string,
  added: number,
  removed: number,
): FileDelta {
  const absolutePath = path.join(projectRoot, relativePath)

  return {
    fingerprint: createFileFingerprint(absolutePath, projectRoot),
    language: guessLanguage(absolutePath),
    added,
    removed,
  }
}

function resolveProjectRelativePath(
  cwd: string,
  projectRoot: string,
  rawFilePath: string,
): string | null {
  const absolutePath = path.isAbsolute(rawFilePath)
    ? rawFilePath
    : path.join(cwd, rawFilePath)
  const relativePath = path.relative(projectRoot, absolutePath)

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return null
  }

  return relativePath.split(path.sep).join('/')
}

function countLineChanges(previousContent: string, currentContent: string): { added: number, removed: number } {
  const previousLines = splitLines(previousContent)
  const currentLines = splitLines(currentContent)
  const commonLineCount = countLongestCommonSubsequence(previousLines, currentLines)
  const added = Math.max(currentLines.length - commonLineCount, 0)
  const removed = Math.max(previousLines.length - commonLineCount, 0)

  return {
    added,
    removed,
  }
}

function countLongestCommonSubsequence(previousLines: string[], currentLines: string[]): number {
  if (!previousLines.length || !currentLines.length) {
    return 0
  }

  const previousCounts = new Array<number>(currentLines.length + 1).fill(0)

  for (let previousIndex = 1; previousIndex <= previousLines.length; previousIndex += 1) {
    let diagonal = 0

    for (let currentIndex = 1; currentIndex <= currentLines.length; currentIndex += 1) {
      const nextDiagonal = previousCounts[currentIndex]
      if (previousLines[previousIndex - 1] === currentLines[currentIndex - 1]) {
        previousCounts[currentIndex] = diagonal + 1
      } else {
        previousCounts[currentIndex] = Math.max(previousCounts[currentIndex], previousCounts[currentIndex - 1])
      }
      diagonal = nextDiagonal
    }
  }

  return previousCounts[currentLines.length] ?? 0
}

function splitLines(content: string): string[] {
  if (!content) {
    return []
  }

  return content.replace(/\r\n/g, '\n').split('\n').filter((line, index, lines) => (
    line.length > 0 || index < lines.length - 1
  ))
}

function getStringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
