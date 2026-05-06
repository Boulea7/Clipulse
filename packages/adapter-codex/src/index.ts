import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import {
  applyProjectSnapshotTransition,
  applySessionActivityTransition,
  aggregateLanguages,
  guessLanguage,
  mergeFileDeltas,
  planProjectSnapshotDeltas,
  planSessionActivity,
  resolveProjectContext,
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
  suppressFinalizedTerminalRetries?: boolean
}

interface CodexHookBuildResult {
  event: NormalizedActivityEvent | null
  commitState: () => Promise<void>
}

interface SnapshotCapturePlan {
  shouldCapture: boolean
  discardDeltas: boolean
  clearAfterCapture: boolean
  candidatePaths?: string[]
}

type TerminalFinalizerEventName = 'stop' | 'stop_failure' | 'session_end'

interface FinalizedTerminalState {
  schemaVersion: 1
  eventName: TerminalFinalizerEventName
  eventTime: string
}

const MAX_SHELL_UNWRAP_DEPTH = 8
const CLEARLY_READ_ONLY_CODEX_TOOLS = new Set([
  'Glob',
  'Grep',
  'LS',
  'ReadFile',
])
const TERMINAL_FINALIZER_RANKS: Record<TerminalFinalizerEventName, number> = {
  stop: 1,
  stop_failure: 1,
  session_end: 2,
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
  const result = await buildCodexHookEventResult(input, options)
  await result.commitState()
  if (!result.event) {
    throw new Error('Codex hook event was already finalized.')
  }
  return result.event
}

export async function buildCodexHookEventResult(
  input: CodexHookInput,
  options: BuildCodexEventOptions,
): Promise<CodexHookBuildResult> {
  const normalized = normalizeCodexHookEvent(input)
  const projectContext = await resolveProjectContext(input.cwd)
  const eventTime = input.event_time ?? new Date().toISOString()
  if (options.suppressFinalizedTerminalRetries && isTerminalEvent(normalized.event_name)) {
    const terminalStatePath = getFinalizedTerminalStatePath(
      options.stateDir,
      normalized.host,
      normalized.session_id,
      projectContext.projectRoot,
    )
    const finalizedTerminalState = await readFinalizedTerminalState(terminalStatePath)
    if (isSupersededTerminalRetry(finalizedTerminalState, normalized.event_name, eventTime)) {
      return {
        event: null,
        commitState: async () => {},
      }
    }
  }
  const timing = await planSessionActivity({
    stateDir: options.stateDir,
    host: normalized.host,
    sessionId: normalized.session_id,
    projectRoot: projectContext.projectRoot,
    eventName: normalized.event_name,
    eventTime,
  })
  const snapshotPlan = createSnapshotCapturePlan(
    normalized.event_name,
    input,
    projectContext.workspaceRoot,
  )
  const snapshotDeltas = snapshotPlan.shouldCapture
    ? await planProjectSnapshotDeltas({
        stateDir: options.stateDir,
        host: normalized.host,
        sessionId: normalized.session_id,
        projectRoot: projectContext.workspaceRoot,
        candidatePaths: snapshotPlan.candidatePaths,
        clearAfterCapture: snapshotPlan.clearAfterCapture,
      })
    : null
  const mergedDeltas = snapshotPlan.discardDeltas
    ? []
    : mergeFileDeltas(snapshotDeltas?.deltas ?? [])

  return {
    event: {
      ...normalized,
      project_root: projectContext.projectRoot,
      project_name: projectContext.projectName,
      git_branch: projectContext.gitBranch,
      event_time: eventTime,
      active_ms: timing.activeMs,
      wait_ms: timing.waitMs,
      file_deltas: mergedDeltas,
      language_stats: aggregateLanguages(mergedDeltas),
    },
    commitState: async () => {
      await applySessionActivityTransition(timing)
      if (snapshotDeltas) {
        await applyProjectSnapshotTransition(snapshotDeltas)
      }
      if (options.suppressFinalizedTerminalRetries && isTerminalEvent(normalized.event_name)) {
        await writeFinalizedTerminalState(
          getFinalizedTerminalStatePath(
            options.stateDir,
            normalized.host,
            normalized.session_id,
            projectContext.projectRoot,
          ),
          normalized.event_name,
          eventTime,
        )
      }
    },
  }
}

function toSnakeCase(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase()
}

function shouldCaptureProjectSnapshot(eventName: string): boolean {
  return (
    eventName === 'session_start'
    || eventName === 'post_tool_use'
    || eventName === 'post_tool_use_failure'
    || eventName === 'stop'
    || eventName === 'stop_failure'
    || eventName === 'session_end'
  )
}

function shouldNarrowSnapshot(eventName: string): boolean {
  return (
    eventName === 'post_tool_use'
    || eventName === 'post_tool_use_failure'
    || eventName === 'stop'
    || eventName === 'stop_failure'
  )
}

function shouldClearSnapshot(eventName: string): boolean {
  return eventName === 'stop' || eventName === 'stop_failure' || eventName === 'session_end'
}

function isTerminalEvent(eventName: string): eventName is TerminalFinalizerEventName {
  return eventName === 'stop' || eventName === 'stop_failure' || eventName === 'session_end'
}

function getFinalizedTerminalStatePath(
  stateDir: string,
  host: string,
  sessionId: string,
  projectRoot: string,
): string {
  const stateKey = [host, sessionId, projectRoot].join(':')
  const fileName = `${host}-${createHash('sha1').update(stateKey).digest('hex')}.json`
  return path.join(stateDir, 'terminal-finalizers', fileName)
}

async function readFinalizedTerminalState(
  statePath: string,
): Promise<FinalizedTerminalState | null> {
  let raw: string
  try {
    raw = await fs.readFile(statePath, 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }

    return null
  }

  try {
    const parsed = JSON.parse(raw) as Partial<FinalizedTerminalState>
    if (
      parsed?.schemaVersion === 1
      && typeof parsed.eventName === 'string'
      && isTerminalEvent(parsed.eventName)
      && typeof parsed.eventTime === 'string'
    ) {
      return {
        schemaVersion: 1,
        eventName: parsed.eventName,
        eventTime: parsed.eventTime,
      }
    }
  } catch {
    return null
  }

  return null
}

function isSupersededTerminalRetry(
  finalizedState: FinalizedTerminalState | null,
  eventName: TerminalFinalizerEventName,
  eventTime: string,
): boolean {
  if (!finalizedState) {
    return false
  }

  const finalizedTime = Date.parse(finalizedState.eventTime)
  const currentTime = Date.parse(eventTime)
  if (Number.isFinite(finalizedTime) && Number.isFinite(currentTime)) {
    if (currentTime < finalizedTime) {
      return true
    }
    if (currentTime > finalizedTime) {
      return false
    }
    return terminalFinalizerRank(eventName) <= terminalFinalizerRank(finalizedState.eventName)
  }

  return eventTime === finalizedState.eventTime
    && terminalFinalizerRank(eventName) <= terminalFinalizerRank(finalizedState.eventName)
}

function terminalFinalizerRank(eventName: TerminalFinalizerEventName): number {
  return TERMINAL_FINALIZER_RANKS[eventName]
}

async function writeFinalizedTerminalState(
  statePath: string,
  eventName: TerminalFinalizerEventName,
  eventTime: string,
): Promise<void> {
  await fs.mkdir(path.dirname(statePath), { recursive: true })
  await fs.writeFile(
    statePath,
    JSON.stringify({
      schemaVersion: 1,
      eventName,
      eventTime,
    }),
    'utf-8',
  )
}

function createSnapshotCapturePlan(
  eventName: string,
  input: CodexHookInput,
  projectRoot: string,
): SnapshotCapturePlan {
  if (!shouldCaptureProjectSnapshot(eventName)) {
    return {
      shouldCapture: false,
      discardDeltas: false,
      clearAfterCapture: false,
    }
  }

  if (isClearlyReadOnlyToolEvent(eventName, input.tool_name, input.tool_input?.command)) {
    return {
      shouldCapture: true,
      discardDeltas: true,
      clearAfterCapture: false,
    }
  }

  const candidatePaths = shouldNarrowSnapshot(eventName)
    ? extractCandidatePaths(
        input.cwd,
        projectRoot,
        input.tool_name,
        input.tool_input?.command,
      )
    : undefined

  return {
    shouldCapture: true,
    discardDeltas: false,
    clearAfterCapture: shouldClearSnapshot(eventName),
    candidatePaths,
  }
}

function isClearlyReadOnlyToolEvent(
  eventName: string,
  toolName?: string,
  command?: string,
): boolean {
  if (eventName !== 'post_tool_use' && eventName !== 'post_tool_use_failure') {
    return false
  }

  if (toolName && CLEARLY_READ_ONLY_CODEX_TOOLS.has(toolName)) {
    return true
  }

  if (toolName !== 'Bash' || !command) {
    return false
  }

  const tokens = parseBashCommandTokens(command)
  if (!tokens) {
    return false
  }

  return classifyBashWriteIntent(tokens) === 'non_write'
}

function extractCandidatePaths(
  cwd: string,
  projectRoot: string,
  toolName?: string,
  command?: string,
): string[] | undefined {
  if (toolName !== 'Bash' || !command) {
    return undefined
  }

  const tokens = parseBashCommandTokens(command)
  if (!tokens) {
    return undefined
  }

  if (classifyBashWriteIntent(tokens) === 'non_write') {
    return undefined
  }

  const candidates = tokens
    .filter((token) => !/[;&|<>]/.test(token))
    .filter((token) => !token.startsWith('-'))
    .filter((token) => !token.includes('='))
    .filter((token) => token.includes('/') || token.includes('.') || guessLanguage(token) !== 'Unknown')
    .filter((token) => !token.startsWith('http://') && !token.startsWith('https://'))
    .map((token) => {
      const absolute = path.isAbsolute(token) ? token : path.join(cwd, token)
      const relative = path.relative(projectRoot, absolute)
      return relative.startsWith('..') ? null : relative.split(path.sep).join('/')
    })
    .filter((token): token is string => token !== null && token.length > 0)

  return candidates.length > 0 ? [...new Set(candidates)] : undefined
}

function parseBashCommandTokens(command: string): string[] | null {
  const normalizedCommand = unwrapShellCommand(command)
  if (shouldFallbackToFullSnapshot(normalizedCommand)) {
    return null
  }

  const tokens = (normalizedCommand.match(/"[^"]+"|'[^']+'|\S+/g) ?? [])
    .map(sanitizeCandidateToken)
    .filter((token) => token.length > 0)

  if (shouldForceBroadSnapshotFallback(tokens)) {
    return null
  }

  return tokens
}

function unwrapShellCommand(command: string): string {
  let currentCommand = command.trim()

  for (let depth = 0; depth < MAX_SHELL_UNWRAP_DEPTH; depth += 1) {
    const rawTokens = currentCommand.match(/"[^"]+"|'[^']+'|\S+/g) ?? []
    const tokens = rawTokens.map((token) => token.replace(/^['"]|['"]$/g, ''))
    const commandName = getCommandName(tokens[0])

    if (!tokens.length) {
      return currentCommand
    }

    if (commandName === 'env') {
      const firstCommandIndex = tokens.findIndex((token, index) => (
        index > 0 && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)
      ))
      if (firstCommandIndex <= 0) {
        return currentCommand
      }
      currentCommand = rawTokens.slice(firstCommandIndex).join(' ')
      continue
    }

    if (['command', 'builtin', 'noglob'].includes(commandName)) {
      currentCommand = rawTokens.slice(1).join(' ')
      continue
    }

    if (
      ['bash', 'sh', 'zsh'].includes(commandName)
      && tokens[1] === '-lc'
      && rawTokens.length === 3
    ) {
      currentCommand = rawTokens[2]!.replace(/^['"]|['"]$/g, '')
      continue
    }

    return currentCommand
  }

  return currentCommand
}

function shouldFallbackToFullSnapshot(command: string): boolean {
  return /(?:&&|\|\||\||<|>|\$\(|`|[();]|\r?\n|\\\s)/.test(command)
}

function classifyBashWriteIntent(tokens: string[]): 'non_write' | 'maybe_write' {
  const commandName = getCommandName(tokens[0])
  const subCommand = tokens[1]

  if (!commandName) {
    return 'maybe_write'
  }

  if (commandName === 'git' && subCommand && [
    'branch',
    'diff',
    'grep',
    'log',
    'ls-files',
    'rev-parse',
    'show',
    'status',
  ].includes(subCommand)) {
    return 'non_write'
  }

  if ([
    'awk',
    'cat',
    'cut',
    'diff',
    'find',
    'grep',
    'head',
    'less',
    'ls',
    'pwd',
    'sort',
    'stat',
    'tail',
    'tree',
    'uniq',
    'wc',
  ].includes(commandName)) {
    return 'non_write'
  }

  if (commandName === 'sed' && !tokens.some((token) => token === '-i' || token.startsWith('-i'))) {
    return 'non_write'
  }

  return 'maybe_write'
}

function shouldForceBroadSnapshotFallback(tokens: string[]): boolean {
  const commandName = getCommandName(tokens[0])
  const subCommand = tokens[1]

  if (!commandName) {
    return false
  }

  if (
    (commandName === 'cmd' && subCommand === '/c')
    || ((commandName === 'powershell' || commandName === 'pwsh') && subCommand === '-Command')
    || (commandName === 'sh' && subCommand === '-c')
  ) {
    return true
  }

  if (isPythonCommand(commandName) && subCommand === '-m') {
    return true
  }

  if (commandName === 'cp' && tokens.some((token) => /^-[A-Za-z]*[rR][A-Za-z]*$/.test(token))) {
    return true
  }

  if (
    commandName === 'find'
    && tokens.some((token) =>
      token === '-exec'
      || token === '-execdir'
      || token === '-ok'
      || token === '-okdir')
  ) {
    return true
  }

  if (commandName === 'perl' && tokens.some((token) => /^-[A-Za-z0-9.]*i[A-Za-z0-9.]*$/.test(token))) {
    return true
  }

  if (commandName === 'sort' && tokens.includes('-o')) {
    return true
  }

  return commandName === 'tar'
    || commandName === 'unzip'
    || commandName === 'rsync'
    || commandName === 'xargs'
    || commandName === 'install'
}

function sanitizeCandidateToken(token: string): string {
  return token
    .replace(/^['"]|['"]$/g, '')
    .replace(/^[([{]+/, '')
    .replace(/[)\]},:;]+$/, '')
    .replace(/(?:&&|\|\|)+$/, '')
}

function getCommandName(token?: string): string {
  if (!token) {
    return ''
  }

  return (token.split(/[\\/]/).at(-1) ?? token)
    .replace(/\.(?:exe|cmd|bat)$/i, '')
}

function isPythonCommand(commandName: string): boolean {
  return /^python(?:\d+(?:\.\d+)*)?$/.test(commandName)
}
