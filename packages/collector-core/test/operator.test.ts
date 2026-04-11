import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { inspectLocalOperatorState, pruneStateDirectory } from '../src/index.js'
import { runCollectorCoreCli } from '../src/cli.js'

const tempDirs: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true })
    }),
  )
})

describe('inspectLocalOperatorState', () => {
  it('reports whether the local state directory exists', async () => {
    const existingStateDir = await makeStateDir()
    const missingRootDir = await makeStateDir()
    const missingStateDir = path.join(missingRootDir, 'missing-state')

    const existingSummary = await inspectLocalOperatorState(existingStateDir)
    const missingSummary = await inspectLocalOperatorState(missingStateDir)

    expect(existingSummary.stateDirExists).toBe(true)
    expect(missingSummary.stateDirExists).toBe(false)
  })

  it('summarizes payload backlog, quarantine reasons, and orphan sidecars', async () => {
    const stateDir = await makeStateDir()
    const readyDir = path.join(stateDir, 'spool', 'ready')
    const processingDir = path.join(stateDir, 'spool', 'processing')
    const quarantineDir = path.join(stateDir, 'spool', 'quarantine')

    await fs.mkdir(readyDir, { recursive: true })
    await fs.mkdir(processingDir, { recursive: true })
    await fs.mkdir(quarantineDir, { recursive: true })

    await writePayload(readyDir, '0001-ready.json', ['event-ready-1', 'event-ready-2'])
    await writeMetadata(readyDir, '0001-ready.json', {
      first_seen_at: '2026-04-07T10:00:00.000Z',
      last_attempted_at: '2026-04-07T10:05:00.000Z',
      attempt_count: 3,
    })
    await writeMetadata(readyDir, '0002-orphan.json', {
      first_seen_at: '2026-04-07T09:00:00.000Z',
      attempt_count: 1,
    })

    await writePayload(processingDir, '0003-processing.json', ['event-processing'])
    await writeMetadata(processingDir, '0003-processing.json', {
      first_seen_at: '2026-04-07T11:00:00.000Z',
      last_attempted_at: '2026-04-07T11:01:00.000Z',
      attempt_count: 2,
    })

    await writePayload(quarantineDir, '0004-quarantine.json', ['event-quarantine'])
    await writeMetadata(quarantineDir, '0004-quarantine.json', {
      reason: 'invalid_results',
      source_state: 'ready',
      first_seen_at: '2026-04-06T11:00:00.000Z',
      last_attempted_at: '2026-04-06T11:02:00.000Z',
      attempt_count: 4,
      approx_bytes: 123,
    })

    const summary = await inspectLocalOperatorState(stateDir)

    expect(summary.stateDir).toBe(stateDir)
    expect(summary.payloadCounts).toEqual({
      ready: 1,
      processing: 1,
      quarantine: 1,
    })
    expect(summary.orphanMetadataCounts).toEqual({
      ready: 1,
      processing: 0,
      quarantine: 0,
    })
    expect(summary.reasonCounts).toEqual({
      invalid_results: 1,
    })
    expect(summary.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        state: 'ready',
        fileName: '0001-ready.json',
        eventCount: 2,
        attemptCount: 3,
      }),
      expect.objectContaining({
        state: 'quarantine',
        fileName: '0004-quarantine.json',
        reason: 'invalid_results',
        sourceState: 'ready',
      }),
    ]))
  })

  it('keeps logical state ordering and salvages valid metadata fields from malformed sidecars', async () => {
    const stateDir = await makeStateDir()
    const readyDir = path.join(stateDir, 'spool', 'ready')
    const processingDir = path.join(stateDir, 'spool', 'processing')
    const quarantineDir = path.join(stateDir, 'spool', 'quarantine')

    await fs.mkdir(readyDir, { recursive: true })
    await fs.mkdir(processingDir, { recursive: true })
    await fs.mkdir(quarantineDir, { recursive: true })

    await writePayload(readyDir, '0002-ready.json', ['event-ready'])
    await writeMetadata(readyDir, '0002-ready.json', {
      first_seen_at: 'not-a-timestamp',
      last_attempted_at: '2026-04-07T10:05:00.000Z',
      attempt_count: 2,
    })
    await writePayload(processingDir, '0001-processing.json', ['event-processing'])
    await writeMetadata(processingDir, '0001-processing.json', {
      first_seen_at: '2026-04-07T11:00:00.000Z',
      last_attempted_at: '2026-04-07T11:05:00.000Z',
      attempt_count: 3,
    })
    await writePayload(quarantineDir, '0003-quarantine.json', ['event-quarantine'])
    await writeMetadata(quarantineDir, '0003-quarantine.json', {
      reason: 'spool_size_cap',
      source_state: 'processing',
      first_seen_at: 'broken',
      last_attempted_at: '2026-04-07T09:05:00.000Z',
      attempt_count: 4,
      approx_bytes: 321,
    })

    const summary = await inspectLocalOperatorState(stateDir)

    expect(summary.entries.map((entry) => `${entry.state}:${entry.fileName}`)).toEqual([
      'ready:0002-ready.json',
      'processing:0001-processing.json',
      'quarantine:0003-quarantine.json',
    ])
    expect(summary.entries[0]).toEqual(expect.objectContaining({
      state: 'ready',
      attemptCount: 2,
      firstSeenAt: null,
      lastAttemptedAt: '2026-04-07T10:05:00.000Z',
    }))
    expect(summary.entries[2]).toEqual(expect.objectContaining({
      state: 'quarantine',
      reason: 'spool_size_cap',
      sourceState: 'processing',
      approxBytes: 321,
      firstSeenAt: null,
      lastAttemptedAt: '2026-04-07T09:05:00.000Z',
    }))
  })
})

describe('runCollectorCoreCli', () => {
  it.each([
    { args: [], label: 'no command' },
    { args: ['mystery'], label: 'unknown command' },
  ])('renders doctor output for %s instead of adding command branching', async ({ args }) => {
    const stateDir = await makeStateDir()
    const stdout = vi.fn()

    await runCollectorCoreCli({
      args,
      env: {
        CLIPULSE_STATE_DIR: stateDir,
      },
      stdout: { write: stdout },
    })

    const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('')
    expect(output).toContain('Clipulse local operator doctor')
    expect(output).not.toContain('Clipulse local operator pending')
  })

  it('prints an explicit fallback note for unknown commands', async () => {
    const stateDir = await makeStateDir()
    const stdout = vi.fn()

    await runCollectorCoreCli({
      args: ['mystery'],
      env: {
        CLIPULSE_STATE_DIR: stateDir,
      },
      stdout: { write: stdout },
    })

    const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('')
    expect(output).toContain('unknown command "mystery"; falling back to doctor')
  })

  it('does not create a state directory when doctor inspects a missing path', async () => {
    const rootDir = await makeStateDir()
    const missingStateDir = path.join(rootDir, 'missing-state')
    const stdout = vi.fn()

    await runCollectorCoreCli({
      args: ['doctor'],
      env: {
        CLIPULSE_STATE_DIR: missingStateDir,
      },
      stdout: { write: stdout },
    })

    await expect(fs.stat(missingStateDir)).rejects.toThrow()
    const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('')
    expect(output).toBe([
      'Clipulse local operator doctor',
      `state dir: ${missingStateDir}`,
      'ready: 0 | processing: 0 | quarantine: 0',
      'payload bytes: ready=0 processing=0 quarantine=0',
      'oldest age seconds: ready=0 processing=0 quarantine=0',
      'payload counts and bytes exclude local .meta.json sidecars',
      'no local state directory yet: hooks may not have created local spool state on this machine',
      '',
    ].join('\n'))
  })

  it('does not create a state directory when pending inspects a missing path', async () => {
    const rootDir = await makeStateDir()
    const missingStateDir = path.join(rootDir, 'missing-state')
    const stdout = vi.fn()

    await runCollectorCoreCli({
      args: ['pending'],
      env: {
        CLIPULSE_STATE_DIR: missingStateDir,
      },
      stdout: { write: stdout },
    })

    await expect(fs.stat(missingStateDir)).rejects.toThrow()
    const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('')
    expect(output).toBe([
      'Clipulse local operator pending',
      `state dir: ${missingStateDir}`,
      'no local state directory yet: hooks may not have created local spool state on this machine',
      'pending backlog unavailable without local state yet',
      '',
    ].join('\n'))
  })

  it('treats an existing empty state directory differently from a missing one', async () => {
    const stateDir = await makeStateDir()
    const doctorStdout = vi.fn()
    const pendingStdout = vi.fn()

    await runCollectorCoreCli({
      args: ['doctor'],
      env: {
        CLIPULSE_STATE_DIR: stateDir,
      },
      stdout: { write: doctorStdout },
    })
    await runCollectorCoreCli({
      args: ['pending'],
      env: {
        CLIPULSE_STATE_DIR: stateDir,
      },
      stdout: { write: pendingStdout },
    })

    const doctorOutput = doctorStdout.mock.calls.map(([chunk]) => String(chunk)).join('')
    const pendingOutput = pendingStdout.mock.calls.map(([chunk]) => String(chunk)).join('')

    expect(doctorOutput).toBe([
      'Clipulse local operator doctor',
      `state dir: ${stateDir}`,
      'ready: 0 | processing: 0 | quarantine: 0',
      'payload bytes: ready=0 processing=0 quarantine=0',
      'oldest age seconds: ready=0 processing=0 quarantine=0',
      'payload counts and bytes exclude local .meta.json sidecars',
      '',
    ].join('\n'))
    expect(pendingOutput).toBe([
      'Clipulse local operator pending',
      `state dir: ${stateDir}`,
      'no payload backlog entries',
      '',
    ].join('\n'))
    expect(doctorOutput).not.toContain('no local state directory yet')
    expect(pendingOutput).not.toContain('no local state directory yet')
  })

  it('prints a doctor summary with orphan and quarantine hints', async () => {
    const stateDir = await makeStateDir()
    const readyDir = path.join(stateDir, 'spool', 'ready')
    const quarantineDir = path.join(stateDir, 'spool', 'quarantine')

    await fs.mkdir(readyDir, { recursive: true })
    await fs.mkdir(quarantineDir, { recursive: true })
    await writePayload(readyDir, '0001-ready.json', ['event-ready'])
    await writeMetadata(readyDir, '0002-orphan.json', {
      first_seen_at: '2026-04-07T09:00:00.000Z',
      attempt_count: 1,
    })
    await writePayload(quarantineDir, '0003-quarantine.json', ['event-quarantine'])
    await writeMetadata(quarantineDir, '0003-quarantine.json', {
      reason: 'stale_backlog',
      source_state: 'processing',
      first_seen_at: '2026-04-06T11:00:00.000Z',
      last_attempted_at: '2026-04-06T11:02:00.000Z',
      attempt_count: 4,
    })

    const stdout = vi.fn()

    await runCollectorCoreCli({
      args: ['doctor'],
      env: {
        CLIPULSE_STATE_DIR: stateDir,
      },
      stdout: { write: stdout },
    })

    const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('')
    expect(output).toContain('Clipulse local operator doctor')
    expect(output).toContain('ready: 1')
    expect(output).toContain('quarantine: 1')
    expect(output).toContain('payload counts and bytes exclude local .meta.json sidecars')
    expect(output).toContain('orphan metadata sidecars')
    expect(output).toContain('stale_backlog')
    expect(output).toContain('stale backlog retained in quarantine')
  })

  it('flags processing-only backlog in doctor output without adding new commands', async () => {
    const stateDir = await makeStateDir()
    const processingDir = path.join(stateDir, 'spool', 'processing')

    await fs.mkdir(processingDir, { recursive: true })
    await writePayload(processingDir, '0003-processing.json', ['event-processing'])
    await writeMetadata(processingDir, '0003-processing.json', {
      first_seen_at: '2026-04-07T11:00:00.000Z',
      last_attempted_at: '2026-04-07T11:01:00.000Z',
      attempt_count: 2,
    })

    const stdout = vi.fn()

    await runCollectorCoreCli({
      args: ['doctor'],
      env: {
        CLIPULSE_STATE_DIR: stateDir,
      },
      stdout: { write: stdout },
    })

    const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('')
    expect(output).toContain('processing-only backlog: a hook may still need to recover or flush this batch')
  })

  it('does not label processing backlog as processing-only when quarantine entries also exist', async () => {
    const stateDir = await makeStateDir()
    const processingDir = path.join(stateDir, 'spool', 'processing')
    const quarantineDir = path.join(stateDir, 'spool', 'quarantine')

    await fs.mkdir(processingDir, { recursive: true })
    await fs.mkdir(quarantineDir, { recursive: true })
    await writePayload(processingDir, '0003-processing.json', ['event-processing'])
    await writeMetadata(processingDir, '0003-processing.json', {
      first_seen_at: '2026-04-07T11:00:00.000Z',
      last_attempted_at: '2026-04-07T11:01:00.000Z',
      attempt_count: 2,
    })
    await writePayload(quarantineDir, '0004-quarantine.json', ['event-quarantine'])
    await writeMetadata(quarantineDir, '0004-quarantine.json', {
      reason: 'invalid_results',
      source_state: 'processing',
      first_seen_at: '2026-04-07T11:02:00.000Z',
      last_attempted_at: '2026-04-07T11:03:00.000Z',
      attempt_count: 1,
    })

    const stdout = vi.fn()

    await runCollectorCoreCli({
      args: ['doctor'],
      env: {
        CLIPULSE_STATE_DIR: stateDir,
      },
      stdout: { write: stdout },
    })

    const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('')
    expect(output).not.toContain('processing-only backlog: a hook may still need to recover or flush this batch')
    expect(output).toContain('mixed backlog: flushable payloads coexist with quarantine entries')
  })

  it('flags quarantine-only backlog in doctor output without adding new commands', async () => {
    const stateDir = await makeStateDir()
    const quarantineDir = path.join(stateDir, 'spool', 'quarantine')

    await fs.mkdir(quarantineDir, { recursive: true })
    await writePayload(quarantineDir, '0004-quarantine.json', ['event-quarantine'])
    await writeMetadata(quarantineDir, '0004-quarantine.json', {
      reason: 'stale_backlog',
      source_state: 'ready',
      first_seen_at: '2026-04-06T11:00:00.000Z',
      last_attempted_at: '2026-04-06T11:02:00.000Z',
      attempt_count: 4,
    })

    const stdout = vi.fn()

    await runCollectorCoreCli({
      args: ['doctor'],
      env: {
        CLIPULSE_STATE_DIR: stateDir,
      },
      stdout: { write: stdout },
    })

    const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('')
    expect(output).toContain('quarantine-only backlog: no payload is waiting to auto-flush; inspect quarantine entries and reasons')
  })

  it('prints pending payload entries without counting orphan sidecars as payload backlog', async () => {
    const stateDir = await makeStateDir()
    const readyDir = path.join(stateDir, 'spool', 'ready')

    await fs.mkdir(readyDir, { recursive: true })
    await writePayload(readyDir, '0001-ready.json', ['event-ready'])
    await writeMetadata(readyDir, '0001-ready.json', {
      first_seen_at: '2026-04-07T10:00:00.000Z',
      last_attempted_at: '2026-04-07T10:05:00.000Z',
      attempt_count: 3,
    })
    await writeMetadata(readyDir, '0002-orphan.json', {
      first_seen_at: '2026-04-07T09:00:00.000Z',
      attempt_count: 1,
    })

    const stdout = vi.fn()

    await runCollectorCoreCli({
      args: ['pending'],
      env: {
        CLIPULSE_STATE_DIR: stateDir,
      },
      stdout: { write: stdout },
    })

    const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('')
    expect(output).toContain('Clipulse local operator pending')
    expect(output).toContain('[ready] 0001-ready.json')
    expect(output).toContain('events=1')
    expect(output).toContain('attempts=3')
    expect(output).toContain('orphan metadata sidecars: ready=1')
    expect(output).not.toContain('0002-orphan.json')
  })

  it('reports no payload backlog while still surfacing orphan sidecars', async () => {
    const stateDir = await makeStateDir()
    const readyDir = path.join(stateDir, 'spool', 'ready')
    const quarantineDir = path.join(stateDir, 'spool', 'quarantine')

    await fs.mkdir(readyDir, { recursive: true })
    await fs.mkdir(quarantineDir, { recursive: true })
    await writeMetadata(readyDir, '0001-orphan.json', {
      first_seen_at: '2026-04-07T09:00:00.000Z',
      attempt_count: 1,
    })
    await writeMetadata(quarantineDir, '0002-orphan.json', {
      reason: 'invalid_results',
      source_state: 'ready',
      first_seen_at: '2026-04-07T09:05:00.000Z',
      attempt_count: 2,
    })

    const stdout = vi.fn()

    await runCollectorCoreCli({
      args: ['pending'],
      env: {
        CLIPULSE_STATE_DIR: stateDir,
      },
      stdout: { write: stdout },
    })

    const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('')
    expect(output).toContain('no payload backlog entries')
    expect(output).toContain('orphan metadata sidecars: ready=1 processing=0 quarantine=1')
  })

  it('flags orphan-only backlog in doctor output without adding new commands', async () => {
    const stateDir = await makeStateDir()
    const readyDir = path.join(stateDir, 'spool', 'ready')

    await fs.mkdir(readyDir, { recursive: true })
    await writeMetadata(readyDir, '0001-orphan.json', {
      first_seen_at: '2026-04-07T09:00:00.000Z',
      attempt_count: 1,
    })

    const stdout = vi.fn()

    await runCollectorCoreCli({
      args: ['doctor'],
      env: {
        CLIPULSE_STATE_DIR: stateDir,
      },
      stdout: { write: stdout },
    })

    const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('')
    expect(output).toContain('orphan-only backlog: metadata sidecars remain without payload files; inspect local spool cleanup and last recovery path')
  })

  it('keeps quarantine lineage visible after stale backlog pruning', async () => {
    const stateDir = await makeStateDir()
    const readyDir = path.join(stateDir, 'spool', 'ready')

    await fs.mkdir(readyDir, { recursive: true })
    await writePayload(readyDir, '0005-ready.json', ['event-ready'])
    await writeMetadata(readyDir, '0005-ready.json', {
      first_seen_at: '2026-03-01T00:00:00.000Z',
      last_attempted_at: '2026-03-03T00:00:00.000Z',
      attempt_count: 5,
    })

    const oldDate = new Date('2026-03-01T00:00:00.000Z')
    await fs.utimes(path.join(readyDir, '0005-ready.json'), oldDate, oldDate)

    await pruneStateDirectory(stateDir, {
      now: new Date('2026-04-08T00:00:00.000Z'),
      retentionDays: 14,
    })

    const summary = await inspectLocalOperatorState(stateDir)
    expect(summary.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        state: 'quarantine',
        fileName: '0005-ready.json',
        reason: 'stale_backlog',
        sourceState: 'ready',
        attemptCount: 5,
        firstSeenAt: '2026-03-01T00:00:00.000Z',
        lastAttemptedAt: '2026-03-03T00:00:00.000Z',
      }),
    ]))
  })

  it('keeps pending entry bytes on sidecar approx_bytes while doctor aggregate bytes stay payload-based', async () => {
    const stateDir = await makeStateDir()
    const readyDir = path.join(stateDir, 'spool', 'ready')

    await fs.mkdir(readyDir, { recursive: true })
    await writePayload(readyDir, '0006-ready.json', ['event-ready'])
    await writeMetadata(readyDir, '0006-ready.json', {
      first_seen_at: '2026-04-07T10:00:00.000Z',
      last_attempted_at: '2026-04-07T10:05:00.000Z',
      attempt_count: 3,
      approx_bytes: 321,
    })

    const payloadSize = (
      await fs.stat(path.join(readyDir, '0006-ready.json'))
    ).size
    const doctorStdout = vi.fn()
    const pendingStdout = vi.fn()

    await runCollectorCoreCli({
      args: ['doctor'],
      env: {
        CLIPULSE_STATE_DIR: stateDir,
      },
      stdout: { write: doctorStdout },
    })
    await runCollectorCoreCli({
      args: ['pending'],
      env: {
        CLIPULSE_STATE_DIR: stateDir,
      },
      stdout: { write: pendingStdout },
    })

    const doctorOutput = doctorStdout.mock.calls.map(([chunk]) => String(chunk)).join('')
    const pendingOutput = pendingStdout.mock.calls.map(([chunk]) => String(chunk)).join('')
    expect(doctorOutput).toContain(`payload bytes: ready=${payloadSize} processing=0 quarantine=0`)
    expect(pendingOutput).toContain('[ready] 0006-ready.json')
    expect(pendingOutput).toContain('bytes=321')
  })

  it('prints stable mixed-state doctor and pending output without adding commands', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T12:00:00.000Z'))

    const stateDir = await makeStateDir()
    const readyDir = path.join(stateDir, 'spool', 'ready')
    const processingDir = path.join(stateDir, 'spool', 'processing')
    const quarantineDir = path.join(stateDir, 'spool', 'quarantine')

    await fs.mkdir(readyDir, { recursive: true })
    await fs.mkdir(processingDir, { recursive: true })
    await fs.mkdir(quarantineDir, { recursive: true })

    await writePayload(readyDir, '0001-ready.json', ['event-ready-1', 'event-ready-2'])
    await writeMetadata(readyDir, '0001-ready.json', {
      first_seen_at: '2026-04-08T11:57:00.000Z',
      last_attempted_at: '2026-04-08T11:58:30.000Z',
      attempt_count: 3,
    })
    await setFileTimestamp(
      path.join(readyDir, '0001-ready.json'),
      '2026-04-08T11:58:00.000Z',
    )
    await writeMetadata(readyDir, '0004-orphan.json', {
      first_seen_at: '2026-04-08T11:55:00.000Z',
      attempt_count: 1,
    })

    await writePayload(processingDir, '0002-processing.json', ['event-processing'])
    await writeMetadata(processingDir, '0002-processing.json', {
      first_seen_at: '2026-04-08T11:59:00.000Z',
      last_attempted_at: '2026-04-08T11:59:20.000Z',
      attempt_count: 4,
    })
    await setFileTimestamp(
      path.join(processingDir, '0002-processing.json'),
      '2026-04-08T11:59:30.000Z',
    )

    await writePayload(quarantineDir, '0003-quarantine.json', ['event-quarantine'])
    await writeMetadata(quarantineDir, '0003-quarantine.json', {
      reason: 'spool_size_cap',
      source_state: 'processing',
      first_seen_at: '2026-04-08T11:50:00.000Z',
      last_attempted_at: '2026-04-08T11:56:00.000Z',
      attempt_count: 5,
      approx_bytes: 777,
    })
    await setFileTimestamp(
      path.join(quarantineDir, '0003-quarantine.json'),
      '2026-04-08T11:56:00.000Z',
    )

    const readyPayloadBytes = (
      await fs.stat(path.join(readyDir, '0001-ready.json'))
    ).size
    const processingPayloadBytes = (
      await fs.stat(path.join(processingDir, '0002-processing.json'))
    ).size
    const quarantinePayloadBytes = (
      await fs.stat(path.join(quarantineDir, '0003-quarantine.json'))
    ).size
    const doctorStdout = vi.fn()
    const pendingStdout = vi.fn()

    await runCollectorCoreCli({
      args: ['doctor'],
      env: {
        CLIPULSE_STATE_DIR: stateDir,
      },
      stdout: { write: doctorStdout },
    })
    await runCollectorCoreCli({
      args: ['pending'],
      env: {
        CLIPULSE_STATE_DIR: stateDir,
      },
      stdout: { write: pendingStdout },
    })

    const doctorOutput = doctorStdout.mock.calls.map(([chunk]) => String(chunk)).join('')
    const pendingOutput = pendingStdout.mock.calls.map(([chunk]) => String(chunk)).join('')

    expect(doctorOutput).toBe([
      'Clipulse local operator doctor',
      `state dir: ${stateDir}`,
      'ready: 1 | processing: 1 | quarantine: 1',
      `payload bytes: ready=${readyPayloadBytes} processing=${processingPayloadBytes} quarantine=${quarantinePayloadBytes}`,
      'oldest age seconds: ready=120 processing=30 quarantine=240',
      'payload counts and bytes exclude local .meta.json sidecars',
      'mixed backlog: flushable payloads coexist with quarantine entries',
      'orphan metadata sidecars: ready=1 processing=0 quarantine=0',
      'quarantine reasons: spool_size_cap=1',
      'spool size cap quarantined older payloads: inspect backlog volume before increasing local spool limits',
      '',
    ].join('\n'))
    expect(pendingOutput).toBe([
      'Clipulse local operator pending',
      `state dir: ${stateDir}`,
      `[ready] 0001-ready.json | events=2 | bytes=${readyPayloadBytes} | attempts=3 | first_seen_at=2026-04-08T11:57:00.000Z | last_attempted_at=2026-04-08T11:58:30.000Z`,
      `[processing] 0002-processing.json | events=1 | bytes=${processingPayloadBytes} | attempts=4 | first_seen_at=2026-04-08T11:59:00.000Z | last_attempted_at=2026-04-08T11:59:20.000Z`,
      '[quarantine] 0003-quarantine.json | events=1 | bytes=777 | attempts=5 | first_seen_at=2026-04-08T11:50:00.000Z | last_attempted_at=2026-04-08T11:56:00.000Z | reason=spool_size_cap | source_state=processing',
      'orphan metadata sidecars: ready=1 processing=0 quarantine=0',
      '',
    ].join('\n'))
  })

  it('uses payload mtimes for oldestAgeSeconds instead of sidecar mtimes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T12:00:00.000Z'))

    const stateDir = await makeStateDir()
    const readyDir = path.join(stateDir, 'spool', 'ready')

    await fs.mkdir(readyDir, { recursive: true })
    await writePayload(readyDir, '0007-ready.json', ['event-ready'])
    await writeMetadata(readyDir, '0007-ready.json', {
      first_seen_at: '2026-04-07T10:00:00.000Z',
      attempt_count: 3,
    })
    await setFileTimestamp(
      path.join(readyDir, '0007-ready.json'),
      '2026-04-08T11:59:00.000Z',
    )
    await setFileTimestamp(
      path.join(readyDir, '0007-ready.meta.json'),
      '2026-04-08T10:00:00.000Z',
    )
    await writeMetadata(readyDir, '0008-orphan.json', {
      first_seen_at: '2026-04-01T10:00:00.000Z',
      attempt_count: 1,
    })
    await setFileTimestamp(
      path.join(readyDir, '0008-orphan.meta.json'),
      '2026-04-01T10:00:00.000Z',
    )

    const summary = await inspectLocalOperatorState(stateDir)

    expect(summary.oldestAgeSeconds).toEqual({
      ready: 60,
      processing: 0,
      quarantine: 0,
    })
    expect(summary.orphanMetadataCounts).toEqual({
      ready: 1,
      processing: 0,
      quarantine: 0,
    })
  })

  it('keeps sidecar-derived fields visible when a payload shape is unreadable for event counting', async () => {
    const stateDir = await makeStateDir()
    const readyDir = path.join(stateDir, 'spool', 'ready')

    await fs.mkdir(readyDir, { recursive: true })
    await fs.writeFile(
      path.join(readyDir, '0009-bad.json'),
      JSON.stringify({ events: null }),
      'utf-8',
    )
    await writeMetadata(readyDir, '0009-bad.json', {
      first_seen_at: '2026-04-08T11:40:00.000Z',
      last_attempted_at: '2026-04-08T11:45:00.000Z',
      attempt_count: 7,
      approx_bytes: 909,
    })

    const summary = await inspectLocalOperatorState(stateDir)
    const pendingStdout = vi.fn()

    await runCollectorCoreCli({
      args: ['pending'],
      env: {
        CLIPULSE_STATE_DIR: stateDir,
      },
      stdout: { write: pendingStdout },
    })

    expect(summary.payloadCounts).toEqual({
      ready: 1,
      processing: 0,
      quarantine: 0,
    })
    expect(summary.orphanMetadataCounts).toEqual({
      ready: 0,
      processing: 0,
      quarantine: 0,
    })
    expect(summary.entries).toEqual([
      expect.objectContaining({
        state: 'ready',
        fileName: '0009-bad.json',
        eventCount: 0,
        approxBytes: 909,
        attemptCount: 7,
        firstSeenAt: '2026-04-08T11:40:00.000Z',
        lastAttemptedAt: '2026-04-08T11:45:00.000Z',
      }),
    ])
    const pendingOutput = pendingStdout.mock.calls.map(([chunk]) => String(chunk)).join('')
    expect(pendingOutput).toContain('[ready] 0009-bad.json | events=0 | bytes=909 | attempts=7')
  })
})

async function makeStateDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-operator-'))
  tempDirs.push(dir)
  return dir
}

async function writePayload(
  directory: string,
  fileName: string,
  eventIds: string[],
): Promise<void> {
  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(
    path.join(directory, fileName),
    JSON.stringify({
      events: eventIds.map((eventId) => ({
        event_id: eventId,
        host: 'codex',
        host_version: '0.1.0',
        session_id: `${eventId}-session`,
        project_root: '/workspace/demo',
        project_name: 'demo',
        git_branch: 'main',
        event_name: 'stop',
        event_time: '2026-04-07T12:00:00Z',
        model_name: 'gpt-5.4',
        os_name: 'macos',
        editor_or_terminal: 'terminal',
        active_ms: 1000,
        wait_ms: 100,
        privacy_mode: 'hashed',
        language_stats: {},
        file_deltas: [],
      })),
    }),
    'utf-8',
  )
}

async function writeMetadata(
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

async function setFileTimestamp(filePath: string, isoTimestamp: string): Promise<void> {
  const timestamp = new Date(isoTimestamp)
  await fs.utimes(filePath, timestamp, timestamp)
}
