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

interface OpenCodeEventEnvelope {
  type: string
  properties?: {
    [key: string]: unknown
  }
}

interface ToolHookInput {
  sessionID?: string
  model?: string
}

interface CreateClipulsePluginOptions {
  runPlugin?: typeof runOpenCodePlugin
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
    const cwd = input.worktree ?? input.directory ?? process.cwd()
    let activeSessionId: string | null = null

    const forward = async (payload: Record<string, unknown>): Promise<void> => {
      await runPlugin({
        env: process.env,
        readStdin: async () => JSON.stringify(payload),
        stdout: { write: () => {} },
      })
    }

    return {
      event: async ({ event }: { event: OpenCodeEventEnvelope }) => {
        if (event.type === 'session.created') {
          const sessionId = resolveSessionIdFromCreatedEvent(event as SessionCreatedEvent)
          if (!sessionId) {
            return
          }
          activeSessionId = sessionId
          await forward({
            session_id: sessionId,
            cwd,
            event_name: event.type,
          })
          return
        }

        if (event.type === 'session.deleted' || event.type === 'session.idle' || event.type === 'session.error') {
          const sessionId = resolveSessionIdFromLifecycleEvent(event as SessionLifecycleEvent) ?? activeSessionId
          if (!sessionId) {
            return
          }
          await forward({
            session_id: sessionId,
            cwd,
            event_name: event.type,
          })
          if (event.type === 'session.deleted' || event.type === 'session.idle' || event.type === 'session.error') {
            activeSessionId = null
          }
          return
        }

        if (event.type === 'file.edited') {
          const sessionId = resolveSessionIdFromFileEditedEvent(event as FileEditedEvent) ?? activeSessionId
          const filePath = event.properties?.file
          if (typeof filePath !== 'string' || !sessionId) {
            return
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
        activeSessionId = hookInput.sessionID
        await forward({
          session_id: hookInput.sessionID,
          cwd,
          event_name: 'tool.execute.before',
          model: hookInput.model,
        })
      },
      'tool.execute.after': async (hookInput: ToolHookInput) => {
        if (!hookInput.sessionID) {
          return
        }
        activeSessionId = hookInput.sessionID
        await forward({
          session_id: hookInput.sessionID,
          cwd,
          event_name: 'tool.execute.after',
          model: hookInput.model,
        })
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
  const sessionId = event.properties?.sessionID
  return typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : null
}

function resolveSessionIdFromFileEditedEvent(event: FileEditedEvent): string | null {
  const sessionId = event.properties?.sessionID
  return typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : null
}
