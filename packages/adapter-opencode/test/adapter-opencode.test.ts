import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildOpenCodeEvent, isPathInsideProjectRoot, prepareOpenCodeEvent } from '../src/index.js'
import { runOpenCodePlugin, runOpenCodePluginCli } from '../src/plugin.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true })
    }),
  )
})

async function readOnlySessionState(stateDir: string): Promise<string> {
  const sessionDir = path.join(stateDir, 'sessions')
  const sessionFiles = await fs.readdir(sessionDir)

  expect(sessionFiles).toHaveLength(1)

  return fs.readFile(path.join(sessionDir, sessionFiles[0]!), 'utf-8')
}

describe('adapter-opencode', () => {
  it('returns a collector-core handoff shape from prepareOpenCodeEvent', async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-opencode-state-'))
    tempDirs.push(stateDir)

    const prepared = await prepareOpenCodeEvent({
      session_id: 'opencode-session',
      cwd: '/workspace/demo',
      event_name: 'session.created',
      event_time: '2026-04-10T02:00:00Z',
      model: 'gpt-5.4',
    }, {
      stateDir,
    })

    expect(prepared.event.event_name).toBe('session_start')
    expect(prepared.commit).toEqual(expect.any(Function))
    await expect(fs.readdir(path.join(stateDir, 'sessions'))).rejects.toMatchObject({
      code: 'ENOENT',
    })

    await prepared.commit()

    await expect(readOnlySessionState(stateDir)).resolves.toContain('"lastEventTime":"2026-04-10T02:00:00Z"')
  })

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
    const canonicalRepoRoot = await fs.realpath(repoRoot)

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

    expect(event.project_root).toBe(canonicalRepoRoot)
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
    const canonicalRepoRoot = await fs.realpath(repoRoot)

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

    expect(event.project_root).toBe(canonicalRepoRoot)
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

  it('keeps the bridge scoped to the nearest nested git root when cwd is inside a repo-in-repo subtree', async () => {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-opencode-nested-root-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-opencode-state-'))
    tempDirs.push(sandboxRoot, stateDir)

    const outerRepoRoot = path.join(sandboxRoot, 'outer')
    const nestedRepoRoot = path.join(outerRepoRoot, 'packages', 'nested-repo')
    const nestedCwd = path.join(nestedRepoRoot, 'src')

    await fs.mkdir(path.join(outerRepoRoot, '.git'), { recursive: true })
    await fs.writeFile(path.join(outerRepoRoot, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf-8')
    await fs.mkdir(path.join(nestedRepoRoot, '.git'), { recursive: true })
    await fs.writeFile(path.join(nestedRepoRoot, '.git', 'HEAD'), 'ref: refs/heads/feat/nested\n', 'utf-8')
    await fs.mkdir(nestedCwd, { recursive: true })
    const canonicalNestedRepoRoot = await fs.realpath(nestedRepoRoot)

    const event = await buildOpenCodeEvent({
      session_id: 'opencode-session',
      cwd: nestedCwd,
      event_name: 'file.edited',
      event_time: '2026-04-10T02:04:00Z',
      model: 'gpt-5.4',
      file_edits: [
        {
          path: path.join(outerRepoRoot, 'root-only.ts'),
          added: 7,
          removed: 1,
        },
      ],
    }, {
      stateDir,
    })

    expect(event.project_root).toBe(canonicalNestedRepoRoot)
    expect(event.project_name).toBe('nested-repo')
    expect(event.git_branch).toBe('feat/nested')
    expect(event.file_deltas).toEqual([])
    expect(event.language_stats).toEqual({})
  })

  it('keeps the nearest nested git root even when the outer project root is a worktree git pointer', async () => {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-opencode-worktree-nested-root-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-opencode-state-'))
    tempDirs.push(sandboxRoot, stateDir)

    const mainRepoRoot = path.join(sandboxRoot, 'main-repo')
    const commonGitDir = path.join(mainRepoRoot, '.git')
    const worktreeRoot = path.join(mainRepoRoot, '.worktrees', 'feature-alpha')
    const worktreeGitDir = path.join(commonGitDir, 'worktrees', 'feature-alpha')
    const nestedRepoRoot = path.join(worktreeRoot, 'packages', 'nested-repo')
    const nestedCwd = path.join(nestedRepoRoot, 'src')

    await fs.mkdir(commonGitDir, { recursive: true })
    await fs.mkdir(worktreeGitDir, { recursive: true })
    await fs.writeFile(path.join(worktreeGitDir, 'HEAD'), 'ref: refs/heads/feat/worktree\n', 'utf-8')
    await fs.writeFile(path.join(worktreeGitDir, 'commondir'), '../..\n', 'utf-8')
    await fs.mkdir(worktreeRoot, { recursive: true })
    await fs.writeFile(path.join(worktreeRoot, '.git'), 'gitdir: ../../.git/worktrees/feature-alpha\n', 'utf-8')
    await fs.mkdir(path.join(nestedRepoRoot, '.git'), { recursive: true })
    await fs.writeFile(path.join(nestedRepoRoot, '.git', 'HEAD'), 'ref: refs/heads/feat/nested\n', 'utf-8')
    await fs.mkdir(nestedCwd, { recursive: true })
    const canonicalNestedRepoRoot = await fs.realpath(nestedRepoRoot)

    const event = await buildOpenCodeEvent({
      session_id: 'opencode-session',
      cwd: nestedCwd,
      event_name: 'file.edited',
      event_time: '2026-04-10T02:04:30Z',
      model: 'gpt-5.4',
      file_edits: [
        {
          path: path.join(worktreeRoot, 'root-only.ts'),
          additions: 7,
          deletions: 1,
        },
        {
          path: path.join(nestedRepoRoot, 'src', 'kept.ts'),
          additions: 3,
          deletions: 2,
        },
      ],
    }, {
      stateDir,
    })

    expect(event.project_root).toBe(canonicalNestedRepoRoot)
    expect(event.project_name).toBe('nested-repo')
    expect(event.git_branch).toBe('feat/nested')
    expect(event.file_deltas).toEqual([
      expect.objectContaining({
        language: 'TypeScript',
        added: 3,
        removed: 2,
      }),
    ])
    expect(event.language_stats).toEqual({
      TypeScript: {
        added: 3,
        removed: 2,
        changed: 5,
      },
    })
  })

  it('drops wrapper-forwarded outer-root edits when the bridge resolves a nested git root', async () => {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-opencode-wrapper-bridge-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-opencode-state-'))
    tempDirs.push(sandboxRoot, stateDir)

    const outerRepoRoot = path.join(sandboxRoot, 'outer')
    const nestedRepoRoot = path.join(outerRepoRoot, 'packages', 'nested-repo')
    const nestedCwd = path.join(nestedRepoRoot, 'src')
    const stdoutWrite = vi.fn()

    await fs.mkdir(path.join(outerRepoRoot, '.git'), { recursive: true })
    await fs.writeFile(path.join(outerRepoRoot, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf-8')
    await fs.mkdir(path.join(nestedRepoRoot, '.git'), { recursive: true })
    await fs.writeFile(path.join(nestedRepoRoot, '.git', 'HEAD'), 'ref: refs/heads/feat/nested\n', 'utf-8')
    await fs.mkdir(nestedCwd, { recursive: true })

    await runOpenCodePlugin({
      env: {
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'opencode-session',
        cwd: nestedCwd,
        event_name: 'file.edited',
        event_time: '2026-04-10T02:05:00Z',
        model: 'gpt-5.4',
        file_edits: [
          {
            path: path.join(outerRepoRoot, 'src', 'wrapper-forwarded.ts'),
            additions: 5,
            deletions: 2,
          },
        ],
      }),
      stdout: {
        write: stdoutWrite,
      },
    })

    expect(stdoutWrite).toHaveBeenCalledTimes(1)

    const batch = JSON.parse(String(stdoutWrite.mock.calls[0]?.[0]).trim())

    expect(batch).toEqual({
      events: [
        expect.objectContaining({
          host: 'opencode',
          session_id: 'opencode-session',
          event_name: 'file_edited',
          project_root: expect.stringMatching(/^[0-9a-f]{12}$/),
          project_name: 'nested-repo',
          git_branch: 'feat/nested',
          file_deltas: [],
          language_stats: {},
        }),
      ],
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

  it('treats path.relative absolute results as repo-external bridge paths', () => {
    const relativeSpy = vi.spyOn(path, 'relative').mockReturnValue('/other-drive/demo/src/app.ts')

    try {
      expect(isPathInsideProjectRoot('/workspace/demo', '/workspace/demo/src/app.ts')).toBe(false)
    } finally {
      relativeSpy.mockRestore()
    }
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
    const output = String(stdoutWrite.mock.calls[0]?.[0])
    expect(output).toContain('"host":"opencode"')
    expect(output).toContain('"event_name":"session_start"')
    expect(output).toContain('"event_id":"')
    expect(output).not.toContain('/workspace/demo')
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
        CLIPULSE_API_BEARER_TOKEN: 'opencode-token',
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
        apiBearerToken: 'opencode-token',
        stateDir,
      }),
    )
  })

  it('trims surrounding whitespace from session_id before delivery', async () => {
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
        session_id: '  opencode-session  ',
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
            session_id: 'opencode-session',
          }),
        ],
      }),
      expect.any(Object),
    )
  })

  it('skips tracking when CLIPULSE_REQUIRE_PROJECT_FILE=1 and the project has no .clipulse-project', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-opencode-project-file-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-opencode-project-file-state-'))
    tempDirs.push(projectRoot, stateDir)
    const stdoutWrite = vi.fn()
    const deliverBatch = vi.fn()

    await fs.mkdir(path.join(projectRoot, '.git'), { recursive: true })
    await fs.writeFile(path.join(projectRoot, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf-8')

    await runOpenCodePlugin({
      deliverBatch,
      env: {
        CLIPULSE_REQUIRE_PROJECT_FILE: '1',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'opencode-session',
        cwd: projectRoot,
        event_name: 'session.created',
        event_time: '2026-04-21T00:00:00.000Z',
      }),
      stdout: {
        write: stdoutWrite,
      },
    })

    expect(stdoutWrite).not.toHaveBeenCalled()
    expect(deliverBatch).not.toHaveBeenCalled()
  })

  it('tracks projects with a .clipulse-project marker when CLIPULSE_REQUIRE_PROJECT_FILE=1', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-opencode-project-file-positive-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-opencode-project-file-positive-state-'))
    tempDirs.push(projectRoot, stateDir)
    const deliverBatch = vi.fn()

    await fs.mkdir(path.join(projectRoot, '.git'), { recursive: true })
    await fs.writeFile(path.join(projectRoot, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf-8')
    await fs.writeFile(path.join(projectRoot, '.clipulse-project'), 'project_name=Marked OpenCode\n', 'utf-8')

    await runOpenCodePlugin({
      deliverBatch,
      env: {
        CLIPULSE_REQUIRE_PROJECT_FILE: '1',
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'opencode-session',
        cwd: projectRoot,
        event_name: 'session.created',
        event_time: '2026-04-21T00:00:00.000Z',
      }),
      stdout: {
        write: vi.fn(),
      },
    })

    expect(deliverBatch).toHaveBeenCalledWith(
      'http://localhost:8000',
      expect.objectContaining({
        events: [
          expect.objectContaining({
            project_name: 'Marked OpenCode',
          }),
        ],
      }),
      expect.objectContaining({
        stateDir,
      }),
    )
  })

  it('keeps tool wait timing retry-safe when stdout handoff fails', async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-opencode-state-'))
    tempDirs.push(stateDir)

    await runOpenCodePlugin({
      env: {
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'opencode-session',
        cwd: '/workspace/demo',
        event_name: 'tool.execute.before',
        event_time: '2026-04-10T02:20:00Z',
      }),
      stdout: {
        write: vi.fn(),
      },
    })

    const committedBeforeFailure = await readOnlySessionState(stateDir)

    await expect(runOpenCodePlugin({
      env: {
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'opencode-session',
        cwd: '/workspace/demo',
        event_name: 'tool.execute.after',
        event_time: '2026-04-10T02:20:03Z',
      }),
      stdout: {
        write: () => {
          throw new Error('stdout unavailable')
        },
      },
    })).rejects.toThrow('stdout unavailable')

    await expect(readOnlySessionState(stateDir)).resolves.toBe(committedBeforeFailure)

    const retryWrite = vi.fn()

    await runOpenCodePlugin({
      env: {
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'opencode-session',
        cwd: '/workspace/demo',
        event_name: 'tool.execute.after',
        event_time: '2026-04-10T02:20:03Z',
      }),
      stdout: {
        write: retryWrite,
      },
    })

    const retryBatch = JSON.parse(String(retryWrite.mock.calls[0]?.[0]).trim())

    expect(retryBatch.events[0]?.wait_ms).toBe(3_000)
  })

  it('keeps tool wait timing retry-safe when API delivery fails', async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-opencode-state-'))
    tempDirs.push(stateDir)

    await runOpenCodePlugin({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'opencode-session',
        cwd: '/workspace/demo',
        event_name: 'tool.execute.before',
        event_time: '2026-04-10T02:21:00Z',
      }),
      deliverBatch: vi.fn().mockResolvedValue({
        delivered: true,
        buffered: false,
        flushed: 0,
      }),
    })

    const committedBeforeFailure = await readOnlySessionState(stateDir)
    const failingDeliverBatch = vi.fn().mockRejectedValue(new Error('api unavailable'))

    await expect(runOpenCodePlugin({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'opencode-session',
        cwd: '/workspace/demo',
        event_name: 'tool.execute.after',
        event_time: '2026-04-10T02:21:03Z',
      }),
      deliverBatch: failingDeliverBatch,
    })).rejects.toThrow('api unavailable')

    await expect(readOnlySessionState(stateDir)).resolves.toBe(committedBeforeFailure)

    const retryDeliverBatch = vi.fn().mockResolvedValue({
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
        event_name: 'tool.execute.after',
        event_time: '2026-04-10T02:21:03Z',
      }),
      deliverBatch: retryDeliverBatch,
    })

    const retryBatch = retryDeliverBatch.mock.calls[0]?.[1]

    expect(retryBatch?.events[0]?.wait_ms).toBe(3_000)
  })

  it('rejects invalid plugin input before handoff', async () => {
    await expect(runOpenCodePlugin({
      env: {
        CLIPULSE_STATE_DIR: '/tmp/clipulse-opencode-invalid',
      },
      readStdin: async () => JSON.stringify({
        session_id: '',
        cwd: '/workspace/demo',
        event_name: 'session.created',
      }),
      stdout: {
        write: vi.fn(),
      },
    })).rejects.toThrow('session_id')
  })

  it('reports top-level plugin errors with a non-zero exit code', async () => {
    const stdoutWrite = vi.fn()
    const stderrWrite = vi.fn()

    const exitCode = await runOpenCodePluginCli({
      env: {
        CLIPULSE_STATE_DIR: '/tmp/clipulse-opencode-cli',
      },
      readStdin: async () => '{"session_id":42}',
      stdout: {
        write: stdoutWrite,
      },
      stderr: {
        write: stderrWrite,
      },
    })

    expect(exitCode).toBe(1)
    expect(stdoutWrite).not.toHaveBeenCalled()
    expect(stderrWrite).toHaveBeenCalledWith(
      expect.stringContaining('OpenCode adapter expected "session_id" to be a non-empty string.'),
    )
  })
})
