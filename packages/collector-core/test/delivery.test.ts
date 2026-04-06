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

  it('deduplicates repeated event ids across ready backlog batches before sending', async () => {
    const stateDir = await makeStateDir()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
    })

    await seedReadySpool(stateDir, {
      events: [makeEvent('session-dup', 'event-dup')],
    })
    await seedNamedReadySpool(stateDir, '0000000000001-duplicate.json', {
      events: [makeEvent('session-dup', 'event-dup')],
    })

    const result = await deliverBatch('http://localhost:8000', {
      events: [makeEvent('session-current')],
    }, {
      fetchImpl: fetchMock,
      stateDir,
    })

    expect(result.delivered).toBe(true)
    expect(result.flushed).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8000/api/v1/events/batch',
      expect.objectContaining({
        body: expect.stringContaining('event-dup'),
      }),
    )

    const readyDir = path.join(stateDir, 'spool', 'ready')
    await expect(fs.readdir(readyDir)).resolves.toEqual([])
  })

  it('deduplicates the current batch against already flushed backlog events', async () => {
    const stateDir = await makeStateDir()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
    })

    await seedReadySpool(stateDir, {
      events: [makeEvent('session-dup', 'event-dup')],
    })

    const result = await deliverBatch('http://localhost:8000', {
      events: [makeEvent('session-dup', 'event-dup')],
    }, {
      fetchImpl: fetchMock,
      stateDir,
    })

    expect(result).toEqual({
      delivered: true,
      buffered: false,
      flushed: 1,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/api/v1/events/batch',
      expect.objectContaining({
        body: expect.stringContaining('event-dup'),
      }),
    )
  })

  it('requeues only retryable events from a partial current batch outcome', async () => {
    const stateDir = await makeStateDir()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: vi.fn().mockResolvedValue({
        accepted: 1,
        duplicates: 0,
        invalid: 0,
        results: [
          { event_id: 'event-accepted', status: 'accepted', retryable: false },
          { event_id: 'event-retry', status: 'server_error', retryable: true },
        ],
      }),
    })

    const result = await deliverBatch('http://localhost:8000', {
      events: [
        makeEvent('session-accepted', 'event-accepted'),
        makeEvent('session-retry', 'event-retry'),
      ],
    }, {
      fetchImpl: fetchMock,
      stateDir,
    })

    expect(result).toEqual({
      delivered: false,
      buffered: true,
      flushed: 0,
    })

    const readyDir = path.join(stateDir, 'spool', 'ready')
    const readyFiles = await fs.readdir(readyDir)
    expect(readyFiles).toHaveLength(1)

    const payload = JSON.parse(
      await fs.readFile(path.join(readyDir, readyFiles[0]!), 'utf-8'),
    ) as EventBatch

    expect(payload.events).toEqual([
      expect.objectContaining({
        session_id: 'session-retry',
        event_id: 'event-retry',
      }),
    ])
  })

  it('matches partial current batch outcomes by event_id when results are reordered', async () => {
    const stateDir = await makeStateDir()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: vi.fn().mockResolvedValue({
        accepted: 1,
        duplicates: 0,
        invalid: 0,
        results: [
          { event_id: 'event-retry', status: 'server_error', retryable: true },
          { event_id: 'event-accepted', status: 'accepted', retryable: false },
        ],
      }),
    })

    const result = await deliverBatch('http://localhost:8000', {
      events: [
        makeEvent('session-accepted', 'event-accepted'),
        makeEvent('session-retry', 'event-retry'),
      ],
    }, {
      fetchImpl: fetchMock,
      stateDir,
    })

    expect(result).toEqual({
      delivered: false,
      buffered: true,
      flushed: 0,
    })

    const readyDir = path.join(stateDir, 'spool', 'ready')
    const readyFiles = await fs.readdir(readyDir)
    expect(readyFiles).toHaveLength(1)

    const payload = JSON.parse(
      await fs.readFile(path.join(readyDir, readyFiles[0]!), 'utf-8'),
    ) as EventBatch

    expect(payload.events).toEqual([
      expect.objectContaining({
        session_id: 'session-retry',
        event_id: 'event-retry',
      }),
    ])
  })

  it('requeues unresolved events when partial current batch outcomes omit some event_ids', async () => {
    const stateDir = await makeStateDir()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: vi.fn().mockResolvedValue({
        accepted: 1,
        duplicates: 0,
        invalid: 0,
        results: [
          { event_id: 'event-accepted', status: 'accepted', retryable: false },
        ],
      }),
    })

    const result = await deliverBatch('http://localhost:8000', {
      events: [
        makeEvent('session-accepted', 'event-accepted'),
        makeEvent('session-unresolved', 'event-unresolved'),
      ],
    }, {
      fetchImpl: fetchMock,
      stateDir,
    })

    expect(result).toEqual({
      delivered: false,
      buffered: true,
      flushed: 0,
    })

    const readyDir = path.join(stateDir, 'spool', 'ready')
    const readyFiles = await fs.readdir(readyDir)
    expect(readyFiles).toHaveLength(1)

    const payload = JSON.parse(
      await fs.readFile(path.join(readyDir, readyFiles[0]!), 'utf-8'),
    ) as EventBatch

    expect(payload.events).toEqual([
      expect.objectContaining({
        session_id: 'session-unresolved',
        event_id: 'event-unresolved',
      }),
    ])
  })

  it('quarantines non-retryable backlog batches and continues sending newer work', async () => {
    const stateDir = await makeStateDir()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 422,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: vi.fn().mockResolvedValue({
          accepted: 1,
          duplicates: 0,
          invalid: 0,
          results: [
            { event_id: 'event-current', status: 'accepted', retryable: false },
          ],
        }),
      })

    await seedReadySpool(stateDir, {
      events: [makeEvent('session-backlog', 'event-backlog')],
    })

    const result = await deliverBatch('http://localhost:8000', {
      events: [makeEvent('session-current', 'event-current')],
    }, {
      fetchImpl: fetchMock,
      stateDir,
    })

    expect(result).toEqual({
      delivered: true,
      buffered: false,
      flushed: 0,
    })

    await expect(readPayloadFiles(path.join(stateDir, 'spool', 'ready'))).resolves.toEqual([])
    await expect(readPayloadFiles(path.join(stateDir, 'spool', 'quarantine'))).resolves.toHaveLength(1)
    await expect(readMetadataFiles(path.join(stateDir, 'spool', 'quarantine'))).resolves.toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8000/api/v1/events/batch',
      expect.objectContaining({
        body: expect.stringContaining('event-current'),
      }),
    )
  })

  it('quarantines non-retryable current batches instead of dropping them silently', async () => {
    const stateDir = await makeStateDir()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
    })

    const result = await deliverBatch('http://localhost:8000', {
      events: [makeEvent('session-current', 'event-current')],
    }, {
      fetchImpl: fetchMock,
      stateDir,
    })

    expect(result).toEqual({
      delivered: false,
      buffered: false,
      flushed: 0,
    })

    await expect(readPayloadFiles(path.join(stateDir, 'spool', 'ready'))).resolves.toEqual([])
    await expect(readPayloadFiles(path.join(stateDir, 'spool', 'quarantine'))).resolves.toHaveLength(1)
    await expect(readMetadataFiles(path.join(stateDir, 'spool', 'quarantine'))).resolves.toHaveLength(1)
  })

  it('quarantines only non-retryable events from a mixed current batch outcome', async () => {
    const stateDir = await makeStateDir()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: vi.fn().mockResolvedValue({
        accepted: 0,
        duplicates: 0,
        invalid: 1,
        results: [
          { event_id: 'event-invalid', status: 'invalid', retryable: false },
          { event_id: 'event-retry', status: 'server_error', retryable: true },
        ],
      }),
    })

    const result = await deliverBatch('http://localhost:8000', {
      events: [
        makeEvent('session-invalid', 'event-invalid'),
        makeEvent('session-retry', 'event-retry'),
      ],
    }, {
      fetchImpl: fetchMock,
      stateDir,
    })

    expect(result).toEqual({
      delivered: false,
      buffered: true,
      flushed: 0,
    })

    await expect(readPayloadFiles(path.join(stateDir, 'spool', 'ready'))).resolves.toHaveLength(1)
    await expect(readPayloadFiles(path.join(stateDir, 'spool', 'quarantine'))).resolves.toHaveLength(1)
    await expect(readMetadataFiles(path.join(stateDir, 'spool', 'quarantine'))).resolves.toHaveLength(1)

    const readyPayloads = await readSpoolPayloads(path.join(stateDir, 'spool', 'ready'))
    const quarantinePayloads = await readSpoolPayloads(path.join(stateDir, 'spool', 'quarantine'))
    const quarantineMetadata = await readSpoolMetadata(path.join(stateDir, 'spool', 'quarantine'))

    expect(readyPayloads[0]?.events.map((event) => event.event_id)).toEqual(['event-retry'])
    expect(quarantinePayloads[0]?.events.map((event) => event.event_id)).toEqual(['event-invalid'])
    expect(quarantineMetadata[0]).toEqual(expect.objectContaining({
      event_count: 1,
      reason: 'invalid_results',
      status: 202,
    }))
  })

  it('continues flushing newer backlog work after partially retryable backlog batches', async () => {
    const stateDir = await makeStateDir()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: vi.fn().mockResolvedValue({
          accepted: 0,
          duplicates: 0,
          invalid: 1,
          results: [
            { event_id: 'event-invalid', status: 'invalid', retryable: false },
            { event_id: 'event-retry', status: 'server_error', retryable: true },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: vi.fn().mockResolvedValue({
          accepted: 1,
          duplicates: 0,
          invalid: 0,
          results: [
            { event_id: 'event-fresh', status: 'accepted', retryable: false },
          ],
        }),
      })

    await seedNamedReadySpool(stateDir, '0000000000000-mixed.json', {
      events: [
        makeEvent('session-invalid', 'event-invalid'),
        makeEvent('session-retry', 'event-retry'),
      ],
    })
    await seedNamedReadySpool(stateDir, '0000000000001-fresh.json', {
      events: [makeEvent('session-fresh', 'event-fresh')],
    })

    const result = await deliverBatch('http://localhost:8000', {
      events: [],
    }, {
      fetchImpl: fetchMock,
      stateDir,
    })

    expect(result).toEqual({
      delivered: false,
      buffered: true,
      flushed: 1,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const readyPayloads = await readSpoolPayloads(path.join(stateDir, 'spool', 'ready'))
    const quarantinePayloads = await readSpoolPayloads(path.join(stateDir, 'spool', 'quarantine'))

    expect(readyPayloads).toHaveLength(1)
    expect(readyPayloads[0]?.events.map((event) => event.event_id)).toEqual(['event-retry'])
    expect(quarantinePayloads).toHaveLength(1)
    expect(quarantinePayloads[0]?.events.map((event) => event.event_id)).toEqual(['event-invalid'])
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

  it('keeps quarantine payloads and metadata sidecars paired during cap pruning', async () => {
    const stateDir = await makeStateDir()
    const older = new Date('2026-04-05T12:00:00.000Z')
    const newer = new Date('2026-04-06T12:00:00.000Z')

    await seedStateFile(stateDir, ['spool', 'quarantine', 'older.json'], older)
    await seedStateFile(stateDir, ['spool', 'quarantine', 'older.meta.json'], older)
    await seedStateFile(stateDir, ['spool', 'quarantine', 'newer.json'], newer)
    await seedStateFile(stateDir, ['spool', 'quarantine', 'newer.meta.json'], newer)

    await pruneStateDirectory(stateDir, {
      now: new Date('2026-04-07T12:00:00.000Z'),
      retentionDays: 14,
      maxFiles: 1,
    })

    await expect(fs.readdir(path.join(stateDir, 'spool', 'quarantine'))).resolves.toEqual([
      'newer.json',
      'newer.meta.json',
    ])
  })
})

async function makeStateDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-delivery-'))
  tempDirs.push(dir)
  return dir
}

function makeEvent(sessionId: string, eventId?: string): NormalizedActivityEvent {
  return {
    event_id: eventId,
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
  await seedNamedReadySpool(stateDir, '0000000000000-backlog.json', batch)
}

async function seedNamedReadySpool(
  stateDir: string,
  fileName: string,
  batch: EventBatch,
): Promise<void> {
  const readyDir = path.join(stateDir, 'spool', 'ready')
  await fs.mkdir(readyDir, { recursive: true })
  await fs.writeFile(
    path.join(readyDir, fileName),
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

async function readPayloadFiles(directory: string): Promise<string[]> {
  return (await fs.readdir(directory))
    .filter((fileName) => fileName.endsWith('.json') && !fileName.endsWith('.meta.json'))
    .sort()
}

async function readMetadataFiles(directory: string): Promise<string[]> {
  return (await fs.readdir(directory))
    .filter((fileName) => fileName.endsWith('.meta.json'))
    .sort()
}

async function readSpoolPayloads(directory: string): Promise<EventBatch[]> {
  const fileNames = await readPayloadFiles(directory)
  return Promise.all(
    fileNames.map(async (fileName) => JSON.parse(
      await fs.readFile(path.join(directory, fileName), 'utf-8'),
    ) as EventBatch),
  )
}

async function readSpoolMetadata(directory: string): Promise<Record<string, unknown>[]> {
  const fileNames = await readMetadataFiles(directory)
  return Promise.all(
    fileNames.map(async (fileName) => JSON.parse(
      await fs.readFile(path.join(directory, fileName), 'utf-8'),
    ) as Record<string, unknown>),
  )
}
