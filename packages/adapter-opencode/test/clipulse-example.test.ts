import { describe, expect, it, vi } from 'vitest'

import { createClipulsePlugin } from '../examples/clipulse.js'

describe('opencode clipulse example wrapper', () => {
  it('forwards named tool hooks through the bridge runner without undocumented model fields', async () => {
    const runPlugin = vi.fn().mockResolvedValue(undefined)
    const pluginFactory = createClipulsePlugin({ runPlugin })
    const hooks = await pluginFactory({
      directory: '/workspace/demo',
      worktree: '/workspace/demo-worktree',
    })

    await hooks['tool.execute.before']({
      sessionID: 'session-1',
    })

    expect(runPlugin).toHaveBeenCalledTimes(1)
    const dependencies = runPlugin.mock.calls[0]?.[0]
    expect(dependencies.env).toBe(process.env)
    const rawPayload = await dependencies.readStdin()
    expect(JSON.parse(rawPayload)).toEqual({
      session_id: 'session-1',
      cwd: '/workspace/demo-worktree',
      event_name: 'tool.execute.before',
    })

    await hooks['tool.execute.error']({
      sessionID: 'session-1',
    })

    expect(runPlugin).toHaveBeenCalledTimes(2)
    const errorPayload = JSON.parse(await runPlugin.mock.calls[1][0].readStdin())
    expect(errorPayload).toEqual({
      session_id: 'session-1',
      cwd: '/workspace/demo-worktree',
      event_name: 'tool.execute.error',
    })
  })

  it('forwards file.edited events using the active session from the official session.created payload', async () => {
    const runPlugin = vi.fn().mockResolvedValue(undefined)
    const pluginFactory = createClipulsePlugin({ runPlugin })
    const hooks = await pluginFactory({
      directory: '/workspace/demo',
      worktree: '/workspace/demo',
    })

    await hooks.event({
      event: {
        type: 'session.created',
        properties: {
          info: {
            id: 'session-1',
          },
        },
      },
    })

    await hooks.event({
      event: {
        type: 'file.edited',
        properties: {
          file: '/workspace/demo/src/app.ts',
        },
      },
    })

    expect(runPlugin).toHaveBeenCalledTimes(2)

    const createdPayload = JSON.parse(await runPlugin.mock.calls[0][0].readStdin())
    const fileEditedPayload = JSON.parse(await runPlugin.mock.calls[1][0].readStdin())

    expect(createdPayload).toEqual({
      session_id: 'session-1',
      cwd: '/workspace/demo',
      event_name: 'session.created',
    })
    expect(fileEditedPayload).toEqual({
      session_id: 'session-1',
      cwd: '/workspace/demo',
      event_name: 'file.edited',
      file_edits: [{ path: '/workspace/demo/src/app.ts' }],
    })
  })

  it('parses official lifecycle payloads from the event body and ignores session.diff on the default path', async () => {
    const runPlugin = vi.fn().mockResolvedValue(undefined)
    const pluginFactory = createClipulsePlugin({ runPlugin })
    const hooks = await pluginFactory({
      directory: '/workspace/demo',
      worktree: '/workspace/demo',
    })

    await hooks.event({
      event: {
        type: 'session.created',
        properties: {
          info: {
            id: 'session-1',
          },
        },
      },
    })

    await hooks.event({
      event: {
        type: 'session.created',
        properties: {
          info: {
            id: 'session-2',
          },
        },
      },
    })

    await hooks.event({
      event: {
        type: 'session.diff',
        properties: {
          info: {
            id: 'session-1',
          },
          diff: [
            {
              path: '/workspace/demo/src/app.ts',
              added: 5,
              removed: 2,
            },
          ],
        },
      },
    })

    await hooks.event({
      event: {
        type: 'session.deleted',
        properties: {
          info: {
            id: 'session-1',
          },
        },
      },
    })

    await hooks.event({
      event: {
        type: 'session.error',
        properties: {
          info: {
            id: 'session-3',
          },
        },
      },
    })

    await hooks.event({
      event: {
        type: 'session.created',
        properties: {
          info: {
            id: 'session-4',
          },
        },
      },
    })

    await hooks.event({
      event: {
        type: 'session.idle',
        properties: {
          info: {
            id: 'session-5',
          },
        },
      },
    })

    expect(runPlugin).toHaveBeenCalledTimes(6)

    const forwardedPayloads = await Promise.all(
      runPlugin.mock.calls.map(async ([dependencies]) => JSON.parse(await dependencies.readStdin())),
    )

    expect(forwardedPayloads).toEqual([
      {
        session_id: 'session-1',
        cwd: '/workspace/demo',
        event_name: 'session.created',
      },
      {
        session_id: 'session-2',
        cwd: '/workspace/demo',
        event_name: 'session.created',
      },
      {
        session_id: 'session-1',
        cwd: '/workspace/demo',
        event_name: 'session.deleted',
      },
      {
        session_id: 'session-3',
        cwd: '/workspace/demo',
        event_name: 'session.error',
      },
      {
        session_id: 'session-4',
        cwd: '/workspace/demo',
        event_name: 'session.created',
      },
      {
        session_id: 'session-5',
        cwd: '/workspace/demo',
        event_name: 'session.idle',
      },
    ])
  })

  it('does not clear the active session when an unrelated lifecycle event arrives', async () => {
    const runPlugin = vi.fn().mockResolvedValue(undefined)
    const pluginFactory = createClipulsePlugin({ runPlugin })
    const hooks = await pluginFactory({
      directory: '/workspace/demo',
      worktree: '/workspace/demo',
    })

    await hooks.event({
      event: {
        type: 'session.created',
        properties: {
          info: {
            id: 'session-active',
          },
        },
      },
    })

    await hooks.event({
      event: {
        type: 'session.deleted',
        properties: {
          info: {
            id: 'session-old',
          },
        },
      },
    })

    await hooks.event({
      event: {
        type: 'file.edited',
        properties: {
          file: '/workspace/demo/src/after-old-delete.ts',
        },
      },
    })

    const forwardedPayloads = await Promise.all(
      runPlugin.mock.calls.map(async ([dependencies]) => JSON.parse(await dependencies.readStdin())),
    )

    expect(forwardedPayloads).toEqual([
      {
        session_id: 'session-active',
        cwd: '/workspace/demo',
        event_name: 'session.created',
      },
      {
        session_id: 'session-old',
        cwd: '/workspace/demo',
        event_name: 'session.deleted',
      },
      {
        session_id: 'session-active',
        cwd: '/workspace/demo',
        event_name: 'file.edited',
        file_edits: [{ path: '/workspace/demo/src/after-old-delete.ts' }],
      },
    ])
  })
})
