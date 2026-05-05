import path from 'node:path'
import fs from 'node:fs/promises'

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

export interface PlannedGeminiHookEvent {
  event: NormalizedActivityEvent
  commit: () => Promise<void>
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
const MAX_EXACT_LINE_DIFF_MATRIX_CELLS = 10_000_000
const MAX_STABLE_ANCHOR_POSITION_DRIFT = 128

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
    model_name: getOptionalNonBlankString(input.model) ?? 'unknown',
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
  const planned = await planGeminiHookEvent(input, options)
  if (!planned) {
    return null
  }

  await planned.commit()
  return planned.event
}

export async function planGeminiHookEvent(
  input: GeminiHookInput,
  options: BuildGeminiEventOptions,
): Promise<PlannedGeminiHookEvent | null> {
  const normalized = normalizeGeminiHookEvent(input)
  if (!normalized) {
    return null
  }

  const projectContext = await resolveProjectContext(input.cwd)
  const eventTime = getInputEventTime(input) ?? new Date().toISOString()
  const transition = await planSessionActivity({
    stateDir: options.stateDir,
    host: normalized.host,
    sessionId: normalized.session_id,
    projectRoot: projectContext.projectRoot,
    eventName: normalized.event_name,
    eventTime,
  })
  const fileDeltas = mergeFileDeltas(
    buildGeminiFileDeltas(input, normalized.event_name, projectContext.workspaceRoot),
  )

  return {
    event: {
      ...normalized,
      project_root: projectContext.projectRoot,
      project_name: projectContext.projectName,
      git_branch: projectContext.gitBranch,
      event_time: eventTime,
      active_ms: transition.activeMs,
      wait_ms: transition.waitMs,
      file_deltas: fileDeltas,
      language_stats: aggregateLanguages(fileDeltas),
    },
    commit: async (): Promise<void> => {
      await applySessionActivityTransition(transition)
    },
  }
}

export async function clearGeminiHookEventState(
  input: GeminiHookInput,
  options: BuildGeminiEventOptions,
): Promise<void> {
  const normalized = normalizeGeminiHookEvent(input)
  if (!normalized) {
    return
  }

  const projectContext = await resolveProjectContext(input.cwd)
  const eventTime = getInputEventTime(input) ?? new Date().toISOString()
  const transition = await planSessionActivity({
    stateDir: options.stateDir,
    host: normalized.host,
    sessionId: normalized.session_id,
    projectRoot: projectContext.projectRoot,
    eventName: normalized.event_name,
    eventTime,
  })

  await fs.rm(transition.statePath, { force: true })
}

function mapGeminiEventName(input: string): string | null {
  return GEMINI_EVENT_NAME_ALLOWLIST[input] ?? null
}

function getInputEventTime(input: GeminiHookInput): string | undefined {
  return getOptionalNonBlankString(input.event_time) ?? getOptionalNonBlankString(input.timestamp)
}

function buildGeminiFileDeltas(
  input: GeminiHookInput,
  eventName: string,
  projectRoot: string,
): FileDelta[] {
  if (eventName !== 'post_tool_use' || input.hook_event_name !== 'AfterTool') {
    return []
  }

  const toolName = getOptionalNonBlankString(input.tool_name) ?? ''
  const rawFilePath = getOptionalNonBlankString(input.tool_input?.file_path)
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

  if (shouldUseApproximateLineDiff(previousLines, currentLines)) {
    return countBoundedApproximateLineChanges(previousLines, currentLines)
  }

  return countExactLineChanges(previousLines, currentLines)
}

function shouldUseApproximateLineDiff(previousLines: string[], currentLines: string[]): boolean {
  return previousLines.length * currentLines.length > MAX_EXACT_LINE_DIFF_MATRIX_CELLS
}

function countBoundedApproximateLineChanges(
  previousLines: string[],
  currentLines: string[],
): { added: number, removed: number } {
  const sharedPrefixLength = countSharedPrefixLength(previousLines, currentLines)
  const sharedSuffixLength = countSharedSuffixLength(previousLines, currentLines, sharedPrefixLength)
  const trimmedPreviousLines = previousLines.slice(
    sharedPrefixLength,
    previousLines.length - sharedSuffixLength,
  )
  const trimmedCurrentLines = currentLines.slice(
    sharedPrefixLength,
    currentLines.length - sharedSuffixLength,
  )

  if (!trimmedPreviousLines.length || !trimmedCurrentLines.length) {
    return {
      added: trimmedCurrentLines.length,
      removed: trimmedPreviousLines.length,
    }
  }

  const anchors = findStableAnchors(trimmedPreviousLines, trimmedCurrentLines)
  if (!anchors.length) {
    return {
      added: trimmedCurrentLines.length,
      removed: trimmedPreviousLines.length,
    }
  }

  let added = 0
  let removed = 0
  let previousStart = 0
  let currentStart = 0

  for (const anchor of anchors) {
    const counts = countSegmentLineChanges(
      trimmedPreviousLines.slice(previousStart, anchor.previousIndex),
      trimmedCurrentLines.slice(currentStart, anchor.currentIndex),
    )
    added += counts.added
    removed += counts.removed
    previousStart = anchor.previousIndex + 1
    currentStart = anchor.currentIndex + 1
  }

  const tailCounts = countSegmentLineChanges(
    trimmedPreviousLines.slice(previousStart),
    trimmedCurrentLines.slice(currentStart),
  )
  added += tailCounts.added
  removed += tailCounts.removed

  return {
    added,
    removed,
  }
}

function countSegmentLineChanges(
  previousLines: string[],
  currentLines: string[],
): { added: number, removed: number } {
  if (!previousLines.length || !currentLines.length) {
    return {
      added: currentLines.length,
      removed: previousLines.length,
    }
  }

  if (!shouldUseApproximateLineDiff(previousLines, currentLines)) {
    return countExactLineChanges(previousLines, currentLines)
  }

  return countBoundedApproximateLineChanges(previousLines, currentLines)
}

function countExactLineChanges(
  previousLines: string[],
  currentLines: string[],
): { added: number, removed: number } {
  const commonLineCount = countLongestCommonSubsequence(previousLines, currentLines)

  return {
    added: Math.max(currentLines.length - commonLineCount, 0),
    removed: Math.max(previousLines.length - commonLineCount, 0),
  }
}

function countSharedPrefixLength(previousLines: string[], currentLines: string[]): number {
  const limit = Math.min(previousLines.length, currentLines.length)
  let index = 0

  while (index < limit && previousLines[index] === currentLines[index]) {
    index += 1
  }

  return index
}

function countSharedSuffixLength(
  previousLines: string[],
  currentLines: string[],
  sharedPrefixLength: number,
): number {
  const limit = Math.min(previousLines.length, currentLines.length) - sharedPrefixLength
  let index = 0

  while (
    index < limit
    && previousLines[previousLines.length - 1 - index] === currentLines[currentLines.length - 1 - index]
  ) {
    index += 1
  }

  return index
}

function findStableAnchors(
  previousLines: string[],
  currentLines: string[],
): Array<{ previousIndex: number, currentIndex: number }> {
  const previousCounts = countLineOccurrences(previousLines)
  const currentCounts = countLineOccurrences(currentLines)
  const currentPositions = new Map<string, number>()

  for (const [index, line] of currentLines.entries()) {
    if (currentCounts.get(line) === 1) {
      currentPositions.set(line, index)
    }
  }

  const anchors: Array<{ previousIndex: number, currentIndex: number }> = []
  let lastCurrentIndex = -1

  for (const [previousIndex, line] of previousLines.entries()) {
    if (previousCounts.get(line) !== 1 || currentCounts.get(line) !== 1) {
      continue
    }

    const currentIndex = currentPositions.get(line)
    if (currentIndex === undefined) {
      continue
    }

    if (currentIndex <= lastCurrentIndex) {
      continue
    }

    if (Math.abs(previousIndex - currentIndex) > MAX_STABLE_ANCHOR_POSITION_DRIFT) {
      continue
    }

    anchors.push({ previousIndex, currentIndex })
    lastCurrentIndex = currentIndex
  }

  return anchors
}

function countLineOccurrences(lines: string[]): Map<string, number> {
  const counts = new Map<string, number>()

  for (const line of lines) {
    counts.set(line, (counts.get(line) ?? 0) + 1)
  }

  return counts
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

function getOptionalNonBlankString(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined
  }

  return value
}
