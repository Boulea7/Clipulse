import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildCodexHookEvent, normalizeCodexHookEvent } from '../src/index.js'
import { runCodexCli } from '../src/cli.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true })
    }),
  )
})

describe('adapter-codex', () => {
  it('normalizes a Codex hook payload into a Clipulse event', () => {
    const normalized = normalizeCodexHookEvent({
      session_id: 'codex-session',
      cwd: '/workspace/demo',
      hook_event_name: 'PostToolUse',
      model: 'gpt-5.4',
      tool_name: 'Bash',
      tool_input: {
        command: 'npm test',
      },
      turn_id: 'turn-1',
    })

    expect(normalized.host).toBe('codex')
    expect(normalized.project_name).toBe('demo')
    expect(normalized.event_name).toBe('post_tool_use')
    expect(normalized.model_name).toBe('gpt-5.4')
    expect(normalized.active_ms).toBe(0)
    expect(normalized.wait_ms).toBe(0)
    expect(normalized.file_deltas).toEqual([])
  })

  it('delivers a normalized batch when Clipulse API URL is configured', async () => {
    const deliverBatch = vi.fn().mockResolvedValue({
      delivered: true,
      buffered: false,
      flushed: 0,
    })

    await runCodexCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
      },
      readStdin: async () => JSON.stringify({
        session_id: 'codex-session',
        cwd: '/workspace/demo',
        hook_event_name: 'PostToolUse',
        model: 'gpt-5.4',
      }),
      deliverBatch,
      stdout: {
        write: vi.fn(),
      },
    })

    expect(deliverBatch).toHaveBeenCalledWith(
      'http://localhost:8000',
      expect.objectContaining({
        events: [
          expect.objectContaining({
            host: 'codex',
            session_id: 'codex-session',
          }),
        ],
      }),
      expect.any(Object),
    )
  })

  it('narrows file deltas to bash command candidates and clears snapshots on stop', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-project-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-state-'))
    tempDirs.push(projectRoot, stateDir)

    const appFile = path.join(projectRoot, 'src', 'app.ts')
    const readmeFile = path.join(projectRoot, 'README.md')
    await fs.mkdir(path.dirname(appFile), { recursive: true })
    await fs.writeFile(appFile, 'export const value = 1;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n', 'utf-8')

    await buildCodexHookEvent({
      session_id: 'codex-session',
      cwd: projectRoot,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-05T12:00:00.000Z',
    }, {
      stateDir,
    })

    await fs.writeFile(appFile, 'export const value = 1;\nexport const next = 2;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n\nExtra line\n', 'utf-8')

    const narrowed = await buildCodexHookEvent({
      session_id: 'codex-session',
      cwd: projectRoot,
      hook_event_name: 'PostToolUse',
      model: 'gpt-5.4',
      event_time: '2026-04-05T12:00:05.000Z',
      tool_name: 'Bash',
      tool_input: {
        command: 'git add src/app.ts',
      },
    }, {
      stateDir,
    })

    expect(narrowed.file_deltas).toEqual([
      expect.objectContaining({
        language: 'TypeScript',
        added: 1,
        removed: 0,
      }),
    ])

    await buildCodexHookEvent({
      session_id: 'codex-session',
      cwd: projectRoot,
      hook_event_name: 'Stop',
      model: 'gpt-5.4',
      event_time: '2026-04-05T12:00:08.000Z',
      tool_name: 'Bash',
      tool_input: {
        command: 'git add src/app.ts',
      },
    }, {
      stateDir,
    })

    await expect(fs.readdir(path.join(stateDir, 'snapshots'))).resolves.toEqual([])
  })

  it('expands directory candidates into tracked files inside that directory', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-dir-project-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-dir-state-'))
    tempDirs.push(projectRoot, stateDir)

    const appFile = path.join(projectRoot, 'src', 'app.ts')
    await fs.mkdir(path.dirname(appFile), { recursive: true })
    await fs.writeFile(appFile, 'export const value = 1;\n', 'utf-8')

    await buildCodexHookEvent({
      session_id: 'codex-dir-session',
      cwd: projectRoot,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-05T12:00:00.000Z',
    }, {
      stateDir,
    })

    await fs.writeFile(appFile, 'export const value = 1;\nexport const next = 2;\n', 'utf-8')

    const narrowed = await buildCodexHookEvent({
      session_id: 'codex-dir-session',
      cwd: projectRoot,
      hook_event_name: 'PostToolUse',
      model: 'gpt-5.4',
      event_time: '2026-04-05T12:00:05.000Z',
      tool_name: 'Bash',
      tool_input: {
        command: 'git add ./src',
      },
    }, {
      stateDir,
    })

    expect(narrowed.file_deltas).toEqual([
      expect.objectContaining({
        language: 'TypeScript',
        added: 1,
        removed: 0,
      }),
    ])
  })

  it('uses shared project context helpers for worktree-style project names and branches', async () => {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-context-'))
    tempDirs.push(sandboxRoot)

    const repoRoot = path.join(sandboxRoot, 'Clipulse')
    const worktreeRoot = path.join(repoRoot, '.worktrees', 'v1-alpha')
    const worktreeGitDir = path.join(repoRoot, '.git', 'worktrees', 'v1-alpha')

    await fs.mkdir(worktreeRoot, { recursive: true })
    await fs.mkdir(worktreeGitDir, { recursive: true })
    await fs.writeFile(path.join(worktreeRoot, '.git'), `gitdir: ${worktreeGitDir}\n`, 'utf-8')
    await fs.writeFile(path.join(worktreeGitDir, 'HEAD'), 'ref: refs/heads/feat/v1-alpha\n', 'utf-8')
    await fs.writeFile(path.join(worktreeGitDir, 'commondir'), '../..\n', 'utf-8')

    const event = await buildCodexHookEvent({
      session_id: 'codex-context-session',
      cwd: worktreeRoot,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-06T12:40:00.000Z',
    }, {
      stateDir: sandboxRoot,
    })

    expect(event.project_name).toBe('Clipulse')
    expect(event.git_branch).toBe('feat/v1-alpha')
  })
})
