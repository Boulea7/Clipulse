import path from 'node:path'

import { runOpenCodePlugin } from '../src/plugin.js'

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
    const projectRoot = input.directory ?? input.worktree ?? process.cwd()
    const cwd = input.worktree ?? input.directory ?? process.cwd()
    const bufferedPhases = new Map<string, BufferedSessionPhase>()
    const liveSessionIds = new Set<string>()

    const forward = async (payload: Record<string, unknown>): Promise<void> => {
      await runPlugin({
        env: process.env,
        readStdin: async () => JSON.stringify(payload),
        stdout: { write: () => {} },
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

    const flushBufferedSessionDiff = async (sessionId: string): Promise<void> => {
      const phase = bufferedPhases.get(sessionId)
      if (!phase) {
        return
      }

      bufferedPhases.delete(sessionId)

      const fileEdits = [...phase.diffByPath.entries()]
        .filter(([dedupePath]) => !phase.seenFileEditedPaths.has(dedupePath))
        .map(([, edit]) => ({
          path: edit.path,
          additions: edit.additions,
          deletions: edit.deletions,
        }))

      if (!fileEdits.length) {
        return
      }

      await forward({
        session_id: sessionId,
        cwd,
        event_name: 'file.edited',
        file_edits: fileEdits,
      })
    }

    return {
      event: async ({ event }: { event: OpenCodeEventEnvelope }) => {
        if (event.type === 'session.created') {
          const sessionId = resolveSessionIdFromCreatedEvent(event as SessionCreatedEvent)
          if (!sessionId) {
            return
          }
          liveSessionIds.add(sessionId)
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

          const bufferedPhase = getBufferedPhase(sessionId)
          for (const diffEntry of extractBufferedDiffEdits(projectRoot, cwd, event as SessionDiffEvent)) {
            bufferedPhase.diffByPath.set(toBufferedPathKey(cwd, diffEntry.path), diffEntry)
          }
          return
        }

        if (event.type === 'session.deleted' || event.type === 'session.idle' || event.type === 'session.error') {
          const sessionId = resolveOwnedSessionId(
            resolveSessionIdFromLifecycleEvent(event as SessionLifecycleEvent),
          )
          if (!sessionId) {
            return
          }
          await flushBufferedSessionDiff(sessionId)
          await forward({
            session_id: sessionId,
            cwd,
            event_name: event.type,
          })
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
          if (isSessionDiffEnabled) {
            getBufferedPhase(sessionId).seenFileEditedPaths.add(toBufferedPathKey(cwd, filePath))
          }
          await forward({
            session_id: sessionId,
            cwd,
            event_name: event.type,
            file_edits: [{ path: filePath }],
          })
        }
      },
      'tool.execute.before': async (hookInput: ToolHookInput) => {
        if (!hookInput.sessionID) {
          return
        }
        liveSessionIds.add(hookInput.sessionID)
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
        liveSessionIds.add(hookInput.sessionID)
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
        liveSessionIds.add(hookInput.sessionID)
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
  const relativePath = path.relative(projectRoot, absolutePath)
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return null
  }

  return path.isAbsolute(filePath) ? absolutePath : path.normalize(filePath)
}

function toBufferedPathKey(cwd: string, filePath: string): string {
  return path.normalize(path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath))
}

function parseBooleanFlag(value: string | undefined): boolean {
  return value === '1' || value === 'true'
}
