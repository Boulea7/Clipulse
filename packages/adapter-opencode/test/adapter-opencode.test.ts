import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildOpenCodeEvent } from '../src/index.js'
import { runOpenCodePlugin } from '../src/plugin.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true })
    }),
  )
})

describe('adapter-opencode', () => {
  it('normalizes file.edited events into high-confidence file deltas', async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-opencode-state-'))
    tempDirs.push(stateDir)

    const event = await buildOpenCodeEvent({
      session_id: 'opencode-session',
      cwd: '/workspace/demo',
      event_name: 'file.edited',
      event_time: '2026-04-10T02:00:00Z',
      model: 'gpt-5.4',
      file_edits: [
        {
          path: '/workspace/demo/src/app.ts',
          added: 5,
          removed: 2,
        },
      ],
    }, {
      stateDir,
    })

    expect(event.host).toBe('opencode')
    expect(event.event_name).toBe('file_edited')
    expect(event.file_deltas).toEqual([
      expect.objectContaining({
        language: 'TypeScript',
        added: 5,
        removed: 2,
      }),
    ])
    expect(event.language_stats).toEqual({
      TypeScript: {
        added: 5,
        removed: 2,
        changed: 7,
      },
    })
  })

  it('tracks wait timing across tool.execute.before and tool.execute.after', async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-opencode-state-'))
    tempDirs.push(stateDir)

    await buildOpenCodeEvent({
      session_id: 'opencode-session',
      cwd: '/workspace/demo',
      event_name: 'tool.execute.before',
      event_time: '2026-04-10T02:05:00Z',
      model: 'gpt-5.4',
    }, {
      stateDir,
    })

    const event = await buildOpenCodeEvent({
      session_id: 'opencode-session',
      cwd: '/workspace/demo',
      event_name: 'tool.execute.after',
      event_time: '2026-04-10T02:05:03Z',
      model: 'gpt-5.4',
    }, {
      stateDir,
    })

    expect(event.event_name).toBe('post_tool_use')
    expect(event.wait_ms).toBe(3_000)
  })

  it('prints a normalized batch when no API URL is configured', async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-opencode-state-'))
    tempDirs.push(stateDir)
    const stdoutWrite = vi.fn()

    await runOpenCodePlugin({
      env: {
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'opencode-session',
        cwd: '/workspace/demo',
        event_name: 'session.created',
        event_time: '2026-04-10T02:10:00Z',
        model: 'gpt-5.4',
      }),
      stdout: {
        write: stdoutWrite,
      },
    })

    expect(stdoutWrite).toHaveBeenCalledTimes(1)
    expect(String(stdoutWrite.mock.calls[0]?.[0])).toContain('"host":"opencode"')
    expect(String(stdoutWrite.mock.calls[0]?.[0])).toContain('"event_name":"session_start"')
  })

  it('delivers a normalized batch when the API URL is configured', async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-opencode-state-'))
    tempDirs.push(stateDir)
    const deliverBatch = vi.fn().mockResolvedValue({
      delivered: true,
      buffered: false,
      flushed: 0,
    })

    await runOpenCodePlugin({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'opencode-session',
        cwd: '/workspace/demo',
        event_name: 'session.created',
        event_time: '2026-04-10T02:15:00Z',
        model: 'gpt-5.4',
      }),
      deliverBatch,
    })

    expect(deliverBatch).toHaveBeenCalledWith(
      'http://localhost:8000',
      expect.objectContaining({
        events: [
          expect.objectContaining({
            host: 'opencode',
            session_id: 'opencode-session',
          }),
        ],
      }),
      expect.objectContaining({
        stateDir,
      }),
    )
  })
})
