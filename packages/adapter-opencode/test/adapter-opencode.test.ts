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

  it('keeps path-only file.edited payloads as explicit zero-line deltas', async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-opencode-state-'))
    tempDirs.push(stateDir)

    const event = await buildOpenCodeEvent({
      session_id: 'opencode-session',
      cwd: '/workspace/demo',
      event_name: 'file.edited',
      event_time: '2026-04-10T02:00:30Z',
      model: 'gpt-5.4',
      file_edits: [
        {
          path: '/workspace/demo/src/path-only.ts',
        },
      ],
    }, {
      stateDir,
    })

    expect(event.file_deltas).toEqual([
      expect.objectContaining({
        language: 'TypeScript',
        added: 0,
        removed: 0,
      }),
    ])
    expect(event.language_stats).toEqual({
      TypeScript: {
        added: 0,
        removed: 0,
        changed: 0,
      },
    })
  })

  it('normalizes session.diff-style additions and deletions fields into file deltas', async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-opencode-state-'))
    tempDirs.push(stateDir)

    const event = await buildOpenCodeEvent({
      session_id: 'opencode-session',
      cwd: '/workspace/demo',
      event_name: 'file.edited',
      event_time: '2026-04-10T02:00:45Z',
      model: 'gpt-5.4',
      file_edits: [
        {
          path: '/workspace/demo/src/from-session-diff.ts',
          additions: 4,
          deletions: 1,
        },
      ],
    }, {
      stateDir,
    })

    expect(event.file_deltas).toEqual([
      expect.objectContaining({
        language: 'TypeScript',
        added: 4,
        removed: 1,
      }),
    ])
    expect(event.language_stats).toEqual({
      TypeScript: {
        added: 4,
        removed: 1,
        changed: 5,
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
    }, {
      stateDir,
    })

    const event = await buildOpenCodeEvent({
      session_id: 'opencode-session',
      cwd: '/workspace/demo',
      event_name: 'tool.execute.after',
      event_time: '2026-04-10T02:05:03Z',
    }, {
      stateDir,
    })

    expect(event.event_name).toBe('post_tool_use')
    expect(event.wait_ms).toBe(3_000)
  })

  it('scopes nested cwd file.edited payloads to the resolved project root', async () => {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-opencode-worktree-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-opencode-state-'))
    tempDirs.push(sandboxRoot, stateDir)

    const repoRoot = path.join(sandboxRoot, 'Clipulse')
    const nestedCwd = path.join(repoRoot, 'packages', 'adapter-opencode')
    const gitDir = path.join(repoRoot, '.git')

    await fs.mkdir(nestedCwd, { recursive: true })
    await fs.mkdir(gitDir, { recursive: true })
    await fs.writeFile(path.join(gitDir, 'HEAD'), 'ref: refs/heads/feat/v1-alpha\n', 'utf-8')

    const event = await buildOpenCodeEvent({
      session_id: 'opencode-session',
      cwd: nestedCwd,
      event_name: 'file.edited',
      event_time: '2026-04-10T02:02:00Z',
      model: 'gpt-5.4',
      file_edits: [
        {
          path: path.join(repoRoot, 'src', 'app.ts'),
          added: 3,
          removed: 1,
        },
      ],
    }, {
      stateDir,
    })

    expect(event.project_root).toBe(repoRoot)
    expect(event.project_name).toBe('Clipulse')
    expect(event.git_branch).toBe('feat/v1-alpha')
    expect(event.file_deltas).toEqual([
      expect.objectContaining({
        language: 'TypeScript',
        added: 3,
        removed: 1,
      }),
    ])
    expect(event.language_stats).toEqual({
      TypeScript: {
        added: 3,
        removed: 1,
        changed: 4,
      },
    })
  })

  it('resolves relative file.edited paths from the original cwd before scoping to the project root', async () => {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-opencode-worktree-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-opencode-state-'))
    tempDirs.push(sandboxRoot, stateDir)

    const repoRoot = path.join(sandboxRoot, 'Clipulse')
    const nestedCwd = path.join(repoRoot, 'packages', 'adapter-opencode')
    const gitDir = path.join(repoRoot, '.git')

    await fs.mkdir(nestedCwd, { recursive: true })
    await fs.mkdir(gitDir, { recursive: true })
    await fs.writeFile(path.join(gitDir, 'HEAD'), 'ref: refs/heads/feat/v1-alpha\n', 'utf-8')

    const event = await buildOpenCodeEvent({
      session_id: 'opencode-session',
      cwd: nestedCwd,
      event_name: 'file.edited',
      event_time: '2026-04-10T02:03:00Z',
      model: 'gpt-5.4',
      file_edits: [
        {
          path: 'src/local.ts',
          added: 2,
          removed: 1,
        },
      ],
    }, {
      stateDir,
    })

    expect(event.project_root).toBe(repoRoot)
    expect(event.file_deltas).toEqual([
      expect.objectContaining({
        language: 'TypeScript',
        added: 2,
        removed: 1,
      }),
    ])
    expect(event.language_stats).toEqual({
      TypeScript: {
        added: 2,
        removed: 1,
        changed: 3,
      },
    })
  })

  it('drops repo-external file.edited paths before they can survive as file deltas', async () => {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-opencode-worktree-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-opencode-state-'))
    tempDirs.push(sandboxRoot, stateDir)

    const repoRoot = path.join(sandboxRoot, 'Clipulse')
    const gitDir = path.join(repoRoot, '.git')

    await fs.mkdir(gitDir, { recursive: true })
    await fs.writeFile(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n', 'utf-8')

    const event = await buildOpenCodeEvent({
      session_id: 'opencode-session',
      cwd: repoRoot,
      event_name: 'file.edited',
      event_time: '2026-04-10T02:03:30Z',
      model: 'gpt-5.4',
      file_edits: [
        {
          path: '../outside.ts',
          additions: 8,
          deletions: 3,
        },
        {
          path: path.join(sandboxRoot, 'secret.ts'),
          additions: 4,
          deletions: 1,
        },
        {
          path: path.join(repoRoot, 'src', 'safe.ts'),
          additions: 2,
          deletions: 1,
        },
      ],
    }, {
      stateDir,
    })

    expect(event.file_deltas).toEqual([
      expect.objectContaining({
        language: 'TypeScript',
        added: 2,
        removed: 1,
      }),
    ])
    expect(event.language_stats).toEqual({
      TypeScript: {
        added: 2,
        removed: 1,
        changed: 3,
      },
    })
  })

  it('finalizes wait timing on session.error after tool.execute.before', async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-opencode-state-'))
    tempDirs.push(stateDir)

    await buildOpenCodeEvent({
      session_id: 'opencode-session',
      cwd: '/workspace/demo',
      event_name: 'tool.execute.before',
      event_time: '2026-04-10T02:06:00Z',
    }, {
      stateDir,
    })

    const event = await buildOpenCodeEvent({
      session_id: 'opencode-session',
      cwd: '/workspace/demo',
      event_name: 'session.error',
      event_time: '2026-04-10T02:06:05Z',
    }, {
      stateDir,
    })

    expect(event.event_name).toBe('stop_failure')
    expect(event.wait_ms).toBe(5_000)
    await expect(fs.readdir(path.join(stateDir, 'sessions'))).resolves.toEqual([])
  })

  it('does not derive file deltas from session.diff without explicit file.edited payloads', async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-opencode-state-'))
    tempDirs.push(stateDir)

    const event = await buildOpenCodeEvent({
      session_id: 'opencode-session',
      cwd: '/workspace/demo',
      event_name: 'session.diff',
      event_time: '2026-04-10T02:07:00Z',
    }, {
      stateDir,
    })

    expect(event.event_name).toBe('session_diff')
    expect(event.file_deltas).toEqual([])
    expect(event.language_stats).toEqual({})
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
