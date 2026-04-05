import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  deliverBatch,
  pruneStateDirectory,
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

  it('buffers the current batch when an older ready batch still cannot be flushed', async () => {
    const stateDir = await makeStateDir()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, status: 202 })

    await seedReadySpool(stateDir, {
      events: [makeEvent('session-backlog')],
    })

    const result = await deliverBatch('http://localhost:8000', {
      events: [makeEvent('session-current')],
    }, {
      fetchImpl: fetchMock,
      stateDir,
    })

    expect(result).toEqual({
      delivered: false,
      buffered: true,
      flushed: 0,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const readyDir = path.join(stateDir, 'spool', 'ready')
    const readyFiles = await fs.readdir(readyDir)
    expect(readyFiles).toHaveLength(2)

    const payloads = await Promise.all(
      readyFiles.map(async (fileName) => JSON.parse(
        await fs.readFile(path.join(readyDir, fileName), 'utf-8'),
      ) as EventBatch),
    )

    expect(payloads.flatMap((payload) => payload.events.map((event) => event.session_id)).sort())
      .toEqual(['session-backlog', 'session-current'])
  })

  it('requeues orphaned processing files before flushing backlog', async () => {
    const stateDir = await makeStateDir()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
    })

    const processingDir = path.join(stateDir, 'spool', 'processing')
    await fs.mkdir(processingDir, { recursive: true })
    await fs.writeFile(
      path.join(processingDir, '0000000000000-orphan.json'),
      JSON.stringify({ events: [makeEvent('session-orphan')] }),
      'utf-8',
    )

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
        body: expect.stringContaining('session-orphan'),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8000/api/v1/events/batch',
      expect.objectContaining({
        body: expect.stringContaining('session-current'),
      }),
    )
  })
})

describe('pruneStateDirectory', () => {
  it('removes old temp files and caps retained session and snapshot state', async () => {
    const stateDir = await makeStateDir()
    const oldTimestamp = new Date('2026-03-01T00:00:00.000Z')
    const recentTimestamp = new Date('2026-04-05T12:00:00.000Z')

    await seedStateFile(stateDir, ['spool', 'tmp', 'old.tmp'], oldTimestamp)
    await seedStateFile(stateDir, ['spool', 'quarantine', 'old.json'], oldTimestamp)
    await seedStateFile(stateDir, ['spool', 'quarantine', 'recent.json'], recentTimestamp)
    await seedStateFile(stateDir, ['sessions', 'a.json'], recentTimestamp)
    await seedStateFile(stateDir, ['sessions', 'b.json'], recentTimestamp)
    await seedStateFile(stateDir, ['snapshots', 'a.json'], recentTimestamp)
    await seedStateFile(stateDir, ['snapshots', 'b.json'], recentTimestamp)

    await pruneStateDirectory(stateDir, {
      now: new Date('2026-04-06T12:00:00.000Z'),
      retentionDays: 14,
      maxFiles: 1,
    })

    await expect(fs.stat(path.join(stateDir, 'spool', 'tmp', 'old.tmp'))).rejects.toThrow()
    await expect(fs.stat(path.join(stateDir, 'spool', 'quarantine', 'old.json'))).rejects.toThrow()
    await expect(fs.stat(path.join(stateDir, 'spool', 'quarantine', 'recent.json'))).resolves.toBeTruthy()
    expect(await fs.readdir(path.join(stateDir, 'sessions'))).toHaveLength(1)
    expect(await fs.readdir(path.join(stateDir, 'snapshots'))).toHaveLength(1)
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

async function seedStateFile(
  stateDir: string,
  segments: string[],
  mtime: Date,
): Promise<void> {
  const filePath = path.join(stateDir, ...segments)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, '{}', 'utf-8')
  await fs.utimes(filePath, mtime, mtime)
}
