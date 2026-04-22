import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { createEventId, createFileFingerprint } from '@clipulse/collector-core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildGeminiHookEvent, type GeminiHookInput } from '../src/index.js'
import { runGeminiCli, runGeminiCliEntrypoint } from '../src/cli.js'
import {
  geminiSmokeScenarios,
  materializeGeminiSmokeStep,
  runGeminiSmokeScenarios,
} from '../../../scripts/smoke-gemini.mjs'

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
const GEMINI_EXAMPLE_PATH = new URL('../examples/.gemini/settings.json', import.meta.url)
const GEMINI_AFTER_TOOL_SMOKE_FIXTURE_PATH = new URL('../examples/after-tool.write-file.json', import.meta.url)
const GEMINI_AFTER_TOOL_REPLACE_SMOKE_FIXTURE_PATH = new URL('../examples/after-tool.replace.json', import.meta.url)
const GEMINI_READ_ONLY_SMOKE_FIXTURE_PATH = new URL('../examples/after-tool.read-file.json', import.meta.url)
const GEMINI_LEGACY_PROMPT_SMOKE_FIXTURE_PATH = new URL('../examples/user-prompt-submit.prompt-only.json', import.meta.url)
const GEMINI_README_PATH = new URL('../README.md', import.meta.url)
const REPO_ROOT = new URL('../../../', import.meta.url)

async function readGeminiSettingsExample(): Promise<{
  hooks: Record<string, Array<{
    matcher: string
    hooks: Array<{
      type: string
      command: string
    }>
  }>>
}> {
  return JSON.parse(await fs.readFile(GEMINI_EXAMPLE_PATH, 'utf-8'))
}

async function readGeminiAfterToolSmokeFixture(): Promise<GeminiHookInput> {
  return JSON.parse(await fs.readFile(GEMINI_AFTER_TOOL_SMOKE_FIXTURE_PATH, 'utf-8')) as GeminiHookInput
}

async function readGeminiAfterToolReplaceSmokeFixture(): Promise<GeminiHookInput> {
  return JSON.parse(await fs.readFile(GEMINI_AFTER_TOOL_REPLACE_SMOKE_FIXTURE_PATH, 'utf-8')) as GeminiHookInput
}

async function readGeminiReadOnlySmokeFixture(): Promise<GeminiHookInput> {
  return JSON.parse(await fs.readFile(GEMINI_READ_ONLY_SMOKE_FIXTURE_PATH, 'utf-8')) as GeminiHookInput
}

async function readGeminiLegacyPromptSmokeFixture(): Promise<GeminiHookInput> {
  return JSON.parse(await fs.readFile(GEMINI_LEGACY_PROMPT_SMOKE_FIXTURE_PATH, 'utf-8')) as GeminiHookInput
}

function getGeminiSmokeScenario(name: string) {
  const scenario = geminiSmokeScenarios.find((candidate) => candidate.name === name)
  expect(scenario).toBeDefined()
  return scenario!
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true })
    }),
  )
})

async function readOnlyGeminiSessionState(stateDir: string): Promise<string> {
  const sessionDir = path.join(stateDir, 'sessions')
  const sessionFiles = await fs.readdir(sessionDir)

  expect(sessionFiles).toHaveLength(1)

  return fs.readFile(path.join(sessionDir, sessionFiles[0]!), 'utf-8')
}

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
    const canonicalRepoRoot = await fs.realpath(repoRoot)

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
    expect(event.project_root).toBe(canonicalRepoRoot)
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

  it('treats blank optional strings as absent so timestamp and default model fallbacks still apply', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-project-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-state-'))
    tempDirs.push(projectRoot, stateDir)

    const event = await buildGeminiHookEvent({
      session_id: 'gemini-session',
      cwd: projectRoot,
      hook_event_name: 'UserPromptSubmit',
      model: '   ',
      event_time: '',
      timestamp: '2026-04-10T01:04:09Z',
    }, {
      stateDir,
    })

    expect(event.model_name).toBe('unknown')
    expect(event.event_time).toBe('2026-04-10T01:04:09Z')
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

  it('keeps large replace payloads on the bounded fast path once the diff exceeds the matrix threshold', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-project-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-state-'))
    tempDirs.push(projectRoot, stateDir)

    const prefixLines = Array.from({ length: 5_000 }, (_, index) => `shared-prefix-${index}`)
    const suffixLines = Array.from({ length: 5_000 }, (_, index) => `shared-suffix-${index}`)
    const reorderedBlockA = Array.from({ length: 1_000 }, (_, index) => `block-a-${index}`)
    const reorderedBlockB = Array.from({ length: 1_000 }, (_, index) => `block-b-${index}`)
    const oldMiddleLines = [...reorderedBlockA, ...reorderedBlockB]
    const newMiddleLines = [...reorderedBlockB, ...reorderedBlockA]
    const oldString = `${[...prefixLines, ...oldMiddleLines, ...suffixLines].join('\n')}\n`
    const newString = `${[...prefixLines, ...newMiddleLines, ...suffixLines].join('\n')}\n`

    const event = await buildGeminiHookEvent({
      session_id: 'gemini-session',
      cwd: projectRoot,
      hook_event_name: 'AfterTool',
      model: 'gemini-2.5-pro',
      timestamp: '2026-04-10T01:30:32Z',
      tool_name: 'replace',
      tool_input: {
        file_path: 'src/app.ts',
        old_string: oldString,
        new_string: newString,
      },
    }, {
      stateDir,
    })

    expect(event.file_deltas).toEqual([
      expect.objectContaining({
        language: 'TypeScript',
        added: 2_000,
        removed: 2_000,
      }),
    ])
    expect(event.language_stats).toEqual({
      TypeScript: {
        added: 2_000,
        removed: 2_000,
        changed: 4_000,
      },
    })
  }, 1_500)

  it('does not massively overcount two tiny distant edits in a very large replace payload', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-project-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-state-'))
    tempDirs.push(projectRoot, stateDir)

    const prefixLines = Array.from({ length: 3_000 }, (_, index) => `shared-prefix-${index}`)
    const middleLines = Array.from({ length: 6_000 }, (_, index) => `shared-middle-${index}`)
    const suffixLines = Array.from({ length: 3_000 }, (_, index) => `shared-suffix-${index}`)
    const oldString = `${[
      ...prefixLines,
      'const beforeTop = true;',
      ...middleLines,
      'const beforeBottom = true;',
      ...suffixLines,
    ].join('\n')}\n`
    const newString = `${[
      ...prefixLines,
      'const afterTop = true;',
      ...middleLines,
      'const afterBottom = true;',
      ...suffixLines,
    ].join('\n')}\n`

    const event = await buildGeminiHookEvent({
      session_id: 'gemini-session',
      cwd: projectRoot,
      hook_event_name: 'AfterTool',
      model: 'gemini-2.5-pro',
      timestamp: '2026-04-10T01:35:00Z',
      tool_name: 'replace',
      tool_input: {
        file_path: 'src/app.ts',
        old_string: oldString,
        new_string: newString,
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
  }, 1_500)

  it('keeps a pure prompt-only multi-turn path wait-free through the CLI', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-cli-project-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-cli-state-'))
    tempDirs.push(projectRoot, stateDir)

    const steps = [
      {
        hook_event_name: 'SessionStart',
        timestamp: '2026-04-10T01:11:00Z',
      },
      {
        hook_event_name: 'BeforeAgent',
        prompt: 'Turn one prompt',
        timestamp: '2026-04-10T01:11:02Z',
      },
      {
        hook_event_name: 'AfterAgent',
        timestamp: '2026-04-10T01:11:05Z',
      },
      {
        hook_event_name: 'BeforeAgent',
        prompt: 'Turn two prompt',
        timestamp: '2026-04-10T01:11:08Z',
      },
      {
        hook_event_name: 'AfterAgent',
        timestamp: '2026-04-10T01:11:12Z',
      },
      {
        hook_event_name: 'SessionEnd',
        timestamp: '2026-04-10T01:11:15Z',
      },
    ]

    const outputs: string[] = []
    for (const step of steps) {
      const stdoutWrite = vi.fn((chunk: string) => {
        outputs.push(String(chunk))
      })

      await runGeminiCli({
        env: {
          CLIPULSE_STATE_DIR: stateDir,
        },
        readStdin: async () => JSON.stringify({
          session_id: 'gemini-session',
          cwd: projectRoot,
          model: 'gemini-2.5-pro',
          ...step,
        }),
        stdout: {
          write: stdoutWrite,
        },
      })
    }

    const events = outputs.map((output) => JSON.parse(output).events[0])
    expect(events.map((event) => event.event_name)).toEqual([
      'session_start',
      'user_prompt_submit',
      'after_agent',
      'user_prompt_submit',
      'after_agent',
      'session_end',
    ])
    expect(events.map((event) => event.wait_ms)).toEqual([0, 0, 0, 0, 0, 0])
    expect(events.map((event) => event.file_deltas)).toEqual([[], [], [], [], [], []])
    expect(events[1]?.active_ms).toBe(2_000)
    expect(events[2]?.active_ms).toBe(3_000)
    expect(events[3]?.active_ms).toBe(3_000)
    expect(events[4]?.active_ms).toBe(4_000)
    expect(events[5]?.active_ms).toBe(3_000)
    await expect(fs.readdir(path.join(stateDir, 'sessions'))).resolves.toEqual([])
  })

  it('keeps pending tool waits open across BeforeTool -> AfterAgent -> AfterTool', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-project-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-state-'))
    tempDirs.push(projectRoot, stateDir)

    await buildGeminiHookEvent({
      session_id: 'gemini-session',
      cwd: projectRoot,
      hook_event_name: 'BeforeTool',
      model: 'gemini-2.5-pro',
      timestamp: '2026-04-10T01:10:00Z',
      tool_name: 'read_file',
    }, {
      stateDir,
    })

    const afterAgent = await buildGeminiHookEvent({
      session_id: 'gemini-session',
      cwd: projectRoot,
      hook_event_name: 'AfterAgent',
      model: 'gemini-2.5-pro',
      timestamp: '2026-04-10T01:10:02Z',
    }, {
      stateDir,
    })

    const afterTool = await buildGeminiHookEvent({
      session_id: 'gemini-session',
      cwd: projectRoot,
      hook_event_name: 'AfterTool',
      model: 'gemini-2.5-pro',
      timestamp: '2026-04-10T01:10:05Z',
      tool_name: 'read_file',
    }, {
      stateDir,
    })

    expect(afterAgent.event_name).toBe('after_agent')
    expect(afterAgent.active_ms).toBe(2_000)
    expect(afterAgent.wait_ms).toBe(0)
    expect(afterTool.event_name).toBe('post_tool_use')
    expect(afterTool.active_ms).toBe(0)
    expect(afterTool.wait_ms).toBe(5_000)
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

  it('keeps pending tool waits open across BeforeTool -> AfterAgent -> AfterToolFailure -> SessionEnd', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-project-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-state-'))
    tempDirs.push(projectRoot, stateDir)

    await buildGeminiHookEvent({
      session_id: 'gemini-session',
      cwd: projectRoot,
      hook_event_name: 'BeforeTool',
      model: 'gemini-2.5-pro',
      timestamp: '2026-04-10T01:20:00Z',
    }, {
      stateDir,
    })

    const afterAgent = await buildGeminiHookEvent({
      session_id: 'gemini-session',
      cwd: projectRoot,
      hook_event_name: 'AfterAgent',
      model: 'gemini-2.5-pro',
      timestamp: '2026-04-10T01:20:02Z',
    }, {
      stateDir,
    })

    const failedEvent = await buildGeminiHookEvent({
      session_id: 'gemini-session',
      cwd: projectRoot,
      hook_event_name: 'AfterToolFailure',
      model: 'gemini-2.5-pro',
      timestamp: '2026-04-10T01:20:05Z',
    }, {
      stateDir,
    })

    const sessionEnd = await buildGeminiHookEvent({
      session_id: 'gemini-session',
      cwd: projectRoot,
      hook_event_name: 'SessionEnd',
      model: 'gemini-2.5-pro',
      timestamp: '2026-04-10T01:20:07Z',
    }, {
      stateDir,
    })

    expect(afterAgent.event_name).toBe('after_agent')
    expect(afterAgent.active_ms).toBe(2_000)
    expect(afterAgent.wait_ms).toBe(0)
    expect(failedEvent.event_name).toBe('post_tool_use_failure')
    expect(failedEvent.active_ms).toBe(0)
    expect(failedEvent.wait_ms).toBe(5_000)
    expect(sessionEnd.event_name).toBe('session_end')
    expect(sessionEnd.active_ms).toBe(2_000)
    expect(sessionEnd.wait_ms).toBe(0)
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

  it('derives the canonical Gemini baseline wiring surface from the checked-in settings example', async () => {
    const example = await readGeminiSettingsExample()
    const canonicalBaselineSurface = Object.keys(example.hooks)

    expect(canonicalBaselineSurface).toEqual(OFFICIAL_GEMINI_HOOKS)
    expect(canonicalBaselineSurface).not.toContain('AfterToolFailure')
    expect(canonicalBaselineSurface).not.toContain('UserPromptSubmit')
    expect([...canonicalBaselineSurface, ...COMPATIBILITY_GEMINI_HOOKS]).toEqual(
      ACCEPTED_GEMINI_HOOKS,
    )
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
    const readme = await fs.readFile(GEMINI_README_PATH, 'utf-8')

    expect(readme).toContain('`examples/.gemini/settings.json`')
    expect(readme).toContain('canonical checked-in wiring example')
    expect(readme).toContain('compatibility-only aliases')
    expect(readme).toContain('do not widen the official wiring contract')
    expect(readme).toContain('`BeforeAgent` and compatibility-only `UserPromptSubmit` should not both be wired')
    expect(readme).toContain('do not imply file-delta equivalence with the official hook surface')
    expect(readme).toContain('keep `SessionEnd` as a best-effort stop/cleanup fallback')
    expect(readme).toContain('not a guaranteed completion barrier')
    expect(readme).toContain('transcript parsing')
    expect(readme).toContain('shell command parsing')
    expect(readme).toContain('broad or transcript-derived file delta capture')
    expect(readme).toContain('accepted values are `1` and `true`')
  })

  it('keeps a tiny real-smoke AfterTool fixture aligned with the official Gemini docs contract', async () => {
    const fixture = await readGeminiAfterToolSmokeFixture()
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-state-'))
    tempDirs.push(stateDir)

    const event = await buildGeminiHookEvent(fixture, {
      stateDir,
    })

    expect(fixture.hook_event_name).toBe('AfterTool')
    expect(OFFICIAL_GEMINI_HOOKS).toContain('AfterTool')
    expect(fixture.tool_name).toBe('write_file')
    expect(fixture.tool_input?.file_path).toBe('src/smoke.ts')
    expect(fixture.tool_input?.content).toBe('export const smoke = true;\n')
    expect(event?.event_name).toBe('post_tool_use')
    expect(event?.file_deltas).toEqual([
      expect.objectContaining({
        language: 'TypeScript',
        added: 1,
        removed: 0,
      }),
    ])
    expect(event?.language_stats).toEqual({
      TypeScript: {
        added: 1,
        removed: 0,
        changed: 1,
      },
    })
  })

  it('keeps a checked-in read-only AfterTool fixture zero-delta and aligned with the official Gemini docs contract', async () => {
    const fixture = await readGeminiReadOnlySmokeFixture()
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-state-'))
    tempDirs.push(stateDir)

    const event = await buildGeminiHookEvent(fixture, {
      stateDir,
    })

    expect(fixture.hook_event_name).toBe('AfterTool')
    expect(OFFICIAL_GEMINI_HOOKS).toContain('AfterTool')
    expect(fixture.tool_name).toBe('read_file')
    expect(event?.event_name).toBe('post_tool_use')
    expect(event?.file_deltas).toEqual([])
    expect(event?.language_stats).toEqual({})
  })

  it('keeps a checked-in replace AfterTool fixture aligned with the experimental Gemini docs contract', async () => {
    const fixture = await readGeminiAfterToolReplaceSmokeFixture()
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-state-'))
    tempDirs.push(stateDir)

    const event = await buildGeminiHookEvent(fixture, {
      stateDir,
    })

    expect(fixture.hook_event_name).toBe('AfterTool')
    expect(fixture.tool_name).toBe('replace')
    expect(fixture.tool_input?.file_path).toBe('src/smoke.ts')
    expect(event?.event_name).toBe('post_tool_use')
    expect(event?.file_deltas).toEqual([
      expect.objectContaining({
        language: 'TypeScript',
        added: 1,
        removed: 1,
      }),
    ])
    expect(event?.language_stats).toEqual({
      TypeScript: {
        added: 1,
        removed: 1,
        changed: 2,
      },
    })
  })

  it('keeps a checked-in legacy UserPromptSubmit prompt-only fixture aligned with the compatibility contract', async () => {
    const fixture = await readGeminiLegacyPromptSmokeFixture()
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-state-'))
    tempDirs.push(stateDir)

    const event = await buildGeminiHookEvent(fixture, {
      stateDir,
    })

    expect(fixture.hook_event_name).toBe('UserPromptSubmit')
    expect(fixture.prompt).toContain('legacy prompt alias')
    expect(event?.event_name).toBe('user_prompt_submit')
    expect(event?.wait_ms).toBe(0)
    expect(event?.file_deltas).toEqual([])
    expect(event?.language_stats).toEqual({})
  })

  it('locks the canonical Gemini smoke script stdout contract to the checked-in scenario matrix', async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-smoke-'))
    tempDirs.push(stateDir)

    const result = spawnSync('node', ['scripts/smoke-gemini.mjs'], {
      cwd: path.resolve(REPO_ROOT.pathname),
      env: {
        ...process.env,
        CLIPULSE_STATE_DIR: stateDir,
      },
      encoding: 'utf8',
    })

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    const outputLines = result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)

    expect(outputLines).toHaveLength(31)
    const events = outputLines.flatMap((line) => JSON.parse(line).events)
    expect(events[0]?.event_name).toBe('session_start')
    expect(events.some((event) => event.session_id === 'gemini-baseline-session' && event.event_name === 'user_prompt_submit')).toBe(true)
    expect(events.some((event) => event.session_id === 'gemini-legacy-prompt-session' && event.event_name === 'user_prompt_submit')).toBe(true)
    expect(events.some((event) => event.session_id === 'gemini-readonly-session' && event.event_name === 'pre_tool_use')).toBe(true)
    expect(events.some((event) => event.session_id === 'gemini-readonly-session' && event.event_name === 'session_end' && event.wait_ms > 0)).toBe(true)
    expect(events.filter((event) => event.session_id === 'gemini-prompt-only-session' && event.event_name === 'user_prompt_submit')).toHaveLength(2)
    expect(events.filter((event) => event.session_id === 'gemini-prompt-only-session' && event.event_name === 'after_agent')).toHaveLength(2)
    expect(events.some((event) => event.session_id === 'gemini-failure-session' && event.event_name === 'post_tool_use_failure' && event.wait_ms > 0)).toBe(true)
    expect(events.some((event) => event.session_id === 'gemini-smoke-session' && event.event_name === 'post_tool_use' && event.file_deltas.length === 0)).toBe(true)
    expect(events.some((event) => event.session_id === 'gemini-smoke-session' && event.event_name === 'post_tool_use' && event.file_deltas.length === 1)).toBe(true)
    expect(events.some((event) => event.session_id === 'gemini-smoke-session' && event.event_name === 'post_tool_use' && event.file_deltas[0]?.added === 1 && event.file_deltas[0]?.removed === 1)).toBe(true)
    expect(events.some((event) => event.session_id === 'gemini-smoke-session' && event.event_name === 'after_agent' && event.active_ms > 0)).toBe(true)
    expect(geminiSmokeScenarios.map((scenario) => scenario.name)).toEqual([
      'official-baseline',
      'legacy-prompt-submit',
      'read-only-fallback',
      'prompt-only-multi-turn',
      'tool-failure-read-only',
      'multi-turn-mixed',
    ])
  }, 15_000)

  it('keeps the canonical Gemini smoke scenario matrix aligned with failure and pure prompt-only coverage', () => {
    const legacyPromptScenario = getGeminiSmokeScenario('legacy-prompt-submit')
    const promptOnlyScenario = getGeminiSmokeScenario('prompt-only-multi-turn')
    const failureScenario = getGeminiSmokeScenario('tool-failure-read-only')

    expect(legacyPromptScenario.requiredEventNames).toEqual([
      'session_start',
      'user_prompt_submit',
      'after_agent',
      'session_end',
    ])
    expect(
      legacyPromptScenario.steps.map((step, stepIndex) =>
        materializeGeminiSmokeStep(step, legacyPromptScenario, stepIndex).hook_event_name,
      ),
    ).toEqual([
      'SessionStart',
      'UserPromptSubmit',
      'AfterAgent',
      'SessionEnd',
    ])

    expect(promptOnlyScenario.requiredEventNames).toEqual([
      'session_start',
      'user_prompt_submit',
      'after_agent',
      'session_end',
    ])
    expect(
      promptOnlyScenario.steps.map((step, stepIndex) =>
        materializeGeminiSmokeStep(step, promptOnlyScenario, stepIndex).hook_event_name,
      ),
    ).toEqual([
      'SessionStart',
      'BeforeAgent',
      'AfterAgent',
      'BeforeAgent',
      'AfterAgent',
      'SessionEnd',
    ])

    expect(failureScenario.requiredEventNames).toEqual([
      'session_start',
      'pre_tool_use',
      'post_tool_use_failure',
      'session_end',
    ])
    expect(
      failureScenario.steps.map((step, stepIndex) =>
        materializeGeminiSmokeStep(step, failureScenario, stepIndex).hook_event_name,
      ),
    ).toEqual([
      'SessionStart',
      'BeforeTool',
      'AfterToolFailure',
      'SessionEnd',
    ])
  })

  it('replays the Gemini smoke helper matrix with failure and prompt-only metadata assertions', async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-smoke-'))
    tempDirs.push(stateDir)

    const { payloads, stdout } = await runGeminiSmokeScenarios({ stateDir })
    const events = payloads.flatMap((payload) => payload.events)
    const legacyPromptEvents = events.filter((event) => event.session_id === 'gemini-legacy-prompt-session')
    const promptOnlyEvents = events.filter((event) => event.session_id === 'gemini-prompt-only-session')
    const failureEvents = events.filter((event) => event.session_id === 'gemini-failure-session')
    const replaceEvent = events.find((event) =>
      event.session_id === 'gemini-smoke-session'
      && event.event_name === 'post_tool_use'
      && event.file_deltas[0]?.added === 1
      && event.file_deltas[0]?.removed === 1,
    )

    expect(stdout.trim()).not.toBe('')
    expect(new Set(events.map((event) => event.host))).toEqual(new Set(['gemini-cli']))
    expect(new Set(events.map((event) => event.privacy_mode))).toEqual(new Set(['hashed']))
    expect(legacyPromptEvents.map((event) => event.event_name)).toEqual([
      'session_start',
      'user_prompt_submit',
      'after_agent',
      'session_end',
    ])
    expect(legacyPromptEvents.every((event) => event.wait_ms === 0)).toBe(true)
    expect(legacyPromptEvents.every((event) => event.file_deltas.length === 0)).toBe(true)
    expect(promptOnlyEvents.map((event) => event.event_name)).toEqual([
      'session_start',
      'user_prompt_submit',
      'after_agent',
      'user_prompt_submit',
      'after_agent',
      'session_end',
    ])
    expect(promptOnlyEvents.every((event) => event.wait_ms === 0)).toBe(true)
    expect(promptOnlyEvents.every((event) => event.file_deltas.length === 0)).toBe(true)
    expect(promptOnlyEvents.filter((event) => event.event_name === 'after_agent').every((event) => event.active_ms > 0)).toBe(true)
    expect(failureEvents.map((event) => event.event_name)).toEqual([
      'session_start',
      'pre_tool_use',
      'post_tool_use_failure',
      'session_end',
    ])
    expect(failureEvents[2]?.wait_ms).toBe(4_000)
    expect(failureEvents[2]?.file_deltas).toEqual([])
    expect(failureEvents[3]?.wait_ms).toBe(0)
    expect(replaceEvent?.language_stats).toEqual({
      TypeScript: {
        added: 1,
        removed: 1,
        changed: 2,
      },
    })
  })

  it('localizes Gemini smoke payload mismatches to the actual step label and exact file delta assertion', async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-smoke-'))
    tempDirs.push(stateDir)

    const scenario = {
      name: 'replace-localization',
      cwd: '/workspace/replace-localization',
      requiredEventNames: ['post_tool_use'],
      secondOffsets: [0],
      sessionId: 'replace-localization-session',
      steps: [
        {
          label: 'replace completion',
          fixtureRelativePath: 'packages/adapter-gemini/examples/after-tool.replace.json',
          expect: {
            activeMs: 0,
            fileDeltaCount: 1,
            fileDeltas: [
              {
                language: 'TypeScript',
                added: 1,
                removed: 1,
              },
            ],
            waitMs: 0,
          },
        },
      ],
    }

    await expect(runGeminiSmokeScenarios({
      stateDir,
      scenarios: [scenario],
      runner: async () => ({
        code: 0,
        stderr: '',
        stdout: JSON.stringify({
          events: [
            {
              host: 'gemini-cli',
              session_id: 'replace-localization-session',
              event_name: 'post_tool_use',
              project_root: '/workspace/replace-localization',
              project_name: 'replace-localization',
              model_name: 'gemini-2.5-pro',
              event_time: '2026-04-10T03:00:00Z',
              privacy_mode: 'hashed',
              active_ms: 0,
              wait_ms: 0,
              language_stats: {},
              file_deltas: [
                {
                  language: 'TypeScript',
                  added: 9,
                  removed: 0,
                },
              ],
            },
          ],
        }),
      }),
    })).rejects.toThrow('replace completion (AfterTool)')
  })

  it('imports the Gemini smoke module without executing the smoke runner', () => {
    const result = spawnSync(
      'node',
      ['--input-type=module', '-e', 'await import("./scripts/smoke-gemini.mjs")'],
      {
        cwd: path.resolve(REPO_ROOT.pathname),
        env: process.env,
        encoding: 'utf8',
      },
    )

    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')
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
    const canonicalRepoRoot = await fs.realpath(repoRoot)

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

    expect(event.project_root).toBe(canonicalRepoRoot)
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
    const output = String(stdoutWrite.mock.calls[0]?.[0])
    expect(output).toContain('"host":"gemini-cli"')
    expect(output).toContain('"event_name":"user_prompt_submit"')
    expect(output).toContain('"event_id":"')
    expect(output).not.toContain('/workspace/demo')
  })

  it('skips tracking when CLIPULSE_REQUIRE_PROJECT_FILE=1 and the project has no .clipulse-project', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-project-file-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-project-file-state-'))
    tempDirs.push(projectRoot, stateDir)
    const stdoutWrite = vi.fn()
    const deliverBatch = vi.fn()

    await fs.mkdir(path.join(projectRoot, '.git'), { recursive: true })
    await fs.writeFile(path.join(projectRoot, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf-8')

    await runGeminiCli({
      env: {
        CLIPULSE_REQUIRE_PROJECT_FILE: '1',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'gemini-session',
        cwd: projectRoot,
        hook_event_name: 'UserPromptSubmit',
        model: 'gemini-2.5-pro',
        timestamp: '2026-04-10T01:10:00Z',
      }),
      deliverBatch,
      stdout: {
        write: stdoutWrite,
      },
    })

    expect(stdoutWrite).not.toHaveBeenCalled()
    expect(deliverBatch).not.toHaveBeenCalled()
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

    expect(event.project_root).toMatch(/^[0-9a-f]{12}$/)
    expect(event.project_name).toBe('Clipulse')
    expect(event.git_branch).toBe('feat/v1-alpha')
    expect(event.event_id).toBeDefined()
    expect(event.event_id).toBe(createEventId(event))
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
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-cli-state-'))
    tempDirs.push(stateDir)
    const stdoutWrite = vi.fn()
    const stderrWrite = vi.fn()
    const deliverBatch = vi.fn()

    await runGeminiCli({
      env: {
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'gemini-session',
        cwd: '/workspace/demo',
        hook_event_name: 'BeforeTool',
        model: 'gemini-2.5-pro',
        timestamp: '2026-04-10T02:20:05Z',
      }),
      stdout: {
        write: vi.fn(),
      },
    })

    const committedBeforeIgnoredHook = await readOnlyGeminiSessionState(stateDir)

    await runGeminiCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_GEMINI_DEBUG_HOOKS: '1',
        CLIPULSE_STATE_DIR: stateDir,
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
    await expect(readOnlyGeminiSessionState(stateDir)).resolves.toBe(committedBeforeIgnoredHook)
  })

  it('also accepts CLIPULSE_GEMINI_DEBUG_HOOKS=true for ignored-hook diagnostics', async () => {
    const stdoutWrite = vi.fn()
    const stderrWrite = vi.fn()
    const deliverBatch = vi.fn()

    await runGeminiCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_GEMINI_DEBUG_HOOKS: 'true',
        CLIPULSE_STATE_DIR: '/tmp/clipulse-gemini-state',
      },
      readStdin: async () => JSON.stringify({
        session_id: 'gemini-session',
        cwd: '/workspace/demo',
        hook_event_name: 'AfterModel',
        model: 'gemini-2.5-pro',
        timestamp: '2026-04-10T02:20:07Z',
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

  it('normalizes CLIPULSE_GEMINI_DEBUG_HOOKS with trim and lowercase before checking ignored-hook diagnostics', async () => {
    const stdoutWrite = vi.fn()
    const stderrWrite = vi.fn()
    const deliverBatch = vi.fn()

    await runGeminiCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_GEMINI_DEBUG_HOOKS: ' True ',
        CLIPULSE_STATE_DIR: '/tmp/clipulse-gemini-state',
      },
      readStdin: async () => JSON.stringify({
        session_id: 'gemini-session',
        cwd: '/workspace/demo',
        hook_event_name: 'AfterModel',
        model: 'gemini-2.5-pro',
        timestamp: '2026-04-10T02:20:07Z',
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

  it('preserves the numeric debug opt-in after trimming whitespace', async () => {
    const stdoutWrite = vi.fn()
    const stderrWrite = vi.fn()
    const deliverBatch = vi.fn()

    await runGeminiCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_GEMINI_DEBUG_HOOKS: ' 1 ',
        CLIPULSE_STATE_DIR: '/tmp/clipulse-gemini-state',
      },
      readStdin: async () => JSON.stringify({
        session_id: 'gemini-session',
        cwd: '/workspace/demo',
        hook_event_name: 'AfterModel',
        model: 'gemini-2.5-pro',
        timestamp: '2026-04-10T02:20:07Z',
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

  it('keeps allowlisted Gemini hooks quiet even when debug logging is enabled', async () => {
    const stdoutWrite = vi.fn()
    const stderrWrite = vi.fn()
    const deliverBatch = vi.fn()

    await runGeminiCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_GEMINI_DEBUG_HOOKS: 'true',
        CLIPULSE_STATE_DIR: '/tmp/clipulse-gemini-state',
      },
      readStdin: async () => JSON.stringify({
        session_id: 'gemini-session',
        cwd: '/workspace/demo',
        hook_event_name: 'UserPromptSubmit',
        model: 'gemini-2.5-pro',
        timestamp: '2026-04-10T02:20:08Z',
      }),
      deliverBatch,
      stderr: {
        write: stderrWrite,
      },
      stdout: {
        write: stdoutWrite,
      },
    })

    expect(stderrWrite).not.toHaveBeenCalled()
    expect(stdoutWrite).not.toHaveBeenCalled()
    expect(deliverBatch).toHaveBeenCalledTimes(1)
  })

  it('prints a controlled stderr message instead of crashing on invalid JSON stdin', async () => {
    const stdoutWrite = vi.fn()
    const stderrWrite = vi.fn()
    const deliverBatch = vi.fn()

    await expect(runGeminiCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: '/tmp/clipulse-gemini-state',
      },
      readStdin: async () => '{"session_id":"gemini-session"',
      deliverBatch,
      stderr: {
        write: stderrWrite,
      },
      stdout: {
        write: stdoutWrite,
      },
    })).resolves.toBeUndefined()

    expect(stdoutWrite).not.toHaveBeenCalled()
    expect(deliverBatch).not.toHaveBeenCalled()
    expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('[clipulse-gemini] invalid_json_stdin'))
  })

  it('exits non-zero on invalid JSON stdin at the CLI entrypoint', async () => {
    const stdoutWrite = vi.fn()
    const stderrWrite = vi.fn()
    const exit = vi.fn()

    await expect(runGeminiCliEntrypoint({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: '/tmp/clipulse-gemini-state',
      },
      readStdin: async () => '{"session_id":"gemini-session"',
      stderr: {
        write: stderrWrite,
      },
      stdout: {
        write: stdoutWrite,
      },
      exit,
    })).resolves.toBeUndefined()

    expect(stdoutWrite).not.toHaveBeenCalled()
    expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('[clipulse-gemini] invalid_json_stdin'))
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('rejects non-object Gemini hook payloads with a controlled stderr message', async () => {
    const stdoutWrite = vi.fn()
    const stderrWrite = vi.fn()
    const deliverBatch = vi.fn()

    await expect(runGeminiCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: '/tmp/clipulse-gemini-state',
      },
      readStdin: async () => '[]',
      deliverBatch,
      stderr: {
        write: stderrWrite,
      },
      stdout: {
        write: stdoutWrite,
      },
    })).resolves.toBeUndefined()

    expect(stdoutWrite).not.toHaveBeenCalled()
    expect(deliverBatch).not.toHaveBeenCalled()
    expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('[clipulse-gemini] invalid_hook_input'))
    expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('expected="object"'))
  })

  it('rejects Gemini hook payloads missing required non-empty string fields', async () => {
    const stdoutWrite = vi.fn()
    const stderrWrite = vi.fn()
    const deliverBatch = vi.fn()

    await expect(runGeminiCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: '/tmp/clipulse-gemini-state',
      },
      readStdin: async () => JSON.stringify({
        session_id: '',
        cwd: '/workspace/demo',
        hook_event_name: 'BeforeAgent',
      }),
      deliverBatch,
      stderr: {
        write: stderrWrite,
      },
      stdout: {
        write: stdoutWrite,
      },
    })).resolves.toBeUndefined()

    expect(stdoutWrite).not.toHaveBeenCalled()
    expect(deliverBatch).not.toHaveBeenCalled()
    expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('[clipulse-gemini] invalid_hook_input'))
    expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('field="session_id"'))
  })

  it('exits non-zero when required Gemini hook fields are missing at the CLI entrypoint', async () => {
    const stdoutWrite = vi.fn()
    const stderrWrite = vi.fn()
    const exit = vi.fn()

    await expect(runGeminiCliEntrypoint({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: '/tmp/clipulse-gemini-state',
      },
      readStdin: async () => JSON.stringify({
        session_id: '',
        cwd: '/workspace/demo',
        hook_event_name: 'BeforeAgent',
      }),
      stderr: {
        write: stderrWrite,
      },
      stdout: {
        write: stdoutWrite,
      },
      exit,
    })).resolves.toBeUndefined()

    expect(stdoutWrite).not.toHaveBeenCalled()
    expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('[clipulse-gemini] invalid_hook_input'))
    expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('field="session_id"'))
    expect(exit).toHaveBeenCalledWith(1)
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
        CLIPULSE_API_BEARER_TOKEN: 'gemini-token',
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
        apiBearerToken: 'gemini-token',
        stateDir: '/tmp/clipulse-gemini-state',
      }),
    )
  })

  it('cleans Gemini session timing state after delivery failures so later hooks do not inherit stale waits', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-cli-project-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-gemini-cli-state-'))
    tempDirs.push(projectRoot, stateDir)

    await expect(runGeminiCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'gemini-session',
        cwd: projectRoot,
        hook_event_name: 'BeforeTool',
        model: 'gemini-2.5-pro',
        timestamp: '2026-04-10T02:30:00Z',
      }),
      deliverBatch: vi.fn().mockRejectedValue(new Error('offline')),
      stdout: {
        write: vi.fn(),
      },
    })).rejects.toThrow('offline')

    const deliverBatch = vi.fn().mockResolvedValue({
      delivered: true,
      buffered: false,
      flushed: 0,
    })

    await runGeminiCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'gemini-session',
        cwd: projectRoot,
        hook_event_name: 'SessionEnd',
        model: 'gemini-2.5-pro',
        timestamp: '2026-04-10T02:30:10Z',
      }),
      deliverBatch,
      stdout: {
        write: vi.fn(),
      },
    })

    expect(deliverBatch).toHaveBeenCalledWith(
      'http://localhost:8000',
      {
        events: [
          expect.objectContaining({
            event_name: 'session_end',
            active_ms: 0,
            wait_ms: 0,
          }),
        ],
      },
      expect.objectContaining({
        stateDir,
      }),
    )
    await expect(fs.readdir(path.join(stateDir, 'sessions'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('keeps stdout-mode tool wait timing retry-safe until the batch is handed off', async () => {
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
        timestamp: '2026-04-10T02:40:00Z',
      }),
      stdout: {
        write: vi.fn(),
      },
    })

    await expect(runGeminiCli({
      env: {
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'gemini-session',
        cwd: projectRoot,
        hook_event_name: 'AfterTool',
        model: 'gemini-2.5-pro',
        timestamp: '2026-04-10T02:40:05Z',
      }),
      stdout: {
        write: vi.fn(() => {
          throw new Error('stdout offline')
        }),
      },
    })).rejects.toThrow('stdout offline')

    const retryStdoutWrite = vi.fn()
    await runGeminiCli({
      env: {
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'gemini-session',
        cwd: projectRoot,
        hook_event_name: 'AfterTool',
        model: 'gemini-2.5-pro',
        timestamp: '2026-04-10T02:40:05Z',
      }),
      stdout: {
        write: retryStdoutWrite,
      },
    })

    const retryBatch = JSON.parse(String(retryStdoutWrite.mock.calls[0]?.[0]))
    expect(retryBatch.events[0].event_name).toBe('post_tool_use')
    expect(retryBatch.events[0].wait_ms).toBe(5_000)
  })

  it('converts top-level CLI failures into a controlled stderr message and exit code', async () => {
    const stderrWrite = vi.fn()
    const exit = vi.fn()

    await expect(runGeminiCliEntrypoint({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: '/tmp/clipulse-gemini-state',
      },
      readStdin: async () => JSON.stringify({
        session_id: 'gemini-session',
        cwd: '/workspace/demo',
        hook_event_name: 'BeforeAgent',
        timestamp: '2026-04-10T02:50:00Z',
      }),
      deliverBatch: vi.fn().mockRejectedValue(new Error('network down')),
      stderr: {
        write: stderrWrite,
      },
      exit,
    })).resolves.toBeUndefined()

    expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('[clipulse-gemini] fatal_error'))
    expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('network down'))
    expect(exit).toHaveBeenCalledWith(1)
  })
})
