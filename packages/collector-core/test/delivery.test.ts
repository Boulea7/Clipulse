import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  deliverBatch,
  type EventBatch,
  type NormalizedActivityEvent,
} from '../src/index.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true })
    }),
  )
})

describe('deliverBatch', () => {
  it('buffers a failed batch into the ready spool', async () => {
    const stateDir = await makeStateDir()
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'))

    const result = await deliverBatch('http://localhost:8000', {
      events: [makeEvent('session-1')],
    }, {
      fetchImpl: fetchMock,
      stateDir,
    })

    expect(result.delivered).toBe(false)
    expect(result.buffered).toBe(true)

    const readyDir = path.join(stateDir, 'spool', 'ready')
    const readyFiles = await fs.readdir(readyDir)
    expect(readyFiles).toHaveLength(1)

    const spoolPayload = JSON.parse(
      await fs.readFile(path.join(readyDir, readyFiles[0]!), 'utf-8'),
    ) as EventBatch

    expect(spoolPayload.events).toHaveLength(1)
    expect(spoolPayload.events[0]?.session_id).toBe('session-1')
    expect(spoolPayload.events[0]?.event_id).toBeDefined()
  })

  it('flushes older ready batches before posting the current batch', async () => {
    const stateDir = await makeStateDir()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
    })

    await seedReadySpool(stateDir, {
      events: [makeEvent('session-backlog')],
    })

    const result = await deliverBatch('http://localhost:8000', {
      events: [makeEvent('session-current')],
    }, {
      fetchImpl: fetchMock,
      stateDir,
    })

    expect(result.delivered).toBe(true)
    expect(result.flushed).toBe(1)
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8000/api/v1/events/batch',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('session-backlog'),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8000/api/v1/events/batch',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('session-current'),
      }),
    )

    const readyDir = path.join(stateDir, 'spool', 'ready')
    await expect(fs.readdir(readyDir)).resolves.toEqual([])
  })
})

async function makeStateDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-delivery-'))
  tempDirs.push(dir)
  return dir
}

function makeEvent(sessionId: string): NormalizedActivityEvent {
  return {
    host: 'codex',
    host_version: '0.1.0',
    session_id: sessionId,
    project_root: '/workspace/demo',
    project_name: 'demo',
    git_branch: 'main',
    event_name: 'stop',
    event_time: '2026-04-05T12:00:00Z',
    model_name: 'gpt-5.4',
    os_name: 'macos',
    editor_or_terminal: 'terminal',
    active_ms: 1000,
    wait_ms: 500,
    privacy_mode: 'hashed',
    language_stats: {},
    file_deltas: [],
  }
}

async function seedReadySpool(stateDir: string, batch: EventBatch): Promise<void> {
  const readyDir = path.join(stateDir, 'spool', 'ready')
  await fs.mkdir(readyDir, { recursive: true })
  await fs.writeFile(
    path.join(readyDir, '0000000000000-backlog.json'),
    JSON.stringify(batch),
    'utf-8',
  )
}
