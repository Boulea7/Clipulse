import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildGeminiHookEvent } from '../src/index.js'
import { runGeminiCli } from '../src/cli.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true })
    }),
  )
})

describe('adapter-gemini', () => {
  it('keeps prompt-only Gemini hook events with shared project context', async () => {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-worktree-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-state-'))
    tempDirs.push(sandboxRoot, stateDir)

    const repoRoot = path.join(sandboxRoot, 'Clipulse')
    const worktreeRoot = path.join(repoRoot, '.worktrees', 'v1-alpha')
    const worktreeGitDir = path.join(repoRoot, '.git', 'worktrees', 'v1-alpha')

    await fs.mkdir(worktreeRoot, { recursive: true })
    await fs.mkdir(worktreeGitDir, { recursive: true })
    await fs.writeFile(path.join(worktreeRoot, '.git'), `gitdir: ${worktreeGitDir}\n`, 'utf-8')
    await fs.writeFile(path.join(worktreeGitDir, 'HEAD'), 'ref: refs/heads/feat/v1-alpha\n', 'utf-8')
    await fs.writeFile(path.join(worktreeGitDir, 'commondir'), '../..\n', 'utf-8')

    const event = await buildGeminiHookEvent({
      session_id: 'gemini-session',
      cwd: worktreeRoot,
      hook_event_name: 'UserPromptSubmit',
      model: 'gemini-2.5-pro',
      event_time: '2026-04-10T01:00:00Z',
    }, {
      stateDir,
    })

    expect(event.host).toBe('gemini-cli')
    expect(event.event_name).toBe('user_prompt_submit')
    expect(event.project_root).toBe(worktreeRoot)
    expect(event.project_name).toBe('Clipulse')
    expect(event.git_branch).toBe('feat/v1-alpha')
    expect(event.file_deltas).toEqual([])
    expect(event.language_stats).toEqual({})
  })

  it('tracks wait timing across before_tool and after_tool hooks', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-project-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-state-'))
    tempDirs.push(projectRoot, stateDir)

    await buildGeminiHookEvent({
      session_id: 'gemini-session',
      cwd: projectRoot,
      hook_event_name: 'BeforeTool',
      model: 'gemini-2.5-pro',
      event_time: '2026-04-10T01:05:00Z',
      tool_name: 'WriteFile',
    }, {
      stateDir,
    })

    const event = await buildGeminiHookEvent({
      session_id: 'gemini-session',
      cwd: projectRoot,
      hook_event_name: 'AfterTool',
      model: 'gemini-2.5-pro',
      event_time: '2026-04-10T01:05:04Z',
      tool_name: 'WriteFile',
    }, {
      stateDir,
    })

    expect(event.event_name).toBe('post_tool_use')
    expect(event.active_ms).toBe(0)
    expect(event.wait_ms).toBe(4_000)
  })

  it('maps before_agent to prompt activity without starting a tool wait', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-project-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-state-'))
    tempDirs.push(projectRoot, stateDir)

    const beforeAgent = await buildGeminiHookEvent({
      session_id: 'gemini-session',
      cwd: projectRoot,
      hook_event_name: 'BeforeAgent',
      model: 'gemini-2.5-pro',
      timestamp: '2026-04-10T01:04:00Z',
      prompt: 'Please inspect the repo.',
    }, {
      stateDir,
    })

    const afterTool = await buildGeminiHookEvent({
      session_id: 'gemini-session',
      cwd: projectRoot,
      hook_event_name: 'AfterTool',
      model: 'gemini-2.5-pro',
      timestamp: '2026-04-10T01:04:04Z',
      tool_name: 'read_file',
      tool_input: {
        file_path: 'README.md',
      },
    }, {
      stateDir,
    })

    expect(beforeAgent.event_name).toBe('user_prompt_submit')
    expect(beforeAgent.wait_ms).toBe(0)
    expect(afterTool.wait_ms).toBe(0)
    expect(afterTool.file_deltas).toEqual([])
  })

  it('finalizes wait timing on after_tool_failure and clears state on session_end', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-project-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-state-'))
    tempDirs.push(projectRoot, stateDir)

    await buildGeminiHookEvent({
      session_id: 'gemini-session',
      cwd: projectRoot,
      hook_event_name: 'BeforeTool',
      model: 'gemini-2.5-pro',
      event_time: '2026-04-10T01:20:00Z',
    }, {
      stateDir,
    })

    const failedEvent = await buildGeminiHookEvent({
      session_id: 'gemini-session',
      cwd: projectRoot,
      hook_event_name: 'AfterToolFailure',
      model: 'gemini-2.5-pro',
      event_time: '2026-04-10T01:20:03Z',
    }, {
      stateDir,
    })

    expect(failedEvent.event_name).toBe('post_tool_use_failure')
    expect(failedEvent.wait_ms).toBe(3_000)

    await buildGeminiHookEvent({
      session_id: 'gemini-session',
      cwd: projectRoot,
      hook_event_name: 'BeforeTool',
      model: 'gemini-2.5-pro',
      event_time: '2026-04-10T01:20:10Z',
    }, {
      stateDir,
    })

    const sessionEnd = await buildGeminiHookEvent({
      session_id: 'gemini-session',
      cwd: projectRoot,
      hook_event_name: 'SessionEnd',
      model: 'gemini-2.5-pro',
      event_time: '2026-04-10T01:20:14Z',
    }, {
      stateDir,
    })

    expect(sessionEnd.event_name).toBe('session_end')
    expect(sessionEnd.wait_ms).toBe(4_000)
    await expect(fs.readdir(path.join(stateDir, 'sessions'))).resolves.toEqual([])
  })

  it('captures a minimal file delta from official write_file tool payloads', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-project-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-state-'))
    tempDirs.push(projectRoot, stateDir)

    const event = await buildGeminiHookEvent({
      session_id: 'gemini-session',
      cwd: projectRoot,
      hook_event_name: 'AfterTool',
      model: 'gemini-2.5-pro',
      timestamp: '2026-04-10T01:30:00Z',
      tool_name: 'write_file',
      tool_input: {
        file_path: 'src/app.ts',
        content: 'export const first = 1;\nexport const second = 2;\n',
      },
    }, {
      stateDir,
    })

    expect(event.file_deltas).toEqual([
      expect.objectContaining({
        language: 'TypeScript',
        added: 2,
        removed: 0,
      }),
    ])
    expect(event.language_stats).toEqual({
      TypeScript: {
        added: 2,
        removed: 0,
        changed: 2,
      },
    })
  })

  it('resolves relative Gemini file paths from the original cwd before scoping to the project root', async () => {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-worktree-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-state-'))
    tempDirs.push(sandboxRoot, stateDir)

    const repoRoot = path.join(sandboxRoot, 'Clipulse')
    const nestedCwd = path.join(repoRoot, 'packages', 'adapter-gemini')
    const gitDir = path.join(repoRoot, '.git')

    await fs.mkdir(nestedCwd, { recursive: true })
    await fs.mkdir(gitDir, { recursive: true })
    await fs.writeFile(path.join(gitDir, 'HEAD'), 'ref: refs/heads/feat/v1-alpha\n', 'utf-8')

    const event = await buildGeminiHookEvent({
      session_id: 'gemini-session',
      cwd: nestedCwd,
      hook_event_name: 'AfterTool',
      model: 'gemini-2.5-pro',
      timestamp: '2026-04-10T01:31:00Z',
      tool_name: 'write_file',
      tool_input: {
        file_path: 'src/local.ts',
        content: 'export const nested = true;\n',
      },
    }, {
      stateDir,
    })

    expect(event.project_root).toBe(repoRoot)
    expect(event.project_name).toBe('Clipulse')
    expect(event.git_branch).toBe('feat/v1-alpha')
    expect(event.file_deltas).toEqual([
      expect.objectContaining({
        language: 'TypeScript',
        added: 1,
        removed: 0,
      }),
    ])
  })

  it('prints a normalized batch to stdout when no API URL is configured', async () => {
    const stdoutWrite = vi.fn()

    await runGeminiCli({
      env: {
        CLIPULSE_STATE_DIR: '/tmp/clipulse-gemini-state',
      },
      readStdin: async () => JSON.stringify({
        session_id: 'gemini-session',
        cwd: '/workspace/demo',
        hook_event_name: 'UserPromptSubmit',
        model: 'gemini-2.5-pro',
        timestamp: '2026-04-10T01:10:00Z',
      }),
      stdout: {
        write: stdoutWrite,
      },
    })

    expect(stdoutWrite).toHaveBeenCalledTimes(1)
    expect(String(stdoutWrite.mock.calls[0]?.[0])).toContain('"host":"gemini-cli"')
    expect(String(stdoutWrite.mock.calls[0]?.[0])).toContain('"event_name":"user_prompt_submit"')
  })

  it('delivers a normalized batch when the API URL is configured', async () => {
    const deliverBatch = vi.fn().mockResolvedValue({
      delivered: true,
      buffered: false,
      flushed: 0,
    })

    await runGeminiCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: '/tmp/clipulse-gemini-state',
      },
      readStdin: async () => JSON.stringify({
        session_id: 'gemini-session',
        cwd: '/workspace/demo',
        hook_event_name: 'AfterTool',
        model: 'gemini-2.5-pro',
        timestamp: '2026-04-10T01:15:00Z',
      }),
      deliverBatch,
    })

    expect(deliverBatch).toHaveBeenCalledWith(
      'http://localhost:8000',
      expect.objectContaining({
        events: [
          expect.objectContaining({
            host: 'gemini-cli',
            session_id: 'gemini-session',
          }),
        ],
      }),
      expect.objectContaining({
        stateDir: '/tmp/clipulse-gemini-state',
      }),
    )
  })
})
