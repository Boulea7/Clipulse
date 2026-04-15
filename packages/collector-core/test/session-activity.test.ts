import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { trackSessionActivity } from '../src/index.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true })
    }),
  )
})

describe('trackSessionActivity', () => {
  it('derives active and wait time from session hook gaps', async () => {
    const stateDir = await makeStateDir()

    const first = await trackSessionActivity({
      stateDir,
      host: 'codex',
      sessionId: 'session-1',
      eventName: 'user_prompt_submit',
      eventTime: '2026-04-05T12:00:00.000Z',
    })

    const preTool = await trackSessionActivity({
      stateDir,
      host: 'codex',
      sessionId: 'session-1',
      eventName: 'pre_tool_use',
      eventTime: '2026-04-05T12:00:05.000Z',
    })

    const postTool = await trackSessionActivity({
      stateDir,
      host: 'codex',
      sessionId: 'session-1',
      eventName: 'post_tool_use',
      eventTime: '2026-04-05T12:00:11.000Z',
    })

    const stop = await trackSessionActivity({
      stateDir,
      host: 'codex',
      sessionId: 'session-1',
      eventName: 'stop',
      eventTime: '2026-04-05T12:00:16.000Z',
    })

    expect(first).toEqual({ activeMs: 0, waitMs: 0 })
    expect(preTool).toEqual({ activeMs: 5000, waitMs: 0 })
    expect(postTool).toEqual({ activeMs: 0, waitMs: 6000 })
    expect(stop).toEqual({ activeMs: 5000, waitMs: 0 })
  })

  it('treats an unfinished tool wait as wait time when the session stops', async () => {
    const stateDir = await makeStateDir()

    await trackSessionActivity({
      stateDir,
      host: 'codex',
      sessionId: 'session-2',
      eventName: 'pre_tool_use',
      eventTime: '2026-04-05T12:00:05.000Z',
    })

    const stop = await trackSessionActivity({
      stateDir,
      host: 'codex',
      sessionId: 'session-2',
      eventName: 'stop',
      eventTime: '2026-04-05T12:00:09.000Z',
    })

    expect(stop).toEqual({ activeMs: 0, waitMs: 4000 })
    await expect(fs.readdir(path.join(stateDir, 'sessions'))).resolves.toEqual([])
  })

  it('ignores invalid or out-of-order timestamps instead of producing NaN', async () => {
    const stateDir = await makeStateDir()

    await trackSessionActivity({
      stateDir,
      host: 'codex',
      sessionId: 'session-3',
      eventName: 'user_prompt_submit',
      eventTime: '2026-04-05T12:00:10.000Z',
    })

    const invalid = await trackSessionActivity({
      stateDir,
      host: 'codex',
      sessionId: 'session-3',
      eventName: 'post_tool_use',
      eventTime: 'not-a-real-time',
    })

    const outOfOrder = await trackSessionActivity({
      stateDir,
      host: 'codex',
      sessionId: 'session-3',
      eventName: 'stop',
      eventTime: '2026-04-05T12:00:09.000Z',
    })

    expect(invalid).toEqual({ activeMs: 0, waitMs: 0 })
    expect(outOfOrder).toEqual({ activeMs: 0, waitMs: 0 })
  })

  it('treats post_tool_use_failure as the end of a wait gap', async () => {
    const stateDir = await makeStateDir()

    await trackSessionActivity({
      stateDir,
      host: 'claude-code',
      sessionId: 'session-4',
      eventName: 'pre_tool_use',
      eventTime: '2026-04-05T12:00:00.000Z',
    })

    const failure = await trackSessionActivity({
      stateDir,
      host: 'claude-code',
      sessionId: 'session-4',
      eventName: 'post_tool_use_failure',
      eventTime: '2026-04-05T12:00:05.000Z',
    })

    expect(failure).toEqual({ activeMs: 0, waitMs: 5000 })
  })

  it('preserves pending tool waits across interleaved non-tool events', async () => {
    const stateDir = await makeStateDir()

    await trackSessionActivity({
      stateDir,
      host: 'gemini-cli',
      sessionId: 'session-5',
      eventName: 'pre_tool_use',
      eventTime: '2026-04-05T12:00:00.000Z',
    })

    const interleaved = await trackSessionActivity({
      stateDir,
      host: 'gemini-cli',
      sessionId: 'session-5',
      eventName: 'after_agent',
      eventTime: '2026-04-05T12:00:02.000Z',
    })

    const completion = await trackSessionActivity({
      stateDir,
      host: 'gemini-cli',
      sessionId: 'session-5',
      eventName: 'post_tool_use',
      eventTime: '2026-04-05T12:00:05.000Z',
    })

    expect(interleaved).toEqual({ activeMs: 2000, waitMs: 0 })
    expect(completion).toEqual({ activeMs: 0, waitMs: 5000 })
  })
})

async function makeStateDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-session-'))
  tempDirs.push(dir)
  return dir
}
