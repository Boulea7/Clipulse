import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { inspectLocalOperatorState } from '../src/index.js'
import { runCollectorCoreCli } from '../src/cli.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true })
    }),
  )
})

describe('inspectLocalOperatorState', () => {
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
})

describe('runCollectorCoreCli', () => {
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
    expect(output).toContain('orphan metadata sidecars')
    expect(output).toContain('stale_backlog')
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
