import { describe, expect, it, vi } from 'vitest'

import { createClipulsePlugin } from '../examples/clipulse.js'

describe('opencode clipulse example wrapper', () => {
  it('forwards named tool hooks through the bridge runner', async () => {
    const runPlugin = vi.fn().mockResolvedValue(undefined)
    const pluginFactory = createClipulsePlugin({ runPlugin })
    const hooks = await pluginFactory({
      directory: '/workspace/demo',
      worktree: '/workspace/demo-worktree',
    })

    await hooks['tool.execute.before']({
      sessionID: 'session-1',
      model: 'gpt-5.4',
    })

    expect(runPlugin).toHaveBeenCalledTimes(1)
    const dependencies = runPlugin.mock.calls[0]?.[0]
    expect(dependencies.env).toBe(process.env)
    const rawPayload = await dependencies.readStdin()
    expect(JSON.parse(rawPayload)).toEqual({
      session_id: 'session-1',
      cwd: '/workspace/demo-worktree',
      event_name: 'tool.execute.before',
      model: 'gpt-5.4',
    })
  })

  it('forwards session and file events using official event payload shapes', async () => {
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
})
