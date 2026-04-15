import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { createFileFingerprint } from '@clipulse/collector-core'
import { createClipulsePlugin, runClipulseSmokeScenario } from '../examples/clipulse.js'
import {
  assertOpenCodeSmokePayloads,
  assertOpenCodeSmokePreflight,
  createOpenCodeSmokePlan,
  parseOpenCodeSmokeArgs,
} from '../../../scripts/smoke-opencode.mjs'

describe('opencode clipulse example wrapper', () => {
  it('passes through process.stdout for the default stdout handoff path', async () => {
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
            id: 'session-stdout',
          },
        },
      },
    })

    expect(runPlugin).toHaveBeenCalledTimes(1)
    expect(runPlugin.mock.calls[0]?.[0].stdout).toBe(process.stdout)
  })

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

  it('forwards outer-root file.edited paths from a broader wrapper root even when a nested bridge git root may later drop them', async () => {
    const runPlugin = vi.fn().mockResolvedValue(undefined)
    const pluginFactory = createClipulsePlugin({ runPlugin })
    const hooks = await pluginFactory({
      directory: '/workspace/demo',
      worktree: '/workspace/demo/packages/nested-repo/src',
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
        cwd: '/workspace/demo/packages/nested-repo/src',
        event_name: 'session.created',
      },
      {
        session_id: 'session-1',
        cwd: '/workspace/demo/packages/nested-repo/src',
        event_name: 'file.edited',
        file_edits: [{ path: '/workspace/demo/src/app.ts' }],
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

  it('does not backfill session.diff on tool boundaries while the default gate stays off', async () => {
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
          sessionID: 'session-1',
          file: '/workspace/demo/src/app.ts',
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
              path: '/workspace/demo/src/app.ts',
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
        event_name: 'file.edited',
        file_edits: [{ path: '/workspace/demo/src/app.ts' }],
      },
      {
        session_id: 'session-1',
        cwd: '/workspace/demo',
        event_name: 'tool.execute.after',
      },
    ])
  })

  it('runs the opencode smoke script through the canonical wrapper path without default-off session.diff backfill', async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-opencode-smoke-'))

    try {
      const result = spawnSync('node', ['scripts/smoke-opencode.mjs'], {
        cwd: path.resolve(process.cwd()),
        env: {
          ...process.env,
          CLIPULSE_STATE_DIR: stateDir,
        },
        encoding: 'utf8',
      })

      expect(result.status).toBe(0)

      const outputLines = result.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)

      expect(outputLines).toHaveLength(4)

      const batches = outputLines.map((line) => JSON.parse(line))
      const events = batches.map((batch) => batch.events[0])

      expect(events.map((event) => event.event_name)).toEqual([
        'session_start',
        'pre_tool_use',
        'file_edited',
        'post_tool_use',
      ])
      expect(events.map((event) => event.host)).toEqual([
        'opencode',
        'opencode',
        'opencode',
        'opencode',
      ])
      expect(events.map((event) => event.session_id)).toEqual([
        'opencode-smoke-session',
        'opencode-smoke-session',
        'opencode-smoke-session',
        'opencode-smoke-session',
      ])
      expect(events[2]?.file_deltas).toHaveLength(1)
      expect(events[2]?.file_deltas?.[0]).toMatchObject({
        added: 0,
        removed: 0,
      })
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true })
    }
  })

  it('fails smoke preflight with a clear error when the local dist/plugin.js bridge is missing', async () => {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-opencode-missing-dist-'))

    try {
      expect(() => assertOpenCodeSmokePreflight({
        repoRoot: sandboxRoot,
        bridgeModulePath: path.join(sandboxRoot, 'packages', 'adapter-opencode', 'dist', 'plugin.js'),
        supportsExperimentalStripTypes: true,
        nodeVersion: 'v23.11.0',
      })).toThrowError(/dist\/plugin\.js/)

      expect(() => assertOpenCodeSmokePreflight({
        repoRoot: sandboxRoot,
        bridgeModulePath: path.join(sandboxRoot, 'packages', 'adapter-opencode', 'dist', 'plugin.js'),
        supportsExperimentalStripTypes: true,
        nodeVersion: 'v23.11.0',
      })).toThrowError(/npm run build --workspace @clipulse\/adapter-opencode/)
    } finally {
      await fs.rm(sandboxRoot, { recursive: true, force: true })
    }
  })

  it('fails smoke preflight with a clear error when the current Node runtime lacks strip-types support', async () => {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-opencode-strip-types-'))
    const bridgeModulePath = path.join(sandboxRoot, 'packages', 'adapter-opencode', 'dist', 'plugin.js')

    try {
      await fs.mkdir(path.dirname(bridgeModulePath), { recursive: true })
      await fs.writeFile(bridgeModulePath, 'export {}', 'utf8')

      expect(() => assertOpenCodeSmokePreflight({
        repoRoot: sandboxRoot,
        bridgeModulePath,
        supportsExperimentalStripTypes: false,
        nodeVersion: 'v20.0.0',
      })).toThrowError(/--experimental-strip-types/)

      expect(() => assertOpenCodeSmokePreflight({
        repoRoot: sandboxRoot,
        bridgeModulePath,
        supportsExperimentalStripTypes: false,
        nodeVersion: 'v20.0.0',
      })).toThrowError(/does not promise a broader runtime/)
    } finally {
      await fs.rm(sandboxRoot, { recursive: true, force: true })
    }
  })

  it('parses OpenCode smoke args to the default shared-project topology when no flags are provided', () => {
    expect(parseOpenCodeSmokeArgs([])).toEqual({
      scenario: 'default',
      topology: 'shared-project',
    })
  })

  it('parses OpenCode smoke args for an explicit gated split-project run', () => {
    expect(parseOpenCodeSmokeArgs(['--scenario', 'gated-session-diff', '--topology', 'split-project'])).toEqual({
      scenario: 'gated-session-diff',
      topology: 'split-project',
    })
  })

  it('fails with a localized --scenario error when the scenario value is missing or invalid', () => {
    expect(() => parseOpenCodeSmokeArgs(['--scenario']))
      .toThrowError(/--scenario requires one of: default, gated-session-diff/)

    expect(() => parseOpenCodeSmokeArgs(['--scenario', 'unknown']))
      .toThrowError(/Invalid value for --scenario: "unknown"/)
  })

  it('fails with a localized --topology error when the topology value is missing or invalid', () => {
    expect(() => parseOpenCodeSmokeArgs(['--topology']))
      .toThrowError(/--topology requires one of: shared-project, split-project/)

    expect(() => parseOpenCodeSmokeArgs(['--topology', 'unknown']))
      .toThrowError(/Invalid value for --topology: "unknown"/)
  })

  it('builds an explicit smoke plan for every topology and scenario combination', () => {
    expect([
      createOpenCodeSmokePlan({ scenario: 'default', topology: 'shared-project' }),
      createOpenCodeSmokePlan({ scenario: 'default', topology: 'split-project' }),
      createOpenCodeSmokePlan({ scenario: 'gated-session-diff', topology: 'shared-project' }),
      createOpenCodeSmokePlan({ scenario: 'gated-session-diff', topology: 'split-project' }),
    ]).toEqual([
      {
        diffMode: 'default',
        enableSessionDiff: false,
        expectedFileEditPath: '/workspace/demo/src/smoke.ts',
        expectedSequence: [
          { host: 'opencode', sessionId: 'opencode-smoke-session', eventName: 'session_start' },
          { host: 'opencode', sessionId: 'opencode-smoke-session', eventName: 'pre_tool_use' },
          { host: 'opencode', sessionId: 'opencode-smoke-session', eventName: 'file_edited' },
          { host: 'opencode', sessionId: 'opencode-smoke-session', eventName: 'post_tool_use' },
        ],
        scenario: 'default',
        topology: 'shared-project',
      },
      {
        diffMode: 'default',
        enableSessionDiff: false,
        expectedFileEditPath: '/tmp/demo-worktree/src/smoke.ts',
        expectedSequence: [
          { host: 'opencode', sessionId: 'opencode-smoke-session', eventName: 'session_start' },
          { host: 'opencode', sessionId: 'opencode-smoke-session', eventName: 'pre_tool_use' },
          { host: 'opencode', sessionId: 'opencode-smoke-session', eventName: 'file_edited' },
          { host: 'opencode', sessionId: 'opencode-smoke-session', eventName: 'post_tool_use' },
        ],
        scenario: 'default',
        topology: 'split-project',
      },
      {
        diffMode: 'gated-session-diff',
        enableSessionDiff: true,
        expectedFileEditPath: '/workspace/demo/src/smoke-gated.ts',
        expectedSequence: [
          { host: 'opencode', sessionId: 'opencode-smoke-session', eventName: 'session_start' },
          { host: 'opencode', sessionId: 'opencode-smoke-session', eventName: 'pre_tool_use' },
          { host: 'opencode', sessionId: 'opencode-smoke-session', eventName: 'post_tool_use_failure' },
          { host: 'opencode', sessionId: 'opencode-smoke-session', eventName: 'file_edited' },
          { host: 'opencode', sessionId: 'opencode-smoke-session', eventName: 'session_end' },
        ],
        scenario: 'gated-session-diff',
        topology: 'shared-project',
      },
      {
        diffMode: 'gated-session-diff',
        enableSessionDiff: true,
        expectedFileEditPath: '/tmp/demo-worktree/src/smoke-gated.ts',
        expectedSequence: [
          { host: 'opencode', sessionId: 'opencode-smoke-session', eventName: 'session_start' },
          { host: 'opencode', sessionId: 'opencode-smoke-session', eventName: 'pre_tool_use' },
          { host: 'opencode', sessionId: 'opencode-smoke-session', eventName: 'post_tool_use_failure' },
          { host: 'opencode', sessionId: 'opencode-smoke-session', eventName: 'file_edited' },
          { host: 'opencode', sessionId: 'opencode-smoke-session', eventName: 'session_end' },
        ],
        scenario: 'gated-session-diff',
        topology: 'split-project',
      },
    ])
  })

  it('validates the focused smoke file path through the emitted file-delta fingerprint', () => {
    const smokePlan = createOpenCodeSmokePlan({
      scenario: 'gated-session-diff',
      topology: 'split-project',
    })
    const expectedProjectRoot = '/tmp/demo-worktree'
    const correctFingerprint = createFileFingerprint(
      smokePlan.expectedFileEditPath,
      expectedProjectRoot,
    )
    const wrongFingerprint = createFileFingerprint(
      '/tmp/demo-worktree/src/not-the-focused-path.ts',
      expectedProjectRoot,
    )

    expect(() => assertOpenCodeSmokePayloads([
      {
        events: [
          {
            event_name: 'file_edited',
            file_deltas: [
              {
                fingerprint: correctFingerprint,
                language: 'TypeScript',
                added: 5,
                removed: 1,
              },
            ],
          },
        ],
      },
    ], smokePlan)).not.toThrow()

    expect(() => assertOpenCodeSmokePayloads([
      {
        events: [
          {
            event_name: 'file_edited',
            file_deltas: [
              {
                fingerprint: wrongFingerprint,
                language: 'TypeScript',
                added: 5,
                removed: 1,
              },
            ],
          },
        ],
      },
    ], smokePlan)).toThrowError(/\/tmp\/demo-worktree\/src\/smoke-gated\.ts/)
  })

  it('runs the gated split-project smoke diagnostic from outside the repo root', async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-opencode-smoke-gated-'))
    const externalCwd = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-opencode-outside-cwd-'))

    try {
      const repoRoot = path.resolve(process.cwd())
      const smokeScriptPath = path.join(repoRoot, 'scripts', 'smoke-opencode.mjs')
      const result = spawnSync('node', [
        smokeScriptPath,
        '--scenario',
        'gated-session-diff',
        '--topology',
        'split-project',
      ], {
        cwd: externalCwd,
        env: {
          ...process.env,
          CLIPULSE_STATE_DIR: stateDir,
        },
        encoding: 'utf8',
      })

      expect(result.status).toBe(0)

      const outputLines = result.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)

      expect(outputLines).toHaveLength(5)

      const batches = outputLines.map((line) => JSON.parse(line))
      const events = batches.map((batch) => batch.events[0])

      expect(events.map((event) => event.event_name)).toEqual([
        'session_start',
        'pre_tool_use',
        'post_tool_use_failure',
        'file_edited',
        'session_end',
      ])
      expect(events[3]?.file_deltas).toEqual([
        expect.objectContaining({
          fingerprint: createFileFingerprint(
            '/tmp/demo-worktree/src/smoke-gated.ts',
            '/tmp/demo-worktree',
          ),
          language: 'TypeScript',
          added: 5,
          removed: 1,
        }),
      ])
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true })
      await fs.rm(externalCwd, { recursive: true, force: true })
    }
  })

  it('keeps runClipulseSmokeScenario() on the default session.created -> tool.execute.before -> file.edited -> tool.execute.after sequence while session.diff stays default-off', async () => {
    const runPlugin = vi.fn().mockResolvedValue(undefined)

    await runClipulseSmokeScenario(undefined, { runPlugin })

    expect(runPlugin).toHaveBeenCalledTimes(4)

    const forwardedPayloads = await Promise.all(
      runPlugin.mock.calls.map(async ([dependencies]) => JSON.parse(await dependencies.readStdin())),
    )

    expect(forwardedPayloads).toEqual([
      {
        session_id: 'opencode-smoke-session',
        cwd: '/workspace/demo',
        event_name: 'session.created',
      },
      {
        session_id: 'opencode-smoke-session',
        cwd: '/workspace/demo',
        event_name: 'tool.execute.before',
      },
      {
        session_id: 'opencode-smoke-session',
        cwd: '/workspace/demo',
        event_name: 'file.edited',
        file_edits: [{ path: '/workspace/demo/src/smoke.ts' }],
      },
      {
        session_id: 'opencode-smoke-session',
        cwd: '/workspace/demo',
        event_name: 'tool.execute.after',
      },
    ])
  })

  it('supports a gated session.diff smoke scenario that exercises tool errors and lifecycle teardown', async () => {
    const runPlugin = vi.fn().mockResolvedValue(undefined)
    const previousGate = process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF
    process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF = '1'

    try {
      await runClipulseSmokeScenario({
        directory: '/workspace/demo',
        worktree: '/workspace/demo',
        scenario: 'gated-session-diff',
      }, { runPlugin })

      expect(runPlugin).toHaveBeenCalledTimes(5)

      const forwardedPayloads = await Promise.all(
        runPlugin.mock.calls.map(async ([dependencies]) => JSON.parse(await dependencies.readStdin())),
      )

      expect(forwardedPayloads).toEqual([
        {
          session_id: 'opencode-smoke-session',
          cwd: '/workspace/demo',
          event_name: 'session.created',
        },
        {
          session_id: 'opencode-smoke-session',
          cwd: '/workspace/demo',
          event_name: 'tool.execute.before',
        },
        {
          session_id: 'opencode-smoke-session',
          cwd: '/workspace/demo',
          event_name: 'tool.execute.error',
        },
        {
          session_id: 'opencode-smoke-session',
          cwd: '/workspace/demo',
          event_name: 'file.edited',
          file_edits: [{ path: '/workspace/demo/src/smoke-gated.ts', additions: 5, deletions: 1 }],
        },
        {
          session_id: 'opencode-smoke-session',
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

  it('supports a split-project smoke topology without changing the default session.diff mode', async () => {
    const runPlugin = vi.fn().mockResolvedValue(undefined)

    await runClipulseSmokeScenario({
      directory: '/workspace/demo',
      topology: 'split-project',
      worktree: '/tmp/demo-worktree',
    }, { runPlugin })

    const forwardedPayloads = await Promise.all(
      runPlugin.mock.calls.map(async ([dependencies]) => JSON.parse(await dependencies.readStdin())),
    )

    expect(forwardedPayloads).toEqual([
      {
        session_id: 'opencode-smoke-session',
        cwd: '/tmp/demo-worktree',
        event_name: 'session.created',
      },
      {
        session_id: 'opencode-smoke-session',
        cwd: '/tmp/demo-worktree',
        event_name: 'tool.execute.before',
      },
      {
        session_id: 'opencode-smoke-session',
        cwd: '/tmp/demo-worktree',
        event_name: 'file.edited',
        file_edits: [{ path: '/tmp/demo-worktree/src/smoke.ts' }],
      },
      {
        session_id: 'opencode-smoke-session',
        cwd: '/tmp/demo-worktree',
        event_name: 'tool.execute.after',
      },
    ])
  })

  it('supports a split-project gated session.diff smoke scenario with worktree-owned file paths', async () => {
    const runPlugin = vi.fn().mockResolvedValue(undefined)
    const previousGate = process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF
    process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF = '1'

    try {
      await runClipulseSmokeScenario({
        directory: '/workspace/demo',
        scenario: 'gated-session-diff',
        topology: 'split-project',
        worktree: '/tmp/demo-worktree',
      }, { runPlugin })

      const forwardedPayloads = await Promise.all(
        runPlugin.mock.calls.map(async ([dependencies]) => JSON.parse(await dependencies.readStdin())),
      )

      expect(forwardedPayloads).toEqual([
        {
          session_id: 'opencode-smoke-session',
          cwd: '/tmp/demo-worktree',
          event_name: 'session.created',
        },
        {
          session_id: 'opencode-smoke-session',
          cwd: '/tmp/demo-worktree',
          event_name: 'tool.execute.before',
        },
        {
          session_id: 'opencode-smoke-session',
          cwd: '/tmp/demo-worktree',
          event_name: 'tool.execute.error',
        },
        {
          session_id: 'opencode-smoke-session',
          cwd: '/tmp/demo-worktree',
          event_name: 'file.edited',
          file_edits: [{ path: '/tmp/demo-worktree/src/smoke-gated.ts', additions: 5, deletions: 1 }],
        },
        {
          session_id: 'opencode-smoke-session',
          cwd: '/tmp/demo-worktree',
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

  it('does not poison seen file.edited paths when explicit forwarding fails before gated session.diff retries', async () => {
    const previousGate = process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF
    process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF = '1'

    try {
      let failNextExplicitFileEdit = true
      const runPlugin = vi.fn(async (dependencies) => {
        const payload = JSON.parse(await dependencies.readStdin())
        if (
          payload.event_name === 'file.edited'
          && payload.file_edits?.[0]?.path === '/workspace/demo/src/retry-from-diff.ts'
          && !('additions' in (payload.file_edits?.[0] ?? {}))
          && failNextExplicitFileEdit
        ) {
          failNextExplicitFileEdit = false
          throw new Error('explicit file.edited failed')
        }
      })
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
                file: '/workspace/demo/src/retry-from-diff.ts',
                additions: 5,
                deletions: 2,
              },
            ],
          },
        },
      })

      await expect(hooks.event({
        event: {
          type: 'file.edited',
          properties: {
            sessionID: 'session-1',
            file: '/workspace/demo/src/retry-from-diff.ts',
          },
        },
      })).rejects.toThrow('explicit file.edited failed')

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
          file_edits: [{ path: '/workspace/demo/src/retry-from-diff.ts' }],
        },
        {
          session_id: 'session-1',
          cwd: '/workspace/demo',
          event_name: 'file.edited',
          file_edits: [
            {
              path: '/workspace/demo/src/retry-from-diff.ts',
              additions: 5,
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

  it('preserves gated session.diff buffers when backfill forwarding fails on tool.execute.after and retries on the next flush', async () => {
    const previousGate = process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF
    process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF = '1'

    try {
      let failNextBackfill = true
      const runPlugin = vi.fn(async (dependencies) => {
        const payload = JSON.parse(await dependencies.readStdin())
        if (
          payload.event_name === 'file.edited'
          && payload.file_edits?.[0]?.path === 'src/retry-after.ts'
          && failNextBackfill
        ) {
          failNextBackfill = false
          throw new Error('backfill failed')
        }
      })
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
                file: 'src/retry-after.ts',
                additions: 5,
                deletions: 2,
              },
            ],
          },
        },
      })

      await expect(hooks['tool.execute.after']({
        sessionID: 'session-1',
      })).rejects.toThrow()

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
              path: 'src/retry-after.ts',
              additions: 5,
              deletions: 2,
            },
          ],
        },
        {
          session_id: 'session-1',
          cwd: '/workspace/demo',
          event_name: 'file.edited',
          file_edits: [
            {
              path: 'src/retry-after.ts',
              additions: 5,
              deletions: 2,
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

  it('preserves gated session.diff buffers when tool.execute.error flush fails and session.deleted retries it', async () => {
    const previousGate = process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF
    process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF = '1'

    try {
      let failNextBackfill = true
      const runPlugin = vi.fn(async (dependencies) => {
        const payload = JSON.parse(await dependencies.readStdin())
        if (
          payload.event_name === 'file.edited'
          && payload.file_edits?.[0]?.path === 'src/retry-error-boundary.ts'
          && failNextBackfill
        ) {
          failNextBackfill = false
          throw new Error('backfill failed')
        }
      })
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
                file: 'src/retry-error-boundary.ts',
                additions: 6,
                deletions: 1,
              },
            ],
          },
        },
      })

      await expect(hooks['tool.execute.error']({
        sessionID: 'session-1',
      })).rejects.toThrow('backfill failed')

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
              path: 'src/retry-error-boundary.ts',
              additions: 6,
              deletions: 1,
            },
          ],
        },
        {
          session_id: 'session-1',
          cwd: '/workspace/demo',
          event_name: 'file.edited',
          file_edits: [
            {
              path: 'src/retry-error-boundary.ts',
              additions: 6,
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

  it('preserves gated session.diff buffers when lifecycle flush fails and succeeds on retry', async () => {
    const previousGate = process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF
    process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF = '1'

    try {
      const runPlugin = vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('backfill failed'))
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
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
                file: 'src/retry-idle.ts',
                additions: 4,
                deletions: 1,
              },
            ],
          },
        },
      })

      await expect(hooks.event({
        event: {
          type: 'session.idle',
          properties: {
            info: {
              id: 'session-1',
            },
          },
        },
      })).rejects.toThrow('backfill failed')

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
              path: 'src/retry-idle.ts',
              additions: 4,
              deletions: 1,
            },
          ],
        },
        {
          session_id: 'session-1',
          cwd: '/workspace/demo',
          event_name: 'file.edited',
          file_edits: [
            {
              path: 'src/retry-idle.ts',
              additions: 4,
              deletions: 1,
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

  it('does not forward a duplicate terminal lifecycle event when session.deleted follows session.idle', async () => {
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
                path: '/workspace/demo/src/from-idle-then-delete.ts',
                additions: 2,
                deletions: 1,
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
          session_id: 'session-1',
          cwd: '/workspace/demo',
          event_name: 'file.edited',
          file_edits: [
            {
              path: '/workspace/demo/src/from-idle-then-delete.ts',
              additions: 2,
              deletions: 1,
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

  it('keeps gated session.diff paths that live under an external worktree root even when cwd is nested', async () => {
    const runPlugin = vi.fn().mockResolvedValue(undefined)
    const previousGate = process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF
    process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF = '1'

    try {
      const pluginFactory = createClipulsePlugin({ runPlugin })
      const hooks = await pluginFactory({
        directory: '/tmp/demo-worktree',
        worktree: '/tmp/demo-worktree/packages/adapter-opencode',
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
                file: '../../shared.ts',
                additions: 2,
                deletions: 1,
              },
              {
                file: '/tmp/demo-worktree/src/app.ts',
                additions: 5,
                deletions: 2,
              },
              {
                file: '/tmp/other-worktree/secret.ts',
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
          cwd: '/tmp/demo-worktree/packages/adapter-opencode',
          event_name: 'session.created',
        },
        {
          session_id: 'session-1',
          cwd: '/tmp/demo-worktree/packages/adapter-opencode',
          event_name: 'tool.execute.after',
        },
        {
          session_id: 'session-1',
          cwd: '/tmp/demo-worktree/packages/adapter-opencode',
          event_name: 'file.edited',
          file_edits: [
            {
              path: '../../shared.ts',
              additions: 2,
              deletions: 1,
            },
            {
              path: '/tmp/demo-worktree/src/app.ts',
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

  it('uses an external worktree root for gated session.diff paths when directory and worktree are disjoint', async () => {
    const runPlugin = vi.fn().mockResolvedValue(undefined)
    const previousGate = process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF
    process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF = '1'

    try {
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
          type: 'session.diff',
          properties: {
            sessionID: 'session-1',
            diff: [
              {
                file: '/tmp/demo-worktree/src/app.ts',
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
          cwd: '/tmp/demo-worktree',
          event_name: 'session.created',
        },
        {
          session_id: 'session-1',
          cwd: '/tmp/demo-worktree',
          event_name: 'tool.execute.after',
        },
        {
          session_id: 'session-1',
          cwd: '/tmp/demo-worktree',
          event_name: 'file.edited',
          file_edits: [
            {
              path: '/tmp/demo-worktree/src/app.ts',
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

  it('retries buffered session.diff on the next lifecycle boundary when tool.execute.after forwarding fails first', async () => {
    const previousGate = process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF
    process.env.CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF = '1'

    try {
      let failNextToolBoundary = true
      const runPlugin = vi.fn(async (dependencies) => {
        const payload = JSON.parse(await dependencies.readStdin())
        if (payload.event_name === 'tool.execute.after' && failNextToolBoundary) {
          failNextToolBoundary = false
          throw new Error('tool boundary failed')
        }
      })
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
                file: 'src/retry-after-boundary.ts',
                additions: 3,
                deletions: 1,
              },
            ],
          },
        },
      })

      await expect(hooks['tool.execute.after']({
        sessionID: 'session-1',
      })).rejects.toThrow('tool boundary failed')

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
              path: 'src/retry-after-boundary.ts',
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
})
