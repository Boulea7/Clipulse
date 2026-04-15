import path from 'node:path'

import { runOpenCodePlugin } from '../dist/plugin.js'

interface SessionCreatedEvent {
  type: 'session.created'
  properties?: {
    info?: {
      id?: string
    }
    sessionID?: string
  }
}

interface SessionLifecycleEvent {
  type: 'session.deleted' | 'session.idle' | 'session.error'
  properties?: {
    info?: {
      id?: string
    }
    sessionID?: string
  }
}

interface FileEditedEvent {
  type: 'file.edited'
  properties?: {
    file?: string
    sessionID?: string
  }
}

interface SessionDiffEntry {
  file?: string
  path?: string
  added?: number
  removed?: number
  additions?: number
  deletions?: number
}

interface SessionDiffEvent {
  type: 'session.diff'
  properties?: {
    info?: {
      id?: string
    }
    sessionID?: string
    diff?: SessionDiffEntry[]
  }
}

interface OpenCodeEventEnvelope {
  type: string
  properties?: {
    [key: string]: unknown
  }
}

interface ToolHookInput {
  sessionID?: string
}

interface CreateClipulsePluginOptions {
  runPlugin?: typeof runOpenCodePlugin
}

interface RunClipulseSmokeScenarioInput {
  directory?: string
  diffMode?: 'default' | 'gated-session-diff'
  scenario?: 'default' | 'gated-session-diff'
  topology?: 'shared-project' | 'split-project'
  worktree?: string
}

interface BufferedDiffEdit {
  additions: number
  deletions: number
  path: string
}

interface BufferedSessionPhase {
  diffByPath: Map<string, BufferedDiffEdit>
  seenFileEditedPaths: Set<string>
}

export function createClipulsePlugin(
  options: CreateClipulsePluginOptions = {},
) {
  const runPlugin = options.runPlugin ?? runOpenCodePlugin

  return async function ClipulsePlugin(
    input: {
      directory?: string
      worktree?: string
    },
  ) {
    const cwd = normalizeOptionalPath(input.worktree)
      ?? normalizeOptionalPath(input.directory)
      ?? process.cwd()
    const projectRoot = resolveWrapperProjectRoot(input.directory, input.worktree, cwd)
    const bufferedPhases = new Map<string, BufferedSessionPhase>()
    const closedSessionIds = new Set<string>()
    const liveSessionIds = new Set<string>()

    const forward = async (payload: Record<string, unknown>): Promise<void> => {
      await runPlugin({
        env: process.env,
        readStdin: async () => JSON.stringify(payload),
        stdout: process.stdout,
      })
    }

    const isSessionDiffEnabled = parseBooleanFlag(process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF)

    const getBufferedPhase = (sessionId: string): BufferedSessionPhase => {
      let phase = bufferedPhases.get(sessionId)
      if (!phase) {
        phase = {
          diffByPath: new Map<string, BufferedDiffEdit>(),
          seenFileEditedPaths: new Set<string>(),
        }
        bufferedPhases.set(sessionId, phase)
      }
      return phase
    }

    const resolveSingleLiveSessionId = (): string | null => {
      if (liveSessionIds.size !== 1) {
        return null
      }

      return [...liveSessionIds][0] ?? null
    }

    const resolveOwnedSessionId = (explicitSessionId: string | null): string | null => {
      return explicitSessionId ?? resolveSingleLiveSessionId()
    }

    const markSessionActive = (sessionId: string): void => {
      closedSessionIds.delete(sessionId)
      liveSessionIds.add(sessionId)
    }

    const flushBufferedSessionDiff = async (sessionId: string): Promise<void> => {
      const phase = bufferedPhases.get(sessionId)
      if (!phase) {
        return
      }

      const fileEdits = [...phase.diffByPath.entries()]
        .filter(([dedupePath]) => !phase.seenFileEditedPaths.has(dedupePath))
        .map(([, edit]) => ({
          path: edit.path,
          additions: edit.additions,
          deletions: edit.deletions,
        }))

      if (!fileEdits.length) {
        bufferedPhases.delete(sessionId)
        return
      }

      await forward({
        session_id: sessionId,
        cwd,
        event_name: 'file.edited',
        file_edits: fileEdits,
      })
      bufferedPhases.delete(sessionId)
    }

    return {
      event: async ({ event }: { event: OpenCodeEventEnvelope }) => {
        if (event.type === 'session.created') {
          const sessionId = resolveSessionIdFromCreatedEvent(event as SessionCreatedEvent)
          if (!sessionId) {
            return
          }
          markSessionActive(sessionId)
          bufferedPhases.delete(sessionId)
          await forward({
            session_id: sessionId,
            cwd,
            event_name: event.type,
          })
          return
        }

        if (event.type === 'session.diff') {
          if (!isSessionDiffEnabled) {
            return
          }

          const sessionId = resolveOwnedSessionId(
            resolveSessionIdFromSessionDiffEvent(event as SessionDiffEvent),
          )
          if (!sessionId) {
            return
          }

          closedSessionIds.delete(sessionId)
          const bufferedPhase = getBufferedPhase(sessionId)
          for (const diffEntry of extractBufferedDiffEdits(projectRoot, cwd, event as SessionDiffEvent)) {
            bufferedPhase.diffByPath.set(toBufferedPathKey(cwd, diffEntry.path), diffEntry)
          }
          return
        }

        if (event.type === 'session.deleted' || event.type === 'session.idle' || event.type === 'session.error') {
          const sessionId = resolveSessionIdFromLifecycleEvent(event as SessionLifecycleEvent)
          if (!sessionId) {
            return
          }
          if (closedSessionIds.has(sessionId)) {
            liveSessionIds.delete(sessionId)
            return
          }
          await flushBufferedSessionDiff(sessionId)
          await forward({
            session_id: sessionId,
            cwd,
            event_name: event.type,
          })
          closedSessionIds.add(sessionId)
          liveSessionIds.delete(sessionId)
          return
        }

        if (event.type === 'file.edited') {
          const sessionId = resolveOwnedSessionId(
            resolveSessionIdFromFileEditedEvent(event as FileEditedEvent),
          )
          const filePath = sanitizeBridgePath(projectRoot, cwd, event.properties?.file)
          if (typeof filePath !== 'string' || !sessionId) {
            return
          }
          closedSessionIds.delete(sessionId)
          liveSessionIds.add(sessionId)
          await forward({
            session_id: sessionId,
            cwd,
            event_name: event.type,
            file_edits: [{ path: filePath }],
          })
          if (isSessionDiffEnabled) {
            getBufferedPhase(sessionId).seenFileEditedPaths.add(toBufferedPathKey(cwd, filePath))
          }
        }
      },
      'tool.execute.before': async (hookInput: ToolHookInput) => {
        if (!hookInput.sessionID) {
          return
        }
        markSessionActive(hookInput.sessionID)
        await forward({
          session_id: hookInput.sessionID,
          cwd,
          event_name: 'tool.execute.before',
        })
      },
      'tool.execute.after': async (hookInput: ToolHookInput) => {
        if (!hookInput.sessionID) {
          return
        }
        markSessionActive(hookInput.sessionID)
        await forward({
          session_id: hookInput.sessionID,
          cwd,
          event_name: 'tool.execute.after',
        })
        await flushBufferedSessionDiff(hookInput.sessionID)
      },
      'tool.execute.error': async (hookInput: ToolHookInput) => {
        if (!hookInput.sessionID) {
          return
        }
        markSessionActive(hookInput.sessionID)
        await forward({
          session_id: hookInput.sessionID,
          cwd,
          event_name: 'tool.execute.error',
        })
        await flushBufferedSessionDiff(hookInput.sessionID)
      },
    }
  }
}

export async function runClipulseSmokeScenario(
  input: RunClipulseSmokeScenarioInput = {
    directory: '/workspace/demo',
    diffMode: 'default',
    scenario: 'default',
    topology: 'shared-project',
    worktree: '/workspace/demo',
  },
  options: CreateClipulsePluginOptions = {},
): Promise<void> {
  const sessionId = 'opencode-smoke-session'
  const topology = input.topology ?? 'shared-project'
  const diffMode = input.diffMode ?? (input.scenario === 'gated-session-diff' ? 'gated-session-diff' : 'default')
  const directory = input.directory ?? '/workspace/demo'
  const worktree = input.worktree
    ?? (topology === 'split-project' ? '/tmp/demo-worktree' : directory)
  const pluginFactory = createClipulsePlugin(options)
  const hooks = await pluginFactory({
    ...input,
    directory,
    worktree,
  })
  const smokeFilePath = topology === 'split-project'
    ? `${worktree}/src/smoke.ts`
    : '/workspace/demo/src/smoke.ts'
  const gatedSmokeFilePath = topology === 'split-project'
    ? `${worktree}/src/smoke-gated.ts`
    : '/workspace/demo/src/smoke-gated.ts'

  await hooks.event({
    event: {
      type: 'session.created',
      properties: {
        info: {
          id: sessionId,
        },
      },
    },
  })

  await hooks['tool.execute.before']({
    sessionID: sessionId,
  })

  if (diffMode === 'gated-session-diff') {
    await hooks.event({
      event: {
        type: 'session.diff',
        properties: {
          sessionID: sessionId,
          diff: [
            {
              path: gatedSmokeFilePath,
              additions: 5,
              deletions: 1,
            },
          ],
        },
      },
    })

    await hooks['tool.execute.error']({
      sessionID: sessionId,
    })

    await hooks.event({
      event: {
        type: 'session.idle',
        properties: {
          info: {
            id: sessionId,
          },
        },
      },
    })

    await hooks.event({
      event: {
        type: 'session.deleted',
        properties: {
          info: {
            id: sessionId,
          },
        },
      },
    })
    return
  }

  await hooks.event({
    event: {
      type: 'file.edited',
      properties: {
        sessionID: sessionId,
        file: smokeFilePath,
      },
    },
  })

  await hooks.event({
    event: {
      type: 'session.diff',
      properties: {
        sessionID: sessionId,
        diff: [
          {
            path: smokeFilePath,
            additions: 2,
            deletions: 1,
          },
        ],
      },
    },
  })

  await hooks['tool.execute.after']({
    sessionID: sessionId,
  })
}

export const ClipulsePlugin = createClipulsePlugin()

function resolveSessionIdFromCreatedEvent(event: SessionCreatedEvent): string | null {
  const sessionId = event.properties?.info?.id ?? event.properties?.sessionID
  return typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : null
}

function resolveSessionIdFromLifecycleEvent(event: SessionLifecycleEvent): string | null {
  return resolveSessionId(event.properties?.info?.id ?? event.properties?.sessionID)
}

function resolveSessionIdFromFileEditedEvent(event: FileEditedEvent): string | null {
  return resolveSessionId(event.properties?.sessionID)
}

function resolveSessionIdFromSessionDiffEvent(event: SessionDiffEvent): string | null {
  return resolveSessionId(event.properties?.info?.id ?? event.properties?.sessionID)
}

function resolveSessionId(sessionId: unknown): string | null {
  return typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : null
}

function extractBufferedDiffEdits(projectRoot: string, cwd: string, event: SessionDiffEvent): BufferedDiffEdit[] {
  const diffEntries = event.properties?.diff
  if (!Array.isArray(diffEntries)) {
    return []
  }

  return diffEntries.flatMap((entry) => {
    const filePath = sanitizeBridgePath(projectRoot, cwd, resolveDiffEntryPath(entry))
    if (!filePath) {
      return []
    }

    return [{
      path: filePath,
      additions: resolveEditCount(entry.additions, entry.added),
      deletions: resolveEditCount(entry.deletions, entry.removed),
    }]
  })
}

function resolveDiffEntryPath(entry: SessionDiffEntry): string | null {
  const filePath = typeof entry.file === 'string' && entry.file.length > 0
    ? entry.file
    : entry.path

  return typeof filePath === 'string' && filePath.length > 0 ? filePath : null
}

function resolveEditCount(primary: unknown, fallback: unknown): number {
  return Math.max(resolveNumericCount(primary) ?? resolveNumericCount(fallback) ?? 0, 0)
}

function resolveNumericCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function sanitizeBridgePath(projectRoot: string, cwd: string, filePath: unknown): string | null {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    return null
  }

  const absolutePath = path.isAbsolute(filePath)
    ? path.normalize(filePath)
    : path.resolve(cwd, filePath)
  if (!isPathInsideProjectRoot(projectRoot, absolutePath)) {
    return null
  }

  return path.isAbsolute(filePath) ? absolutePath : path.normalize(filePath)
}

function resolveWrapperProjectRoot(
  directory: string | undefined,
  worktree: string | undefined,
  fallbackRoot: string,
): string {
  const normalizedDirectory = normalizeOptionalPath(directory)
  const normalizedWorktree = normalizeOptionalPath(worktree)

  if (!normalizedDirectory) {
    return normalizedWorktree ?? fallbackRoot
  }

  if (!normalizedWorktree) {
    return normalizedDirectory
  }

  if (isPathInsideProjectRoot(normalizedDirectory, normalizedWorktree)) {
    return normalizedDirectory
  }

  if (isPathInsideProjectRoot(normalizedWorktree, normalizedDirectory)) {
    return normalizedWorktree
  }

  return normalizedWorktree
}

function normalizeOptionalPath(input: string | undefined): string | null {
  return typeof input === 'string' && input.length > 0 ? path.resolve(input) : null
}

function isPathInsideProjectRoot(projectRoot: string, absolutePath: string): boolean {
  const relativePath = path.relative(projectRoot, absolutePath)
  return !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
}

function toBufferedPathKey(cwd: string, filePath: string): string {
  return path.normalize(path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath))
}

function parseBooleanFlag(value: string | undefined): boolean {
  return value === '1' || value === 'true'
}
