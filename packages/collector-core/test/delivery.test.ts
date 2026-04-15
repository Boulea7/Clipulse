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
  vi.restoreAllMocks()
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
    const readyFiles = await readPayloadFiles(readyDir)
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
    const readyFiles = await readPayloadFiles(readyDir)
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

  it('does not treat orphaned ready metadata sidecars as pending backlog', async () => {
    const stateDir = await makeStateDir()
    const fetchMock = vi.fn().mockResolvedValue({
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

    const readyDir = path.join(stateDir, 'spool', 'ready')
    await fs.mkdir(readyDir, { recursive: true })
    await seedSpoolMetadata(readyDir, '0000000000000-orphan.json', {
      first_seen_at: '2026-04-01T00:00:00.000Z',
      attempt_count: 2,
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
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/api/v1/events/batch',
      expect.objectContaining({
        body: expect.stringContaining('event-current'),
      }),
    )
    await expect(readPayloadFiles(readyDir)).resolves.toEqual([])
    await expect(readMetadataFiles(readyDir)).resolves.toEqual(['0000000000000-orphan.meta.json'])
  })

  it('recovers orphaned processing files even when a ready file with the same name already exists', async () => {
    const stateDir = await makeStateDir()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
    })

    const readyDir = path.join(stateDir, 'spool', 'ready')
    const processingDir = path.join(stateDir, 'spool', 'processing')
    await fs.mkdir(readyDir, { recursive: true })
    await fs.mkdir(processingDir, { recursive: true })
    await fs.writeFile(
      path.join(readyDir, '0000000000000-collision.json'),
      JSON.stringify({ events: [makeEvent('session-ready')] }),
      'utf-8',
    )
    await fs.writeFile(
      path.join(processingDir, '0000000000000-collision.json'),
      JSON.stringify({ events: [makeEvent('session-processing')] }),
      'utf-8',
    )

    const result = await deliverBatch('http://localhost:8000', {
      events: [],
    }, {
      fetchImpl: fetchMock,
      stateDir,
    })

    expect(result).toEqual({
      delivered: true,
      buffered: false,
      flushed: 2,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8000/api/v1/events/batch',
      expect.objectContaining({
        body: expect.stringContaining('session-processing'),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8000/api/v1/events/batch',
      expect.objectContaining({
        body: expect.stringContaining('session-ready'),
      }),
    )
  })

  it('preserves both ready and processing lineage when recovery collisions displace an existing ready batch', async () => {
    const stateDir = await makeStateDir()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    })

    const readyDir = path.join(stateDir, 'spool', 'ready')
    const processingDir = path.join(stateDir, 'spool', 'processing')
    await fs.mkdir(readyDir, { recursive: true })
    await fs.mkdir(processingDir, { recursive: true })
    await fs.writeFile(
      path.join(readyDir, '0000000000000-collision.json'),
      JSON.stringify({ events: [makeEvent('session-ready', 'event-ready')] }),
      'utf-8',
    )
    await fs.writeFile(
      path.join(processingDir, '0000000000000-collision.json'),
      JSON.stringify({ events: [makeEvent('session-processing', 'event-processing')] }),
      'utf-8',
    )
    await seedSpoolMetadata(readyDir, '0000000000000-collision.json', {
      first_seen_at: '2026-04-01T00:00:00.000Z',
      last_attempted_at: '2026-04-02T00:00:00.000Z',
      attempt_count: 2,
    })
    await seedSpoolMetadata(processingDir, '0000000000000-collision.json', {
      first_seen_at: '2026-03-31T00:00:00.000Z',
      last_attempted_at: '2026-04-01T00:00:00.000Z',
      attempt_count: 4,
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
      flushed: 0,
    })
    const metadata = await readSpoolMetadata(readyDir)
    expect(metadata).toEqual(expect.arrayContaining([
      expect.objectContaining({
        first_seen_at: '2026-04-01T00:00:00.000Z',
        attempt_count: 2,
      }),
      expect.objectContaining({
        first_seen_at: '2026-03-31T00:00:00.000Z',
        attempt_count: 5,
      }),
    ]))
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
    const readyFiles = await readPayloadFiles(readyDir)
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
    const readyFiles = await readPayloadFiles(readyDir)
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
    const readyFiles = await readPayloadFiles(readyDir)
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

  it('preserves first_seen_at and increments attempt_count when retrying an older ready batch', async () => {
    const stateDir = await makeStateDir()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    })

    await seedNamedReadySpool(stateDir, '0000000000000-retry.json', {
      events: [makeEvent('session-retry', 'event-retry')],
    })
    await seedSpoolMetadata(path.join(stateDir, 'spool', 'ready'), '0000000000000-retry.json', {
      first_seen_at: '2026-04-01T00:00:00.000Z',
      last_attempted_at: '2026-04-02T00:00:00.000Z',
      attempt_count: 2,
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
      flushed: 0,
    })
    await expect(readMetadataFiles(path.join(stateDir, 'spool', 'processing'))).resolves.toEqual([])

    const metadata = await readSpoolMetadata(path.join(stateDir, 'spool', 'ready'))
    expect(metadata).toHaveLength(1)
    expect(metadata[0]).toEqual(expect.objectContaining({
      first_seen_at: '2026-04-01T00:00:00.000Z',
      attempt_count: 3,
    }))
    expect(metadata[0]?.last_attempted_at).not.toBe('2026-04-02T00:00:00.000Z')
  })

  it('recovers orphaned processing metadata without resetting first_seen_at', async () => {
    const stateDir = await makeStateDir()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    })

    const processingDir = path.join(stateDir, 'spool', 'processing')
    await fs.mkdir(processingDir, { recursive: true })
    await fs.writeFile(
      path.join(processingDir, '0000000000000-orphan.json'),
      JSON.stringify({ events: [makeEvent('session-orphan', 'event-orphan')] }),
      'utf-8',
    )
    await seedSpoolMetadata(processingDir, '0000000000000-orphan.json', {
      first_seen_at: '2026-03-31T00:00:00.000Z',
      last_attempted_at: '2026-04-01T00:00:00.000Z',
      attempt_count: 4,
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
      flushed: 0,
    })
    await expect(readMetadataFiles(processingDir)).resolves.toEqual([])

    const metadata = await readSpoolMetadata(path.join(stateDir, 'spool', 'ready'))
    expect(metadata).toHaveLength(1)
    expect(metadata[0]).toEqual(expect.objectContaining({
      first_seen_at: '2026-03-31T00:00:00.000Z',
      attempt_count: 5,
    }))
    expect(metadata[0]?.last_attempted_at).not.toBe('2026-04-01T00:00:00.000Z')
  })

  it('quarantines recovery_failed batches without resetting spool lineage', async () => {
    const stateDir = await makeStateDir()
    const processingDir = path.join(stateDir, 'spool', 'processing')
    await fs.mkdir(processingDir, { recursive: true })
    await fs.writeFile(
      path.join(processingDir, '0000000000000-recovery.json'),
      JSON.stringify({ events: [makeEvent('session-recovery', 'event-recovery')] }),
      'utf-8',
    )
    await seedSpoolMetadata(processingDir, '0000000000000-recovery.json', {
      first_seen_at: '2026-03-01T00:00:00.000Z',
      last_attempted_at: '2026-03-03T00:00:00.000Z',
      attempt_count: 5,
    })

    const originalRename = fs.rename.bind(fs)
    const renameMock = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (
        String(from).endsWith(path.join('processing', '0000000000000-recovery.json')) &&
        String(to).endsWith(path.join('ready', '0000000000000-recovery.json'))
      ) {
        throw new Error('simulated recovery failure')
      }

      return originalRename(from, to)
    })
    const fetchMock = vi.fn()

    const result = await deliverBatch('http://localhost:8000', {
      events: [],
    }, {
      fetchImpl: fetchMock,
      stateDir,
    })

    expect(renameMock).toHaveBeenCalled()
    expect(result).toEqual({
      delivered: true,
      buffered: false,
      flushed: 0,
    })
    expect(fetchMock).not.toHaveBeenCalled()
    await expect(readPayloadFiles(path.join(stateDir, 'spool', 'quarantine'))).resolves.toEqual([
      '0000000000000-recovery.json',
    ])
    const metadata = await readSpoolMetadata(path.join(stateDir, 'spool', 'quarantine'))
    expect(metadata).toEqual([
      expect.objectContaining({
        event_count: 1,
        reason: 'recovery_failed',
        source_state: 'processing',
        first_seen_at: '2026-03-01T00:00:00.000Z',
        last_attempted_at: '2026-03-03T00:00:00.000Z',
        attempt_count: 5,
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

  it('preserves shared backlog lineage across mixed retryable and quarantined backlog splits', async () => {
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

    await seedNamedReadySpool(stateDir, '0000000000000-mixed.json', {
      events: [
        makeEvent('session-invalid', 'event-invalid'),
        makeEvent('session-retry', 'event-retry'),
      ],
    })
    await seedSpoolMetadata(path.join(stateDir, 'spool', 'ready'), '0000000000000-mixed.json', {
      first_seen_at: '2026-04-01T00:00:00.000Z',
      last_attempted_at: '2026-04-03T00:00:00.000Z',
      attempt_count: 7,
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
      flushed: 0,
    })

    const readyMetadata = await readSpoolMetadata(path.join(stateDir, 'spool', 'ready'))
    const quarantineMetadata = await readSpoolMetadata(path.join(stateDir, 'spool', 'quarantine'))

    expect(readyMetadata).toEqual([
      expect.objectContaining({
        first_seen_at: '2026-04-01T00:00:00.000Z',
        attempt_count: 8,
      }),
    ])
    expect(quarantineMetadata).toEqual([
      expect.objectContaining({
        reason: 'invalid_results',
        first_seen_at: '2026-04-01T00:00:00.000Z',
        last_attempted_at: readyMetadata[0]?.last_attempted_at,
        attempt_count: 8,
      }),
    ])
  })

  it('quarantines unreadable backlog payloads with metadata sidecars', async () => {
    const stateDir = await makeStateDir()
    const readyDir = path.join(stateDir, 'spool', 'ready')
    await fs.mkdir(readyDir, { recursive: true })
    await fs.writeFile(
      path.join(readyDir, '0000000000000-bad.json'),
      '{"events": [',
      'utf-8',
    )

    const result = await deliverBatch('http://localhost:8000', {
      events: [],
    }, {
      fetchImpl: vi.fn(),
      stateDir,
    })

    expect(result).toEqual({
      delivered: true,
      buffered: false,
      flushed: 0,
    })

    await expect(readPayloadFiles(path.join(stateDir, 'spool', 'quarantine'))).resolves.toEqual([
      '0000000000000-bad.json',
    ])
    const metadata = await readSpoolMetadata(path.join(stateDir, 'spool', 'quarantine'))
    expect(metadata[0]).toEqual(expect.objectContaining({
      reason: 'invalid_spool_payload',
      status: null,
    }))
  })

  it('salvages valid attempt_count metadata even when first_seen_at is malformed', async () => {
    const stateDir = await makeStateDir()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    })

    await seedNamedReadySpool(stateDir, '0000000000000-salvage.json', {
      events: [makeEvent('session-salvage', 'event-salvage')],
    })
    await seedSpoolMetadata(path.join(stateDir, 'spool', 'ready'), '0000000000000-salvage.json', {
      first_seen_at: 'not-a-timestamp',
      last_attempted_at: '2026-04-03T00:00:00.000Z',
      attempt_count: 7,
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
      flushed: 0,
    })

    const metadata = await readSpoolMetadata(path.join(stateDir, 'spool', 'ready'))
    expect(metadata).toHaveLength(1)
    expect(metadata[0]).toEqual(expect.objectContaining({
      attempt_count: 8,
      last_attempted_at: expect.any(String),
    }))
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

  it('quarantines stale ready and processing backlog files instead of silently dropping them', async () => {
    const stateDir = await makeStateDir()
    const oldTimestamp = new Date('2026-03-01T00:00:00.000Z')

    await seedNamedReadySpool(stateDir, '0000000000000-ready.json', {
      events: [makeEvent('session-stale-ready', 'event-stale-ready')],
    })
    const processingDir = path.join(stateDir, 'spool', 'processing')
    await fs.mkdir(processingDir, { recursive: true })
    await fs.writeFile(
      path.join(processingDir, '0000000000001-processing.json'),
      JSON.stringify({ events: [makeEvent('session-stale-processing', 'event-stale-processing')] }),
      'utf-8',
    )
    await fs.utimes(path.join(stateDir, 'spool', 'ready', '0000000000000-ready.json'), oldTimestamp, oldTimestamp)
    await fs.utimes(path.join(processingDir, '0000000000001-processing.json'), oldTimestamp, oldTimestamp)

    await pruneStateDirectory(stateDir, {
      now: new Date('2026-04-06T12:00:00.000Z'),
      retentionDays: 14,
      maxFiles: 10,
    })

    await expect(readPayloadFiles(path.join(stateDir, 'spool', 'ready'))).resolves.toEqual([])
    await expect(readPayloadFiles(path.join(stateDir, 'spool', 'processing'))).resolves.toEqual([])
    await expect(readPayloadFiles(path.join(stateDir, 'spool', 'quarantine'))).resolves.toEqual([
      '0000000000000-ready.json',
      '0000000000001-processing.json',
    ])
    await expect(readMetadataFiles(path.join(stateDir, 'spool', 'quarantine'))).resolves.toEqual([
      '0000000000000-ready.meta.json',
      '0000000000001-processing.meta.json',
    ])
    const metadata = await readSpoolMetadata(path.join(stateDir, 'spool', 'quarantine'))
    expect(metadata).toEqual(expect.arrayContaining([
      expect.objectContaining({
        reason: 'stale_backlog',
        source_state: 'ready',
      }),
      expect.objectContaining({
        reason: 'stale_backlog',
        source_state: 'processing',
      }),
    ]))
  })

  it('inherits existing first_seen_at and attempt_count when stale backlog is quarantined', async () => {
    const stateDir = await makeStateDir()
    const oldTimestamp = new Date('2026-03-01T00:00:00.000Z')

    await seedNamedReadySpool(stateDir, '0000000000000-ready.json', {
      events: [makeEvent('session-stale-ready', 'event-stale-ready')],
    })
    await seedSpoolMetadata(path.join(stateDir, 'spool', 'ready'), '0000000000000-ready.json', {
      first_seen_at: '2026-02-28T12:00:00.000Z',
      last_attempted_at: '2026-03-01T12:00:00.000Z',
      attempt_count: 6,
    })
    await fs.utimes(path.join(stateDir, 'spool', 'ready', '0000000000000-ready.json'), oldTimestamp, oldTimestamp)

    await pruneStateDirectory(stateDir, {
      now: new Date('2026-04-06T12:00:00.000Z'),
      retentionDays: 14,
      maxFiles: 10,
    })

    const metadata = await readSpoolMetadata(path.join(stateDir, 'spool', 'quarantine'))
    expect(metadata).toEqual([
      expect.objectContaining({
        reason: 'stale_backlog',
        source_state: 'ready',
        first_seen_at: '2026-02-28T12:00:00.000Z',
        last_attempted_at: '2026-03-01T12:00:00.000Z',
        attempt_count: 6,
      }),
    ])
  })

  it('quarantines the oldest backlog batches when ready and processing exceed the spool size cap', async () => {
    const stateDir = await makeStateDir()
    const older = new Date('2026-04-05T12:00:00.000Z')
    const newer = new Date('2026-04-06T12:00:00.000Z')

    await seedNamedReadySpool(stateDir, '0000000000000-old.json', {
      events: [makeEvent('session-old', 'event-old')],
    })
    await seedNamedReadySpool(stateDir, '0000000000001-new.json', {
      events: [makeEvent('session-new', 'event-new')],
    })
    await fs.utimes(path.join(stateDir, 'spool', 'ready', '0000000000000-old.json'), older, older)
    await fs.utimes(path.join(stateDir, 'spool', 'ready', '0000000000001-new.json'), newer, newer)

    const newSize = (await fs.stat(path.join(stateDir, 'spool', 'ready', '0000000000001-new.json'))).size

    await pruneStateDirectory(stateDir, {
      now: new Date('2026-04-07T12:00:00.000Z'),
      retentionDays: 14,
      maxFiles: 10,
      maxSpoolBytes: newSize,
    })

    await expect(readPayloadFiles(path.join(stateDir, 'spool', 'ready'))).resolves.toEqual([
      '0000000000001-new.json',
    ])
    await expect(readPayloadFiles(path.join(stateDir, 'spool', 'quarantine'))).resolves.toEqual([
      '0000000000000-old.json',
    ])
    const metadata = await readSpoolMetadata(path.join(stateDir, 'spool', 'quarantine'))
    expect(metadata[0]).toEqual(expect.objectContaining({
      reason: 'spool_size_cap',
      source_state: 'ready',
    }))
  })

  it('inherits existing first_seen_at and attempt_count when the spool size cap quarantines a batch', async () => {
    const stateDir = await makeStateDir()
    const older = new Date('2026-04-05T12:00:00.000Z')
    const newer = new Date('2026-04-06T12:00:00.000Z')

    await seedNamedReadySpool(stateDir, '0000000000000-old.json', {
      events: [makeEvent('session-old', 'event-old')],
    })
    await seedNamedReadySpool(stateDir, '0000000000001-new.json', {
      events: [makeEvent('session-new', 'event-new')],
    })
    await seedSpoolMetadata(path.join(stateDir, 'spool', 'ready'), '0000000000000-old.json', {
      first_seen_at: '2026-04-01T00:00:00.000Z',
      last_attempted_at: '2026-04-03T00:00:00.000Z',
      attempt_count: 7,
    })
    await fs.utimes(path.join(stateDir, 'spool', 'ready', '0000000000000-old.json'), older, older)
    await fs.utimes(path.join(stateDir, 'spool', 'ready', '0000000000001-new.json'), newer, newer)

    const newSize = (await fs.stat(path.join(stateDir, 'spool', 'ready', '0000000000001-new.json'))).size

    await pruneStateDirectory(stateDir, {
      now: new Date('2026-04-07T12:00:00.000Z'),
      retentionDays: 14,
      maxFiles: 10,
      maxSpoolBytes: newSize,
    })

    const metadata = await readSpoolMetadata(path.join(stateDir, 'spool', 'quarantine'))
    expect(metadata).toEqual([
      expect.objectContaining({
        reason: 'spool_size_cap',
        source_state: 'ready',
        first_seen_at: '2026-04-01T00:00:00.000Z',
        last_attempted_at: '2026-04-03T00:00:00.000Z',
        attempt_count: 7,
      }),
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

async function seedSpoolMetadata(
  directory: string,
  payloadFileName: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(
    path.join(directory, payloadFileName.replace(/\.json$/, '.meta.json')),
    JSON.stringify(metadata),
    'utf-8',
  )
}
