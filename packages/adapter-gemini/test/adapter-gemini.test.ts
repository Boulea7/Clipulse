import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { createFileFingerprint } from '@clipulse/collector-core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildGeminiHookEvent } from '../src/index.js'
import { runGeminiCli } from '../src/cli.js'

const tempDirs: string[] = []
const OFFICIAL_GEMINI_HOOKS = [
  'SessionStart',
  'BeforeTool',
  'AfterTool',
  'BeforeAgent',
  'AfterAgent',
  'SessionEnd',
] as const
const COMPATIBILITY_GEMINI_HOOKS = [
  'AfterToolFailure',
  'UserPromptSubmit',
] as const
const ACCEPTED_GEMINI_HOOKS = [
  ...OFFICIAL_GEMINI_HOOKS,
  ...COMPATIBILITY_GEMINI_HOOKS,
] as const

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

  it('maps official AfterAgent hooks to after_agent instead of prompt submission', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-project-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-state-'))
    tempDirs.push(projectRoot, stateDir)

    await buildGeminiHookEvent({
      session_id: 'gemini-session',
      cwd: projectRoot,
      hook_event_name: 'BeforeTool',
      model: 'gemini-2.5-pro',
      timestamp: '2026-04-10T01:04:00Z',
      tool_name: 'read_file',
      tool_input: {
        file_path: 'README.md',
      },
    }, {
      stateDir,
    })

    const afterAgent = await buildGeminiHookEvent({
      session_id: 'gemini-session',
      cwd: projectRoot,
      hook_event_name: 'AfterAgent',
      model: 'gemini-2.5-pro',
      timestamp: '2026-04-10T01:04:02Z',
      prompt: 'Please summarize what you found.',
    }, {
      stateDir,
    })

    expect(afterAgent.event_name).toBe('after_agent')
    expect(afterAgent.active_ms).toBe(2_000)
    expect(afterAgent.wait_ms).toBe(0)
    expect(afterAgent.file_deltas).toEqual([])
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

  it('counts same-line replace operations as changed lines instead of collapsing to zero', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-project-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-state-'))
    tempDirs.push(projectRoot, stateDir)

    const event = await buildGeminiHookEvent({
      session_id: 'gemini-session',
      cwd: projectRoot,
      hook_event_name: 'AfterTool',
      model: 'gemini-2.5-pro',
      timestamp: '2026-04-10T01:30:30Z',
      tool_name: 'replace',
      tool_input: {
        file_path: 'src/app.ts',
        old_string: 'const first = 1;\nconst second = 2;\n',
        new_string: 'const first = 10;\nconst second = 20;\n',
      },
    }, {
      stateDir,
    })

    expect(event.file_deltas).toEqual([
      expect.objectContaining({
        language: 'TypeScript',
        added: 2,
        removed: 2,
      }),
    ])
    expect(event.language_stats).toEqual({
      TypeScript: {
        added: 2,
        removed: 2,
        changed: 4,
      },
    })
  })

  it('does not overcount reordered lines inside replace payloads', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-project-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-state-'))
    tempDirs.push(projectRoot, stateDir)

    const event = await buildGeminiHookEvent({
      session_id: 'gemini-session',
      cwd: projectRoot,
      hook_event_name: 'AfterTool',
      model: 'gemini-2.5-pro',
      timestamp: '2026-04-10T01:30:31Z',
      tool_name: 'replace',
      tool_input: {
        file_path: 'src/app.ts',
        old_string: 'alpha\nbeta\n',
        new_string: 'beta\nalpha\n',
      },
    }, {
      stateDir,
    })

    expect(event.file_deltas).toEqual([
      expect.objectContaining({
        language: 'TypeScript',
        added: 1,
        removed: 1,
      }),
    ])
    expect(event.language_stats).toEqual({
      TypeScript: {
        added: 1,
        removed: 1,
        changed: 2,
      },
    })
  })

  it('ships a checked-in Gemini wiring example that only covers the official hook surface', async () => {
    const examplePath = new URL('../examples/.gemini/settings.json', import.meta.url)
    const example = JSON.parse(await fs.readFile(examplePath, 'utf-8'))

    expect(Object.keys(example.hooks)).toEqual(OFFICIAL_GEMINI_HOOKS)
    expect(example.hooks.AfterToolFailure).toBeUndefined()
    expect(example.hooks.UserPromptSubmit).toBeUndefined()

    for (const hookName of OFFICIAL_GEMINI_HOOKS) {
      expect(example.hooks[hookName]).toEqual([
        {
          matcher: '*',
          hooks: [
            {
              type: 'command',
              command: 'node /absolute/path/to/packages/adapter-gemini/dist/cli.js',
            },
          ],
        },
      ])
    }
  })

  it('documents the checked-in example as the canonical hook wiring and keeps aliases compatibility-only', async () => {
    const readmePath = new URL('../README.md', import.meta.url)
    const readme = await fs.readFile(readmePath, 'utf-8')

    expect(readme).toContain('`examples/.gemini/settings.json`')
    expect(readme).toContain('canonical checked-in wiring example')
    expect(readme).toContain('compatibility-only aliases')
    expect(readme).toContain('do not imply file-delta equivalence with the official hook surface')
  })

  it('limits Gemini file deltas to official AfterTool write_file and replace payloads', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-project-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-state-'))
    tempDirs.push(projectRoot, stateDir)

    const aliasHookEvent = await buildGeminiHookEvent({
      session_id: 'gemini-session',
      cwd: projectRoot,
      hook_event_name: 'after_tool',
      model: 'gemini-2.5-pro',
      timestamp: '2026-04-10T01:31:30Z',
      tool_name: 'write_file',
      tool_input: {
        file_path: 'src/alias-hook.ts',
        content: 'export const aliasHook = true;\n',
      },
    }, {
      stateDir,
    })

    const aliasToolEvent = await buildGeminiHookEvent({
      session_id: 'gemini-session',
      cwd: projectRoot,
      hook_event_name: 'AfterTool',
      model: 'gemini-2.5-pro',
      timestamp: '2026-04-10T01:31:31Z',
      tool_name: 'WriteFile',
      tool_input: {
        file_path: 'src/alias-tool.ts',
        content: 'export const aliasTool = true;\n',
      },
    }, {
      stateDir,
    })

    const readOnlyEvent = await buildGeminiHookEvent({
      session_id: 'gemini-session',
      cwd: projectRoot,
      hook_event_name: 'AfterTool',
      model: 'gemini-2.5-pro',
      timestamp: '2026-04-10T01:31:32Z',
      tool_name: 'read_file',
      tool_input: {
        file_path: 'src/read-only.ts',
        content: 'export const readOnly = true;\n',
      },
    }, {
      stateDir,
    })

    expect(aliasHookEvent).toBeNull()
    expect(aliasToolEvent.event_name).toBe('post_tool_use')
    expect(aliasToolEvent.file_deltas).toEqual([])
    expect(readOnlyEvent.file_deltas).toEqual([])
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
        fingerprint: createFileFingerprint(
          path.join(repoRoot, 'packages', 'adapter-gemini', 'src', 'local.ts'),
          repoRoot,
        ),
        language: 'TypeScript',
        added: 1,
        removed: 0,
      }),
    ])
  })

  it('drops absolute Gemini file paths outside the resolved project root', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-project-'))
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-outside-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-state-'))
    tempDirs.push(projectRoot, outsideRoot, stateDir)

    const event = await buildGeminiHookEvent({
      session_id: 'gemini-session',
      cwd: projectRoot,
      hook_event_name: 'AfterTool',
      model: 'gemini-2.5-pro',
      timestamp: '2026-04-10T01:31:02Z',
      tool_name: 'write_file',
      tool_input: {
        file_path: path.join(outsideRoot, 'src', 'outside.ts'),
        content: 'export const outside = true;\n',
      },
    }, {
      stateDir,
    })

    expect(event?.file_deltas).toEqual([])
    expect(event?.language_stats).toEqual({})
  })

  it('ignores undocumented Gemini hook names instead of normalizing them into sendable events', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-project-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-state-'))
    tempDirs.push(projectRoot, stateDir)

    const beforeModel = await buildGeminiHookEvent({
      session_id: 'gemini-session',
      cwd: projectRoot,
      hook_event_name: 'BeforeModel',
      model: 'gemini-2.5-pro',
      timestamp: '2026-04-10T01:31:40Z',
    }, {
      stateDir,
    })

    const afterModel = await buildGeminiHookEvent({
      session_id: 'gemini-session',
      cwd: projectRoot,
      hook_event_name: 'AfterModel',
      model: 'gemini-2.5-pro',
      timestamp: '2026-04-10T01:31:41Z',
    }, {
      stateDir,
    })

    expect(beforeModel).toBeNull()
    expect(afterModel).toBeNull()
  })

  it('accepts only the explicit Gemini hook allowlist', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-project-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-state-'))
    tempDirs.push(projectRoot, stateDir)

    for (const hookName of ACCEPTED_GEMINI_HOOKS) {
      const event = await buildGeminiHookEvent({
        session_id: 'gemini-session',
        cwd: projectRoot,
        hook_event_name: hookName,
        model: 'gemini-2.5-pro',
        timestamp: '2026-04-10T01:32:00Z',
      }, {
        stateDir,
      })

      expect(event).not.toBeNull()
    }

    for (const hookName of ['after_tool', 'BeforeModel', 'AfterModel']) {
      const event = await buildGeminiHookEvent({
        session_id: 'gemini-session',
        cwd: projectRoot,
        hook_event_name: hookName,
        model: 'gemini-2.5-pro',
        timestamp: '2026-04-10T01:32:01Z',
      }, {
        stateDir,
      })

      expect(event).toBeNull()
    }
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

  it('prints file deltas, language stats, and worktree-resolved project context for official AfterTool payloads', async () => {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-cli-worktree-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-cli-state-'))
    tempDirs.push(sandboxRoot, stateDir)

    const repoRoot = path.join(sandboxRoot, 'Clipulse')
    const worktreeRoot = path.join(repoRoot, '.worktrees', 'v1-alpha')
    const worktreeGitDir = path.join(repoRoot, '.git', 'worktrees', 'v1-alpha')
    const stdoutWrite = vi.fn()

    await fs.mkdir(worktreeRoot, { recursive: true })
    await fs.mkdir(worktreeGitDir, { recursive: true })
    await fs.writeFile(path.join(worktreeRoot, '.git'), `gitdir: ${worktreeGitDir}\n`, 'utf-8')
    await fs.writeFile(path.join(worktreeGitDir, 'HEAD'), 'ref: refs/heads/feat/v1-alpha\n', 'utf-8')
    await fs.writeFile(path.join(worktreeGitDir, 'commondir'), '../..\n', 'utf-8')

    await runGeminiCli({
      env: {
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'gemini-session',
        cwd: worktreeRoot,
        hook_event_name: 'AfterTool',
        model: 'gemini-2.5-pro',
        timestamp: '2026-04-10T02:10:00Z',
        tool_name: 'write_file',
        tool_input: {
          file_path: 'src/generated.ts',
          content: 'export const generated = true;\n',
        },
      }),
      stdout: {
        write: stdoutWrite,
      },
    })

    const batch = JSON.parse(String(stdoutWrite.mock.calls[0]?.[0]))
    const event = batch.events[0]

    expect(event.project_root).toBe(worktreeRoot)
    expect(event.project_name).toBe('Clipulse')
    expect(event.git_branch).toBe('feat/v1-alpha')
    expect(event.file_deltas).toEqual([
      expect.objectContaining({
        language: 'TypeScript',
        added: 1,
        removed: 0,
      }),
    ])
    expect(event.language_stats).toEqual({
      TypeScript: {
        added: 1,
        removed: 0,
        changed: 1,
      },
    })
  })

  it('finalizes wait timing on AfterToolFailure and clears local session state on SessionEnd through the CLI', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-cli-project-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-cli-state-'))
    tempDirs.push(projectRoot, stateDir)

    await runGeminiCli({
      env: {
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'gemini-session',
        cwd: projectRoot,
        hook_event_name: 'BeforeTool',
        model: 'gemini-2.5-pro',
        timestamp: '2026-04-10T02:20:00Z',
      }),
      stdout: {
        write: vi.fn(),
      },
    })

    const failedStdoutWrite = vi.fn()
    await runGeminiCli({
      env: {
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'gemini-session',
        cwd: projectRoot,
        hook_event_name: 'AfterToolFailure',
        model: 'gemini-2.5-pro',
        timestamp: '2026-04-10T02:20:03Z',
      }),
      stdout: {
        write: failedStdoutWrite,
      },
    })

    const failedBatch = JSON.parse(String(failedStdoutWrite.mock.calls[0]?.[0]))
    expect(failedBatch.events[0].event_name).toBe('post_tool_use_failure')
    expect(failedBatch.events[0].wait_ms).toBe(3_000)

    await runGeminiCli({
      env: {
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'gemini-session',
        cwd: projectRoot,
        hook_event_name: 'SessionEnd',
        model: 'gemini-2.5-pro',
        timestamp: '2026-04-10T02:20:04Z',
      }),
      stdout: {
        write: vi.fn(),
      },
    })

    await expect(fs.readdir(path.join(stateDir, 'sessions'))).resolves.toEqual([])
  })

  it('does not print or deliver batches for ignored Gemini hooks', async () => {
    const stdoutWrite = vi.fn()
    const stderrWrite = vi.fn()
    const deliverBatch = vi.fn()

    await runGeminiCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: '/tmp/clipulse-gemini-state',
      },
      readStdin: async () => JSON.stringify({
        session_id: 'gemini-session',
        cwd: '/workspace/demo',
        hook_event_name: 'AfterModel',
        model: 'gemini-2.5-pro',
        timestamp: '2026-04-10T02:20:05Z',
      }),
      deliverBatch,
      stderr: {
        write: stderrWrite,
      },
      stdout: {
        write: stdoutWrite,
      },
    })

    expect(stdoutWrite).not.toHaveBeenCalled()
    expect(deliverBatch).not.toHaveBeenCalled()
    expect(stderrWrite).not.toHaveBeenCalled()
  })

  it('prints a debug diagnostic for ignored Gemini hooks only when debug logging is enabled', async () => {
    const stdoutWrite = vi.fn()
    const stderrWrite = vi.fn()
    const deliverBatch = vi.fn()

    await runGeminiCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_GEMINI_DEBUG_HOOKS: '1',
        CLIPULSE_STATE_DIR: '/tmp/clipulse-gemini-state',
      },
      readStdin: async () => JSON.stringify({
        session_id: 'gemini-session',
        cwd: '/workspace/demo',
        hook_event_name: 'AfterModel',
        model: 'gemini-2.5-pro',
        timestamp: '2026-04-10T02:20:06Z',
      }),
      deliverBatch,
      stderr: {
        write: stderrWrite,
      },
      stdout: {
        write: stdoutWrite,
      },
    })

    expect(stdoutWrite).not.toHaveBeenCalled()
    expect(deliverBatch).not.toHaveBeenCalled()
    expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('ignored_hook_not_allowlisted'))
    expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('AfterModel'))
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
