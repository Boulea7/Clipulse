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

  it('drops repo-external file.edited paths before forwarding them across the bridge', async () => {
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
          file: '../outside.ts',
        },
      },
    })

    await hooks.event({
      event: {
        type: 'file.edited',
        properties: {
          file: '/workspace/other/secret.ts',
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
        session_id: 'session-1',
        cwd: '/workspace/demo',
        event_name: 'file.edited',
        file_edits: [{ path: '/workspace/demo/src/app.ts' }],
      },
    ])
  })

  it('keeps project-internal absolute file.edited paths even when cwd is nested', async () => {
    const runPlugin = vi.fn().mockResolvedValue(undefined)
    const pluginFactory = createClipulsePlugin({ runPlugin })
    const hooks = await pluginFactory({
      directory: '/workspace/demo',
      worktree: '/workspace/demo/packages/adapter-opencode',
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

    const forwardedPayloads = await Promise.all(
      runPlugin.mock.calls.map(async ([dependencies]) => JSON.parse(await dependencies.readStdin())),
    )

    expect(forwardedPayloads).toEqual([
      {
        session_id: 'session-1',
        cwd: '/workspace/demo/packages/adapter-opencode',
        event_name: 'session.created',
      },
      {
        session_id: 'session-1',
        cwd: '/workspace/demo/packages/adapter-opencode',
        event_name: 'file.edited',
        file_edits: [{ path: '/workspace/demo/src/app.ts' }],
      },
    ])
  })

  it('keeps project-internal relative file.edited paths that resolve outside the cwd subtree', async () => {
    const runPlugin = vi.fn().mockResolvedValue(undefined)
    const pluginFactory = createClipulsePlugin({ runPlugin })
    const hooks = await pluginFactory({
      directory: '/workspace/demo',
      worktree: '/workspace/demo/packages/adapter-opencode',
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
          file: '../../shared.ts',
        },
      },
    })

    const forwardedPayloads = await Promise.all(
      runPlugin.mock.calls.map(async ([dependencies]) => JSON.parse(await dependencies.readStdin())),
    )

    expect(forwardedPayloads).toEqual([
      {
        session_id: 'session-1',
        cwd: '/workspace/demo/packages/adapter-opencode',
        event_name: 'session.created',
      },
      {
        session_id: 'session-1',
        cwd: '/workspace/demo/packages/adapter-opencode',
        event_name: 'file.edited',
        file_edits: [{ path: '../../shared.ts' }],
      },
    ])
  })

  it('uses the broader worktree root when directory is too narrow for worktree-owned file.edited paths', async () => {
    const runPlugin = vi.fn().mockResolvedValue(undefined)
    const pluginFactory = createClipulsePlugin({ runPlugin })
    const hooks = await pluginFactory({
      directory: '/workspace/demo/packages/adapter-opencode',
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
        session_id: 'session-1',
        cwd: '/workspace/demo',
        event_name: 'file.edited',
        file_edits: [{ path: '/workspace/demo/src/app.ts' }],
      },
    ])
  })

  it('uses an external worktree root when directory does not contain the active worktree', async () => {
    const runPlugin = vi.fn().mockResolvedValue(undefined)
    const pluginFactory = createClipulsePlugin({ runPlugin })
    const hooks = await pluginFactory({
      directory: '/workspace/demo',
      worktree: '/tmp/demo-worktree',
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
          file: '/tmp/demo-worktree/src/app.ts',
        },
      },
    })

    const forwardedPayloads = await Promise.all(
      runPlugin.mock.calls.map(async ([dependencies]) => JSON.parse(await dependencies.readStdin())),
    )

    expect(forwardedPayloads).toEqual([
      {
        session_id: 'session-1',
        cwd: '/tmp/demo-worktree',
        event_name: 'session.created',
      },
      {
        session_id: 'session-1',
        cwd: '/tmp/demo-worktree',
        event_name: 'file.edited',
        file_edits: [{ path: '/tmp/demo-worktree/src/app.ts' }],
      },
    ])
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

  it('backfills sanitized session.diff file edits after tool.execute.after when the feature gate is enabled', async () => {
    const runPlugin = vi.fn().mockResolvedValue(undefined)
    const previousGate = process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF
    process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF = '1'

    try {
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
          type: 'session.diff',
          properties: {
            info: {
              id: 'session-1',
            },
            diff: [
              {
                path: '/workspace/demo/src/app.ts',
                additions: 5,
                deletions: 2,
                before: 'old source',
                after: 'new source',
                patch: '@@ -1 +1 @@',
                raw: 'diff --git a b',
              },
            ],
          },
        },
      })

      await hooks['tool.execute.after']({
        sessionID: 'session-1',
      })

      expect(runPlugin).toHaveBeenCalledTimes(3)

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
          session_id: 'session-1',
          cwd: '/workspace/demo',
          event_name: 'tool.execute.after',
        },
        {
          session_id: 'session-1',
          cwd: '/workspace/demo',
          event_name: 'file.edited',
          file_edits: [
            {
              path: '/workspace/demo/src/app.ts',
              additions: 5,
              deletions: 2,
            },
          ],
        },
      ])
    } finally {
      if (previousGate === undefined) {
        delete process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF
      } else {
        process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF = previousGate
      }
    }
  })

  it('drops repo-external gated session.diff paths before backfilling file.edited', async () => {
    const runPlugin = vi.fn().mockResolvedValue(undefined)
    const previousGate = process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF
    process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF = '1'

    try {
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
          type: 'session.diff',
          properties: {
            info: {
              id: 'session-1',
            },
            diff: [
              {
                path: '../outside.ts',
                additions: 8,
                deletions: 3,
              },
              {
                path: '/workspace/other/secret.ts',
                additions: 4,
                deletions: 1,
              },
              {
                path: '/workspace/demo/src/app.ts',
                additions: 5,
                deletions: 2,
              },
            ],
          },
        },
      })

      await hooks['tool.execute.after']({
        sessionID: 'session-1',
      })

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
          session_id: 'session-1',
          cwd: '/workspace/demo',
          event_name: 'tool.execute.after',
        },
        {
          session_id: 'session-1',
          cwd: '/workspace/demo',
          event_name: 'file.edited',
          file_edits: [
            {
              path: '/workspace/demo/src/app.ts',
              additions: 5,
              deletions: 2,
            },
          ],
        },
      ])
    } finally {
      if (previousGate === undefined) {
        delete process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF
      } else {
        process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF = previousGate
      }
    }
  })

  it('accepts the current official session.diff shape that uses sessionID and file fields', async () => {
    const runPlugin = vi.fn().mockResolvedValue(undefined)
    const previousGate = process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF
    process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF = '1'

    try {
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
          type: 'session.diff',
          properties: {
            sessionID: 'session-1',
            diff: [
              {
                file: 'src/app.ts',
                additions: 5,
                deletions: 2,
                before: 'old source',
                after: 'new source',
              },
            ],
          },
        },
      })

      await hooks['tool.execute.after']({
        sessionID: 'session-1',
      })

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
          session_id: 'session-1',
          cwd: '/workspace/demo',
          event_name: 'tool.execute.after',
        },
        {
          session_id: 'session-1',
          cwd: '/workspace/demo',
          event_name: 'file.edited',
          file_edits: [
            {
              path: 'src/app.ts',
              additions: 5,
              deletions: 2,
            },
          ],
        },
      ])
    } finally {
      if (previousGate === undefined) {
        delete process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF
      } else {
        process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF = previousGate
      }
    }
  })

  it('accepts added and removed aliases when gated session.diff fallback flushes on tool errors', async () => {
    const runPlugin = vi.fn().mockResolvedValue(undefined)
    const previousGate = process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF
    process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF = '1'

    try {
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
          type: 'session.diff',
          properties: {
            sessionID: 'session-1',
            diff: [
              {
                file: 'src/error-phase.ts',
                added: 7,
                removed: 3,
              },
            ],
          },
        },
      })

      await hooks['tool.execute.error']({
        sessionID: 'session-1',
      })

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
          session_id: 'session-1',
          cwd: '/workspace/demo',
          event_name: 'tool.execute.error',
        },
        {
          session_id: 'session-1',
          cwd: '/workspace/demo',
          event_name: 'file.edited',
          file_edits: [
            {
              path: 'src/error-phase.ts',
              additions: 7,
              deletions: 3,
            },
          ],
        },
      ])
    } finally {
      if (previousGate === undefined) {
        delete process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF
      } else {
        process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF = previousGate
      }
    }
  })

  it('flushes gated session.diff edits before forwarding session.idle lifecycle events', async () => {
    const runPlugin = vi.fn().mockResolvedValue(undefined)
    const previousGate = process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF
    process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF = '1'

    try {
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
          type: 'session.diff',
          properties: {
            info: {
              id: 'session-1',
            },
            diff: [
              {
                path: '/workspace/demo/src/from-idle.ts',
                additions: 6,
                deletions: 2,
              },
            ],
          },
        },
      })

      await hooks.event({
        event: {
          type: 'session.idle',
          properties: {
            info: {
              id: 'session-1',
            },
          },
        },
      })

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
          session_id: 'session-1',
          cwd: '/workspace/demo',
          event_name: 'file.edited',
          file_edits: [
            {
              path: '/workspace/demo/src/from-idle.ts',
              additions: 6,
              deletions: 2,
            },
          ],
        },
        {
          session_id: 'session-1',
          cwd: '/workspace/demo',
          event_name: 'session.idle',
        },
      ])
    } finally {
      if (previousGate === undefined) {
        delete process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF
      } else {
        process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF = previousGate
      }
    }
  })

  it('drops session.diff paths already seen via file.edited before flushing the same buffered phase', async () => {
    const runPlugin = vi.fn().mockResolvedValue(undefined)
    const previousGate = process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF
    process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF = '1'

    try {
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
          type: 'session.diff',
          properties: {
            info: {
              id: 'session-1',
            },
            diff: [
              {
                path: '/workspace/demo/src/app.ts',
                additions: 5,
                deletions: 2,
                before: 'old source',
                after: 'new source',
              },
              {
                path: '/workspace/demo/src/other.ts',
                additions: 3,
                deletions: 1,
                patch: '@@ -1 +1 @@',
              },
            ],
          },
        },
      })

      await hooks.event({
        event: {
          type: 'file.edited',
          properties: {
            sessionID: 'session-1',
            file: '/workspace/demo/src/app.ts',
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

      expect(runPlugin).toHaveBeenCalledTimes(4)

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
          session_id: 'session-1',
          cwd: '/workspace/demo',
          event_name: 'file.edited',
          file_edits: [{ path: '/workspace/demo/src/app.ts' }],
        },
        {
          session_id: 'session-1',
          cwd: '/workspace/demo',
          event_name: 'file.edited',
          file_edits: [
            {
              path: '/workspace/demo/src/other.ts',
              additions: 3,
              deletions: 1,
            },
          ],
        },
        {
          session_id: 'session-1',
          cwd: '/workspace/demo',
          event_name: 'session.deleted',
        },
      ])
    } finally {
      if (previousGate === undefined) {
        delete process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF
      } else {
        process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF = previousGate
      }
    }
  })

  it('dedupes session.diff entries after normalizing relative and absolute paths in the same phase', async () => {
    const runPlugin = vi.fn().mockResolvedValue(undefined)
    const previousGate = process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF
    process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF = '1'

    try {
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
          type: 'session.diff',
          properties: {
            sessionID: 'session-1',
            diff: [
              {
                file: 'src/app.ts',
                additions: 5,
                deletions: 2,
              },
              {
                file: '/workspace/demo/src/app.ts',
                additions: 9,
                deletions: 4,
              },
            ],
          },
        },
      })

      await hooks['tool.execute.after']({
        sessionID: 'session-1',
      })

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
          session_id: 'session-1',
          cwd: '/workspace/demo',
          event_name: 'tool.execute.after',
        },
        {
          session_id: 'session-1',
          cwd: '/workspace/demo',
          event_name: 'file.edited',
          file_edits: [
            {
              path: '/workspace/demo/src/app.ts',
              additions: 9,
              deletions: 4,
            },
          ],
        },
      ])
    } finally {
      if (previousGate === undefined) {
        delete process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF
      } else {
        process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF = previousGate
      }
    }
  })

  it('keeps gated session.diff ownership stable across interleaved sessions when explicit sessionID is present', async () => {
    const runPlugin = vi.fn().mockResolvedValue(undefined)
    const previousGate = process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF
    process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF = '1'

    try {
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
            sessionID: 'session-1',
            diff: [
              {
                file: 'src/session-1.ts',
                additions: 2,
                deletions: 1,
              },
            ],
          },
        },
      })

      await hooks['tool.execute.after']({
        sessionID: 'session-2',
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
          session_id: 'session-2',
          cwd: '/workspace/demo',
          event_name: 'tool.execute.after',
        },
        {
          session_id: 'session-1',
          cwd: '/workspace/demo',
          event_name: 'file.edited',
          file_edits: [
            {
              path: 'src/session-1.ts',
              additions: 2,
              deletions: 1,
            },
          ],
        },
        {
          session_id: 'session-1',
          cwd: '/workspace/demo',
          event_name: 'session.deleted',
        },
      ])
    } finally {
      if (previousGate === undefined) {
        delete process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF
      } else {
        process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF = previousGate
      }
    }
  })

  it('drops file.edited fallback ownership when more than one live session exists', async () => {
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
        type: 'file.edited',
        properties: {
          file: '/workspace/demo/src/ambiguous.ts',
        },
      },
    })

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
    ])
  })

  it('keeps explicit file.edited ownership stable across interleaved sessions', async () => {
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
        type: 'file.edited',
        properties: {
          sessionID: 'session-1',
          file: '/workspace/demo/src/session-1.ts',
        },
      },
    })

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
        event_name: 'file.edited',
        file_edits: [{ path: '/workspace/demo/src/session-1.ts' }],
      },
    ])
  })

  it('allows gated session.diff fallback only when exactly one live session exists', async () => {
    const runPlugin = vi.fn().mockResolvedValue(undefined)
    const previousGate = process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF
    process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF = '1'

    try {
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
          type: 'session.diff',
          properties: {
            diff: [
              {
                file: 'src/solo.ts',
                additions: 4,
                deletions: 1,
              },
            ],
          },
        },
      })

      await hooks['tool.execute.after']({
        sessionID: 'session-1',
      })

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
          session_id: 'session-1',
          cwd: '/workspace/demo',
          event_name: 'tool.execute.after',
        },
        {
          session_id: 'session-1',
          cwd: '/workspace/demo',
          event_name: 'file.edited',
          file_edits: [
            {
              path: 'src/solo.ts',
              additions: 4,
              deletions: 1,
            },
          ],
        },
      ])
    } finally {
      if (previousGate === undefined) {
        delete process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF
      } else {
        process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF = previousGate
      }
    }
  })

  it('restores file.edited fallback ownership after two live sessions shrink back to one', async () => {
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
        type: 'session.deleted',
        properties: {
          info: {
            id: 'session-2',
          },
        },
      },
    })

    await hooks.event({
      event: {
        type: 'file.edited',
        properties: {
          file: '/workspace/demo/src/recovered.ts',
        },
      },
    })

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
        session_id: 'session-2',
        cwd: '/workspace/demo',
        event_name: 'session.deleted',
      },
      {
        session_id: 'session-1',
        cwd: '/workspace/demo',
        event_name: 'file.edited',
        file_edits: [{ path: '/workspace/demo/src/recovered.ts' }],
      },
    ])
  })

  it('restores gated session.diff fallback ownership after two live sessions shrink back to one', async () => {
    const runPlugin = vi.fn().mockResolvedValue(undefined)
    const previousGate = process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF
    process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF = '1'

    try {
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
          type: 'session.deleted',
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
            diff: [
              {
                file: 'src/recovered.ts',
                additions: 4,
                deletions: 1,
              },
            ],
          },
        },
      })

      await hooks['tool.execute.after']({
        sessionID: 'session-1',
      })

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
          session_id: 'session-2',
          cwd: '/workspace/demo',
          event_name: 'session.deleted',
        },
        {
          session_id: 'session-1',
          cwd: '/workspace/demo',
          event_name: 'tool.execute.after',
        },
        {
          session_id: 'session-1',
          cwd: '/workspace/demo',
          event_name: 'file.edited',
          file_edits: [
            {
              path: 'src/recovered.ts',
              additions: 4,
              deletions: 1,
            },
          ],
        },
      ])
    } finally {
      if (previousGate === undefined) {
        delete process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF
      } else {
        process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF = previousGate
      }
    }
  })

  it('drops gated session.diff fallback ownership when more than one live session exists', async () => {
    const runPlugin = vi.fn().mockResolvedValue(undefined)
    const previousGate = process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF
    process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF = '1'

    try {
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
            diff: [
              {
                file: 'src/ambiguous.ts',
                additions: 2,
                deletions: 1,
              },
            ],
          },
        },
      })

      await hooks['tool.execute.after']({
        sessionID: 'session-2',
      })

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
          session_id: 'session-2',
          cwd: '/workspace/demo',
          event_name: 'tool.execute.after',
        },
      ])
    } finally {
      if (previousGate === undefined) {
        delete process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF
      } else {
        process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF = previousGate
      }
    }
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

  it('keeps a buffered gated session.diff owned by the active session when an unrelated lifecycle event arrives', async () => {
    const previousGate = process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF
    process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF = '1'

    try {
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
          type: 'session.diff',
          properties: {
            info: {
              id: 'session-active',
            },
            diff: [
              {
                file: 'src/after-old-delete.ts',
                additions: 2,
                deletions: 1,
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
              id: 'session-old',
            },
          },
        },
      })

      await hooks['tool.execute.after']({
        sessionID: 'session-active',
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
          event_name: 'tool.execute.after',
        },
        {
          session_id: 'session-active',
          cwd: '/workspace/demo',
          event_name: 'file.edited',
          file_edits: [{ path: 'src/after-old-delete.ts', additions: 2, deletions: 1 }],
        },
      ])
    } finally {
      if (previousGate === undefined) {
        delete process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF
      } else {
        process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF = previousGate
      }
    }
  })
})
