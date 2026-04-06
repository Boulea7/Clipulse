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
        CLIPULSE_STATE_DIR: '/tmp/clipulse-state',
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
      expect.objectContaining({
        stateDir: '/tmp/clipulse-state',
      }),
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

  it('does not narrow snapshot candidates for non-Bash tools', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-non-bash-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-non-bash-state-'))
    tempDirs.push(projectRoot, stateDir)

    const appFile = path.join(projectRoot, 'src', 'app.ts')
    const readmeFile = path.join(projectRoot, 'README.md')
    await fs.mkdir(path.dirname(appFile), { recursive: true })
    await fs.writeFile(appFile, 'export const value = 1;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n', 'utf-8')

    await buildCodexHookEvent({
      session_id: 'codex-non-bash-session',
      cwd: projectRoot,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-05T12:00:00.000Z',
    }, {
      stateDir,
    })

    await fs.writeFile(appFile, 'export const value = 1;\nexport const next = 2;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n\nExtra line\n', 'utf-8')

    const event = await buildCodexHookEvent({
      session_id: 'codex-non-bash-session',
      cwd: projectRoot,
      hook_event_name: 'PostToolUse',
      model: 'gpt-5.4',
      event_time: '2026-04-05T12:00:05.000Z',
      tool_name: 'ReadFile',
      tool_input: {
        command: 'git add src/app.ts',
      },
    }, {
      stateDir,
    })

    expect(event.file_deltas).toHaveLength(2)
  })

  it('captures basename-only candidate files from bash commands', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-basenames-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-basenames-state-'))
    tempDirs.push(projectRoot, stateDir)

    const dockerfile = path.join(projectRoot, 'Dockerfile')
    const makefile = path.join(projectRoot, 'Makefile')
    const readme = path.join(projectRoot, 'README')

    await fs.writeFile(dockerfile, 'FROM node:20\n', 'utf-8')
    await fs.writeFile(makefile, 'build:\n\t@echo build\n', 'utf-8')
    await fs.writeFile(readme, '# Demo\n', 'utf-8')

    await buildCodexHookEvent({
      session_id: 'codex-basenames-session',
      cwd: projectRoot,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-05T12:00:00.000Z',
    }, {
      stateDir,
    })

    await fs.writeFile(dockerfile, 'FROM node:20\nRUN npm ci\n', 'utf-8')
    await fs.writeFile(makefile, 'build:\n\t@echo build\nlint:\n\t@echo lint\n', 'utf-8')
    await fs.writeFile(readme, '# Demo\nUpdated\n', 'utf-8')
    await fs.writeFile(path.join(projectRoot, 'notes.txt'), 'ignore me\nchanged\n', 'utf-8')

    const narrowed = await buildCodexHookEvent({
      session_id: 'codex-basenames-session',
      cwd: projectRoot,
      hook_event_name: 'PostToolUse',
      model: 'gpt-5.4',
      event_time: '2026-04-05T12:00:05.000Z',
      tool_name: 'Bash',
      tool_input: {
        command: 'git add Dockerfile Makefile README',
      },
    }, {
      stateDir,
    })

    expect(narrowed.file_deltas).toHaveLength(3)
    expect(narrowed.file_deltas).toEqual(expect.arrayContaining([
      [expect.objectContaining({ language: 'Docker', added: 1, removed: 0 })],
      [expect.objectContaining({ language: 'Makefile', added: 2, removed: 0 })],
      [expect.objectContaining({ language: 'Markdown', added: 1, removed: 0 })],
    ].flat()))
  })

  it('ignores -- markers and trailing shell noise when narrowing bash candidates', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-noisy-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-noisy-state-'))
    tempDirs.push(projectRoot, stateDir)

    const appFile = path.join(projectRoot, 'src', 'app.ts')
    await fs.mkdir(path.dirname(appFile), { recursive: true })
    await fs.writeFile(appFile, 'export const value = 1;\n', 'utf-8')

    await buildCodexHookEvent({
      session_id: 'codex-noisy-session',
      cwd: projectRoot,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-06T12:35:00.000Z',
    }, {
      stateDir,
    })

    await fs.writeFile(appFile, 'export const value = 1;\nexport const next = 2;\n', 'utf-8')

    const narrowed = await buildCodexHookEvent({
      session_id: 'codex-noisy-session',
      cwd: projectRoot,
      hook_event_name: 'PostToolUse',
      model: 'gpt-5.4',
      event_time: '2026-04-06T12:35:05.000Z',
      tool_name: 'Bash',
      tool_input: {
        command: 'git add -- src/app.ts; echo done',
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

  it('falls back to a full snapshot when the bash command is too complex to narrow safely', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-complex-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-complex-state-'))
    tempDirs.push(projectRoot, stateDir)

    const appFile = path.join(projectRoot, 'src', 'app.ts')
    const readmeFile = path.join(projectRoot, 'README.md')
    await fs.mkdir(path.dirname(appFile), { recursive: true })
    await fs.writeFile(appFile, 'export const value = 1;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n', 'utf-8')

    await buildCodexHookEvent({
      session_id: 'codex-complex-session',
      cwd: projectRoot,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-06T12:50:00.000Z',
    }, {
      stateDir,
    })

    await fs.writeFile(appFile, 'export const value = 1;\nexport const next = 2;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n\nExtra line\n', 'utf-8')

    const event = await buildCodexHookEvent({
      session_id: 'codex-complex-session',
      cwd: projectRoot,
      hook_event_name: 'PostToolUse',
      model: 'gpt-5.4',
      event_time: '2026-04-06T12:50:05.000Z',
      tool_name: 'Bash',
      tool_input: {
        command: 'git add src/app.ts && npm test',
      },
    }, {
      stateDir,
    })

    expect(event.file_deltas).toHaveLength(2)
    expect(event.file_deltas).toEqual(expect.arrayContaining([
      expect.objectContaining({ language: 'TypeScript', added: 1, removed: 0 }),
      expect.objectContaining({ language: 'Markdown', added: 2, removed: 0 }),
    ]))
  })

  it('records file moves as remove plus add deltas', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-move-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-move-state-'))
    tempDirs.push(projectRoot, stateDir)

    const sourceFile = path.join(projectRoot, 'src', 'app.ts')
    const movedFile = path.join(projectRoot, 'src', 'app-renamed.ts')
    await fs.mkdir(path.dirname(sourceFile), { recursive: true })
    await fs.writeFile(sourceFile, 'export const moved = true;\n', 'utf-8')

    await buildCodexHookEvent({
      session_id: 'codex-move-session',
      cwd: projectRoot,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-06T12:55:00.000Z',
    }, {
      stateDir,
    })

    await fs.rename(sourceFile, movedFile)

    const event = await buildCodexHookEvent({
      session_id: 'codex-move-session',
      cwd: projectRoot,
      hook_event_name: 'PostToolUse',
      model: 'gpt-5.4',
      event_time: '2026-04-06T12:55:05.000Z',
      tool_name: 'Bash',
      tool_input: {
        command: 'mv src/app.ts src/app-renamed.ts',
      },
    }, {
      stateDir,
    })

    expect(event.file_deltas).toHaveLength(2)
    expect(event.file_deltas).toEqual(expect.arrayContaining([
      expect.objectContaining({ language: 'TypeScript', added: 0, removed: 1 }),
      expect.objectContaining({ language: 'TypeScript', added: 1, removed: 0 }),
    ]))
  })

  it('records directory moves as remove plus add deltas', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-dir-move-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-dir-move-state-'))
    tempDirs.push(projectRoot, stateDir)

    const sourceFile = path.join(projectRoot, 'src', 'app.ts')
    await fs.mkdir(path.dirname(sourceFile), { recursive: true })
    await fs.writeFile(sourceFile, 'export const moved = true;\n', 'utf-8')

    await buildCodexHookEvent({
      session_id: 'codex-dir-move-session',
      cwd: projectRoot,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-06T13:00:00.000Z',
    }, {
      stateDir,
    })

    await fs.rename(path.join(projectRoot, 'src'), path.join(projectRoot, 'lib'))

    const event = await buildCodexHookEvent({
      session_id: 'codex-dir-move-session',
      cwd: projectRoot,
      hook_event_name: 'PostToolUse',
      model: 'gpt-5.4',
      event_time: '2026-04-06T13:00:05.000Z',
      tool_name: 'Bash',
      tool_input: {
        command: 'git mv src lib',
      },
    }, {
      stateDir,
    })

    expect(event.file_deltas).toHaveLength(2)
    expect(event.file_deltas).toEqual(expect.arrayContaining([
      expect.objectContaining({ language: 'TypeScript', added: 0, removed: 1 }),
      expect.objectContaining({ language: 'TypeScript', added: 1, removed: 0 }),
    ]))
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

    expect(event.project_root).toBe(worktreeRoot)
    expect(event.project_name).toBe('Clipulse')
    expect(event.git_branch).toBe('feat/v1-alpha')
  })

  it('uses the nearest git-backed root when Codex runs from a nested cwd', async () => {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-context-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-context-state-'))
    tempDirs.push(sandboxRoot, stateDir)

    const repoRoot = path.join(sandboxRoot, 'demo')
    const nestedCwd = path.join(repoRoot, 'src', 'features')

    await fs.mkdir(path.join(repoRoot, '.git'), { recursive: true })
    await fs.mkdir(nestedCwd, { recursive: true })
    await fs.writeFile(path.join(repoRoot, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf-8')

    const event = await buildCodexHookEvent({
      session_id: 'codex-nested-context-session',
      cwd: nestedCwd,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-06T12:45:00.000Z',
    }, {
      stateDir,
    })

    expect(event.project_root).toBe(repoRoot)
    expect(event.project_name).toBe('demo')
    expect(event.git_branch).toBe('main')
  })
})
