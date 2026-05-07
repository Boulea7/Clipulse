import fs from 'node:fs/promises'
import { mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createFileFingerprint } from '@clipulse/collector-core'

import { buildCodexHookEvent, normalizeCodexHookEvent } from '../src/index.js'
import { runCodexCli } from '../src/cli.js'

const tempDirs: string[] = []
const REPO_ROOT = path.resolve(import.meta.dirname, '../../..')
const CODEX_SMOKE_FIXTURE_DIR = path.resolve(import.meta.dirname, '../examples/smoke')
const CODEX_DIST_CLI_PATH = path.resolve(import.meta.dirname, '../dist/cli.js')

interface CodexSmokeFixture {
  session_id: string
  cwd: string
  hook_event_name: string
  model: string
  event_time: string
  tool_name?: string
  tool_input?: {
    command?: string
  }
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true })
    }),
  )
})

async function readCodexSmokeFixture(name: string): Promise<CodexSmokeFixture> {
  const fixturePath = path.join(CODEX_SMOKE_FIXTURE_DIR, name)
  return JSON.parse(await fs.readFile(fixturePath, 'utf-8')) as CodexSmokeFixture
}

function runCodexCliProcess(
  rawInput: string,
  options: {
    env?: NodeJS.ProcessEnv
  } = {},
) {
  const stateDir = mkdtempSync(path.join(os.tmpdir(), 'clipulse-codex-cli-state-'))
  tempDirs.push(stateDir)

  return spawnSync('node', [CODEX_DIST_CLI_PATH], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      CLIPULSE_STATE_DIR: stateDir,
      ...options.env,
    },
    input: rawInput,
    encoding: 'utf8',
  })
}

async function createPendingCodexToolScenario({
  prefix,
  sessionId,
  finalHookEventName,
  finalEventTime,
}: {
  prefix: string
  sessionId: string
  finalHookEventName: 'PostToolUseFailure' | 'StopFailure' | 'SessionEnd'
  finalEventTime: string
}) {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-project-`))
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-state-`))
  tempDirs.push(projectRoot, stateDir)

  const appFile = path.join(projectRoot, 'src', 'app.ts')
  await fs.mkdir(path.dirname(appFile), { recursive: true })
  await fs.writeFile(appFile, 'export const value = 1;\n', 'utf-8')

  await buildCodexHookEvent({
    session_id: sessionId,
    cwd: projectRoot,
    hook_event_name: 'SessionStart',
    model: 'gpt-5.4',
    event_time: '2026-04-13T02:00:00.000Z',
  }, {
    stateDir,
  })

  await buildCodexHookEvent({
    session_id: sessionId,
    cwd: projectRoot,
    hook_event_name: 'PreToolUse',
    model: 'gpt-5.4',
    event_time: '2026-04-13T02:00:02.000Z',
    tool_name: 'Bash',
    tool_input: {
      command: 'git add src/app.ts',
    },
  }, {
    stateDir,
  })

  await fs.writeFile(appFile, 'export const value = 1;\nexport const next = 2;\n', 'utf-8')

  return {
    projectRoot,
    stateDir,
    rawInput: JSON.stringify({
      session_id: sessionId,
      cwd: projectRoot,
      hook_event_name: finalHookEventName,
      model: 'gpt-5.4',
      event_time: finalEventTime,
      tool_name: 'Bash',
      tool_input: {
        command: 'git add src/app.ts',
      },
    }),
  }
}

async function readTerminalFinalizerFiles(stateDir: string): Promise<string[]> {
  try {
    return (await fs.readdir(path.join(stateDir, 'terminal-finalizers'))).sort()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }

  return []
}

describe('adapter-codex', () => {
  it('keeps the example hooks aligned with cleanup support, including SessionEnd', () => {
    const hooksPath = path.resolve(import.meta.dirname, '../examples/hooks.json')
    const hooksJson = JSON.parse(readFileSync(hooksPath, 'utf-8')) as {
      hooks?: Record<string, unknown>
    }

    expect(hooksJson.hooks).toEqual(expect.objectContaining({
      SessionStart: expect.any(Array),
      UserPromptSubmit: expect.any(Array),
      PreToolUse: expect.any(Array),
      PostToolUse: expect.any(Array),
      PostToolUseFailure: expect.any(Array),
      Stop: expect.any(Array),
      StopFailure: expect.any(Array),
      SessionEnd: expect.any(Array),
    }))
  })

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
        CLIPULSE_API_BEARER_TOKEN: 'stable-codex-token',
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
        apiBearerToken: 'stable-codex-token',
        stateDir: '/tmp/clipulse-state',
      }),
    )
  })

  it('trims surrounding whitespace from session_id before delivery', async () => {
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
        session_id: '  codex-session  ',
        cwd: '/workspace/demo',
        hook_event_name: 'SessionStart',
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
            session_id: 'codex-session',
          }),
        ],
      }),
      expect.any(Object),
    )
  })

  it('skips tracking when CLIPULSE_REQUIRE_PROJECT_FILE=1 and the project has no .clipulse-project', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-project-file-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-project-file-state-'))
    tempDirs.push(projectRoot, stateDir)
    const stdoutWrite = vi.fn()
    const deliverBatch = vi.fn()

    await fs.mkdir(path.join(projectRoot, '.git'), { recursive: true })
    await fs.writeFile(path.join(projectRoot, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf-8')

    await runCodexCli({
      env: {
        CLIPULSE_REQUIRE_PROJECT_FILE: '1',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'codex-session',
        cwd: projectRoot,
        hook_event_name: 'SessionStart',
        model: 'gpt-5.4',
      }),
      deliverBatch,
      stdout: {
        write: stdoutWrite,
      },
    })

    expect(stdoutWrite).not.toHaveBeenCalled()
    expect(deliverBatch).not.toHaveBeenCalled()
  })

  it('tracks projects with a .clipulse-project marker when CLIPULSE_REQUIRE_PROJECT_FILE=1', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-project-file-positive-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-project-file-positive-state-'))
    tempDirs.push(projectRoot, stateDir)
    const deliverBatch = vi.fn()

    await fs.mkdir(path.join(projectRoot, '.git'), { recursive: true })
    await fs.writeFile(path.join(projectRoot, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf-8')
    await fs.writeFile(path.join(projectRoot, '.clipulse-project'), 'project_name=Marked Codex\n', 'utf-8')

    await runCodexCli({
      env: {
        CLIPULSE_REQUIRE_PROJECT_FILE: '1',
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'codex-session',
        cwd: projectRoot,
        hook_event_name: 'SessionStart',
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
            project_name: 'Marked Codex',
          }),
        ],
      }),
      expect.objectContaining({
        stateDir,
      }),
    )
  })

  it('rejects invalid JSON stdin without writing stdout', async () => {
    const stdoutWrite = vi.fn()

    await expect(runCodexCli({
      readStdin: async () => '{',
      stdout: {
        write: stdoutWrite,
      },
    })).rejects.toThrow('Invalid Codex hook JSON on stdin.')

    expect(stdoutWrite).not.toHaveBeenCalled()
  })

  it('rejects hook payloads missing required fields without writing stdout', async () => {
    const stdoutWrite = vi.fn()

    await expect(runCodexCli({
      readStdin: async () => JSON.stringify({
        session_id: 'codex-session',
        hook_event_name: 'PostToolUse',
      }),
      stdout: {
        write: stdoutWrite,
      },
    })).rejects.toThrow('Invalid Codex hook payload: expected non-empty string "cwd".')

    expect(stdoutWrite).not.toHaveBeenCalled()
  })

  it('retries the same post_tool_use_failure with the original wait gap and file delta after delivery fails', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-retry-post-failure-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-retry-post-failure-state-'))
    tempDirs.push(projectRoot, stateDir)

    const appFile = path.join(projectRoot, 'src', 'app.ts')
    await fs.mkdir(path.dirname(appFile), { recursive: true })
    await fs.writeFile(appFile, 'export const value = 1;\n', 'utf-8')

    await buildCodexHookEvent({
      session_id: 'codex-retry-post-failure-session',
      cwd: projectRoot,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-13T01:00:00.000Z',
    }, {
      stateDir,
    })

    await buildCodexHookEvent({
      session_id: 'codex-retry-post-failure-session',
      cwd: projectRoot,
      hook_event_name: 'PreToolUse',
      model: 'gpt-5.4',
      event_time: '2026-04-13T01:00:02.000Z',
      tool_name: 'Bash',
      tool_input: {
        command: 'git add src/app.ts',
      },
    }, {
      stateDir,
    })

    await fs.writeFile(appFile, 'export const value = 1;\nexport const next = 2;\n', 'utf-8')

    const rawInput = JSON.stringify({
      session_id: 'codex-retry-post-failure-session',
      cwd: projectRoot,
      hook_event_name: 'PostToolUseFailure',
      model: 'gpt-5.4',
      event_time: '2026-04-13T01:00:07.000Z',
      tool_name: 'Bash',
      tool_input: {
        command: 'git add src/app.ts',
      },
    })

    await expect(runCodexCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => rawInput,
      deliverBatch: vi.fn().mockRejectedValue(new Error('offline')),
      stdout: {
        write: vi.fn(),
      },
    })).rejects.toThrow('offline')

    const retryDeliverBatch = vi.fn().mockResolvedValue({
      delivered: true,
      buffered: false,
      flushed: 0,
    })

    await runCodexCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => rawInput,
      deliverBatch: retryDeliverBatch,
      stdout: {
        write: vi.fn(),
      },
    })

    expect(retryDeliverBatch).toHaveBeenCalledTimes(1)
    expect(retryDeliverBatch.mock.calls[0]?.[1]).toEqual({
      events: [
        expect.objectContaining({
          wait_ms: 5_000,
          language_stats: {
            TypeScript: expect.objectContaining({ changed: 1 }),
          },
          file_deltas: [
            expect.objectContaining({
              language: 'TypeScript',
              added: 1,
              removed: 0,
            }),
          ],
        }),
      ],
    })
  })

  it('retries the same post_tool_use_failure in stdout mode with the original wait gap and file delta after stdout emission fails', async () => {
    const { rawInput, stateDir } = await createPendingCodexToolScenario({
      prefix: 'clipulse-codex-stdout-post-failure',
      sessionId: 'codex-stdout-post-failure-session',
      finalHookEventName: 'PostToolUseFailure',
      finalEventTime: '2026-04-13T02:00:07.000Z',
    })

    await expect(runCodexCli({
      env: {
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => rawInput,
      stdout: {
        write: vi.fn(() => {
          throw new Error('stdout offline')
        }),
      },
    })).rejects.toThrow('stdout offline')

    await expect(fs.readdir(path.join(stateDir, 'sessions'))).resolves.not.toEqual([])
    await expect(fs.readdir(path.join(stateDir, 'snapshots'))).resolves.not.toEqual([])

    const stdoutWrite = vi.fn()
    await runCodexCli({
      env: {
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => rawInput,
      stdout: {
        write: stdoutWrite,
      },
    })

    expect(stdoutWrite).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(stdoutWrite.mock.calls[0]?.[0]).trim())).toEqual({
      events: [
        expect.objectContaining({
          event_name: 'post_tool_use_failure',
          wait_ms: 5_000,
          language_stats: {
            TypeScript: expect.objectContaining({ changed: 1 }),
          },
          file_deltas: [
            expect.objectContaining({
              language: 'TypeScript',
              added: 1,
              removed: 0,
            }),
          ],
        }),
      ],
    })
  })

  it('keeps teardown state until stop_failure delivery succeeds', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-retry-stop-failure-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-retry-stop-failure-state-'))
    tempDirs.push(projectRoot, stateDir)

    const appFile = path.join(projectRoot, 'src', 'app.ts')
    await fs.mkdir(path.dirname(appFile), { recursive: true })
    await fs.writeFile(appFile, 'export const value = 1;\n', 'utf-8')

    await buildCodexHookEvent({
      session_id: 'codex-retry-stop-failure-session',
      cwd: projectRoot,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-13T01:10:00.000Z',
    }, {
      stateDir,
    })

    await buildCodexHookEvent({
      session_id: 'codex-retry-stop-failure-session',
      cwd: projectRoot,
      hook_event_name: 'PreToolUse',
      model: 'gpt-5.4',
      event_time: '2026-04-13T01:10:02.000Z',
      tool_name: 'Bash',
      tool_input: {
        command: 'git add src/app.ts',
      },
    }, {
      stateDir,
    })

    await fs.writeFile(appFile, 'export const value = 1;\nexport const next = 2;\n', 'utf-8')

    const rawInput = JSON.stringify({
      session_id: 'codex-retry-stop-failure-session',
      cwd: projectRoot,
      hook_event_name: 'StopFailure',
      model: 'gpt-5.4',
      event_time: '2026-04-13T01:10:07.000Z',
      tool_name: 'Bash',
      tool_input: {
        command: 'git add src/app.ts',
      },
    })

    await expect(runCodexCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => rawInput,
      deliverBatch: vi.fn().mockRejectedValue(new Error('offline')),
      stdout: {
        write: vi.fn(),
      },
    })).rejects.toThrow('offline')

    await expect(readTerminalFinalizerFiles(stateDir)).resolves.toEqual([])
    await expect(fs.readdir(path.join(stateDir, 'sessions'))).resolves.not.toEqual([])
    await expect(fs.readdir(path.join(stateDir, 'snapshots'))).resolves.not.toEqual([])

    const retryDeliverBatch = vi.fn().mockResolvedValue({
      delivered: true,
      buffered: false,
      flushed: 0,
    })

    await runCodexCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => rawInput,
      deliverBatch: retryDeliverBatch,
      stdout: {
        write: vi.fn(),
      },
    })

    expect(retryDeliverBatch).toHaveBeenCalledTimes(1)
    expect(retryDeliverBatch.mock.calls[0]?.[1]).toEqual({
      events: [
        expect.objectContaining({
          wait_ms: 5_000,
          file_deltas: [
            expect.objectContaining({
              language: 'TypeScript',
              added: 1,
              removed: 0,
            }),
          ],
        }),
      ],
    })
    await expect(fs.readdir(path.join(stateDir, 'sessions'))).resolves.toEqual([])
    await expect(fs.readdir(path.join(stateDir, 'snapshots'))).resolves.toEqual([])
  })

  it('does not re-emit an older stop_failure retry after session_end commits', async () => {
    const { projectRoot, rawInput: stopFailureInput, stateDir } = await createPendingCodexToolScenario({
      prefix: 'clipulse-codex-terminal-retry-order',
      sessionId: 'codex-terminal-retry-order-session',
      finalHookEventName: 'StopFailure',
      finalEventTime: '2026-04-13T02:00:07.000Z',
    })

    await expect(runCodexCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => stopFailureInput,
      deliverBatch: vi.fn().mockRejectedValue(new Error('offline')),
      stdout: {
        write: vi.fn(),
      },
    })).rejects.toThrow('offline')

    const sessionEndDeliverBatch = vi.fn().mockResolvedValue({
      delivered: true,
      buffered: false,
      flushed: 0,
    })
    const sessionEndInput = JSON.stringify({
      session_id: 'codex-terminal-retry-order-session',
      cwd: projectRoot,
      hook_event_name: 'SessionEnd',
      model: 'gpt-5.4',
      event_time: '2026-04-13T02:00:08.000Z',
    })

    await runCodexCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => sessionEndInput,
      deliverBatch: sessionEndDeliverBatch,
      stdout: {
        write: vi.fn(),
      },
    })

    expect(sessionEndDeliverBatch).toHaveBeenCalledTimes(1)
    await expect(readTerminalFinalizerFiles(stateDir)).resolves.toHaveLength(1)
    expect(sessionEndDeliverBatch.mock.calls[0]?.[1]).toEqual({
      events: [
        expect.objectContaining({
          event_name: 'session_end',
          wait_ms: 6_000,
        }),
      ],
    })

    const stopFailureRetryDeliverBatch = vi.fn()

    await runCodexCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => stopFailureInput,
      deliverBatch: stopFailureRetryDeliverBatch,
      stdout: {
        write: vi.fn(),
      },
    })

    expect(stopFailureRetryDeliverBatch).not.toHaveBeenCalled()
  })

  it('emits session_end when it ties a previously finalized stop_failure timestamp', async () => {
    const { projectRoot, rawInput: stopFailureInput, stateDir } = await createPendingCodexToolScenario({
      prefix: 'clipulse-codex-terminal-equal-time',
      sessionId: 'codex-terminal-equal-time-session',
      finalHookEventName: 'StopFailure',
      finalEventTime: '2026-04-13T02:00:07.000Z',
    })

    const stopFailureDeliverBatch = vi.fn().mockResolvedValue({
      delivered: true,
      buffered: false,
      flushed: 0,
    })
    await runCodexCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => stopFailureInput,
      deliverBatch: stopFailureDeliverBatch,
      stdout: {
        write: vi.fn(),
      },
    })

    expect(stopFailureDeliverBatch).toHaveBeenCalledTimes(1)

    const sessionEndDeliverBatch = vi.fn().mockResolvedValue({
      delivered: true,
      buffered: false,
      flushed: 0,
    })
    const sessionEndInput = JSON.stringify({
      session_id: 'codex-terminal-equal-time-session',
      cwd: projectRoot,
      hook_event_name: 'SessionEnd',
      model: 'gpt-5.4',
      event_time: '2026-04-13T02:00:07.000Z',
    })

    await runCodexCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => sessionEndInput,
      deliverBatch: sessionEndDeliverBatch,
      stdout: {
        write: vi.fn(),
      },
    })

    expect(sessionEndDeliverBatch).toHaveBeenCalledTimes(1)
    expect(sessionEndDeliverBatch.mock.calls[0]?.[1]).toEqual({
      events: [
        expect.objectContaining({
          event_name: 'session_end',
        }),
      ],
    })

    const markerFiles = await readTerminalFinalizerFiles(stateDir)
    expect(markerFiles).toHaveLength(1)
    const marker = JSON.parse(await fs.readFile(
      path.join(stateDir, 'terminal-finalizers', markerFiles[0] ?? ''),
      'utf-8',
    ))
    expect(marker.eventName).toBe('session_end')
  })

  it('emits session_end when it ties a previously finalized stop timestamp', async () => {
    const { projectRoot, rawInput: stopInput, stateDir } = await createPendingCodexToolScenario({
      prefix: 'clipulse-codex-terminal-equal-stop-time',
      sessionId: 'codex-terminal-equal-stop-time-session',
      finalHookEventName: 'Stop',
      finalEventTime: '2026-04-13T02:00:07.000Z',
    })

    const stopDeliverBatch = vi.fn().mockResolvedValue({
      delivered: true,
      buffered: false,
      flushed: 0,
    })
    await runCodexCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => stopInput,
      deliverBatch: stopDeliverBatch,
      stdout: {
        write: vi.fn(),
      },
    })

    expect(stopDeliverBatch).toHaveBeenCalledTimes(1)

    const sessionEndDeliverBatch = vi.fn().mockResolvedValue({
      delivered: true,
      buffered: false,
      flushed: 0,
    })
    const sessionEndInput = JSON.stringify({
      session_id: 'codex-terminal-equal-stop-time-session',
      cwd: projectRoot,
      hook_event_name: 'SessionEnd',
      model: 'gpt-5.4',
      event_time: '2026-04-13T02:00:07.000Z',
    })

    await runCodexCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => sessionEndInput,
      deliverBatch: sessionEndDeliverBatch,
      stdout: {
        write: vi.fn(),
      },
    })

    expect(sessionEndDeliverBatch).toHaveBeenCalledTimes(1)
    expect(sessionEndDeliverBatch.mock.calls[0]?.[1]).toEqual({
      events: [
        expect.objectContaining({
          event_name: 'session_end',
        }),
      ],
    })
  })

  it('serializes concurrent terminal retries so older stop_failure waits for session_end finalization', async () => {
    const { projectRoot, rawInput: stopFailureInput, stateDir } = await createPendingCodexToolScenario({
      prefix: 'clipulse-codex-terminal-concurrent-retry-order',
      sessionId: 'codex-terminal-concurrent-retry-order-session',
      finalHookEventName: 'StopFailure',
      finalEventTime: '2026-04-13T02:00:07.000Z',
    })
    let releaseSessionEndDelivery: (() => void) | null = null
    let markSessionEndDeliveryStarted: () => void
    const sessionEndDeliveryStarted = new Promise<void>((resolve) => {
      markSessionEndDeliveryStarted = resolve
    })
    const sessionEndDeliverBatch = vi.fn().mockImplementation(async () => {
      markSessionEndDeliveryStarted()
      await new Promise<void>((deliveryResolve) => {
        releaseSessionEndDelivery = deliveryResolve
      })
      return {
        delivered: true,
        buffered: false,
        flushed: 0,
      }
    })
    const sessionEndRun = runCodexCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'codex-terminal-concurrent-retry-order-session',
        cwd: projectRoot,
        hook_event_name: 'SessionEnd',
        model: 'gpt-5.4',
        event_time: '2026-04-13T02:00:08.000Z',
      }),
      deliverBatch: sessionEndDeliverBatch,
      stdout: {
        write: vi.fn(),
      },
    })
    await sessionEndDeliveryStarted

    const stopFailureRetryDeliverBatch = vi.fn()
    const stopFailureRetry = runCodexCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => stopFailureInput,
      deliverBatch: stopFailureRetryDeliverBatch,
      stdout: {
        write: vi.fn(),
      },
    })

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(stopFailureRetryDeliverBatch).not.toHaveBeenCalled()

    releaseSessionEndDelivery?.()
    await sessionEndRun
    await stopFailureRetry

    expect(stopFailureRetryDeliverBatch).not.toHaveBeenCalled()
  })

  it('does not write an older stop_failure stdout retry after session_end commits', async () => {
    const { projectRoot, rawInput: stopFailureInput, stateDir } = await createPendingCodexToolScenario({
      prefix: 'clipulse-codex-terminal-stdout-retry-order',
      sessionId: 'codex-terminal-stdout-retry-order-session',
      finalHookEventName: 'StopFailure',
      finalEventTime: '2026-04-13T02:00:07.000Z',
    })

    await expect(runCodexCli({
      env: {
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => stopFailureInput,
      stdout: {
        write: vi.fn(() => {
          throw new Error('stdout offline')
        }),
      },
    })).rejects.toThrow('stdout offline')

    await expect(readTerminalFinalizerFiles(stateDir)).resolves.toEqual([])
    const sessionEndStdoutWrite = vi.fn()
    const sessionEndInput = JSON.stringify({
      session_id: 'codex-terminal-stdout-retry-order-session',
      cwd: projectRoot,
      hook_event_name: 'SessionEnd',
      model: 'gpt-5.4',
      event_time: '2026-04-13T02:00:08.000Z',
    })

    await runCodexCli({
      env: {
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => sessionEndInput,
      stdout: {
        write: sessionEndStdoutWrite,
      },
    })

    expect(sessionEndStdoutWrite).toHaveBeenCalledTimes(1)
    await expect(readTerminalFinalizerFiles(stateDir)).resolves.toHaveLength(1)
    expect(JSON.parse(String(sessionEndStdoutWrite.mock.calls[0]?.[0]).trim())).toEqual({
      events: [
        expect.objectContaining({
          event_name: 'session_end',
          wait_ms: 6_000,
        }),
      ],
    })

    const stopFailureRetryStdoutWrite = vi.fn()

    await runCodexCli({
      env: {
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => stopFailureInput,
      stdout: {
        write: stopFailureRetryStdoutWrite,
      },
    })

    expect(stopFailureRetryStdoutWrite).not.toHaveBeenCalled()
  })

  it('emits and rewrites terminal finalizer state when the marker is corrupted', async () => {
    const { projectRoot, rawInput: sessionEndInput, stateDir } = await createPendingCodexToolScenario({
      prefix: 'clipulse-codex-terminal-corrupt-marker',
      sessionId: 'codex-terminal-corrupt-marker-session',
      finalHookEventName: 'SessionEnd',
      finalEventTime: '2026-04-13T02:00:07.000Z',
    })
    const firstStdoutWrite = vi.fn()

    await runCodexCli({
      env: {
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => sessionEndInput,
      stdout: {
        write: firstStdoutWrite,
      },
    })

    const markerFiles = await readTerminalFinalizerFiles(stateDir)
    expect(markerFiles).toHaveLength(1)
    const markerPath = path.join(stateDir, 'terminal-finalizers', markerFiles[0]!)
    await fs.writeFile(markerPath, '{', 'utf-8')

    const secondStdoutWrite = vi.fn()
    await runCodexCli({
      env: {
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'codex-terminal-corrupt-marker-session',
        cwd: projectRoot,
        hook_event_name: 'SessionEnd',
        model: 'gpt-5.4',
        event_time: '2026-04-13T02:00:08.000Z',
      }),
      stdout: {
        write: secondStdoutWrite,
      },
    })

    expect(secondStdoutWrite).toHaveBeenCalledTimes(1)
    const rewrittenMarker = JSON.parse(await fs.readFile(markerPath, 'utf-8')) as {
      eventTime?: string
    }
    expect(rewrittenMarker.eventTime).toBe('2026-04-13T02:00:08.000Z')
  })

  it.each([
    {
      hookEventName: 'StopFailure' as const,
      eventName: 'stop_failure',
      finalEventTime: '2026-04-13T02:00:07.000Z',
    },
    {
      hookEventName: 'SessionEnd' as const,
      eventName: 'session_end',
      finalEventTime: '2026-04-13T02:00:07.000Z',
    },
  ])(
    'keeps teardown state until $hookEventName stdout emission succeeds',
    async ({ hookEventName, eventName, finalEventTime }) => {
      const { rawInput, stateDir } = await createPendingCodexToolScenario({
        prefix: `clipulse-codex-stdout-${eventName}`,
        sessionId: `codex-stdout-${eventName}-session`,
        finalHookEventName: hookEventName,
        finalEventTime,
      })

      await expect(runCodexCli({
        env: {
          CLIPULSE_STATE_DIR: stateDir,
        },
        readStdin: async () => rawInput,
        stdout: {
          write: vi.fn(() => {
            throw new Error('stdout offline')
          }),
        },
      })).rejects.toThrow('stdout offline')

      await expect(fs.readdir(path.join(stateDir, 'sessions'))).resolves.not.toEqual([])
      await expect(fs.readdir(path.join(stateDir, 'snapshots'))).resolves.not.toEqual([])

      const stdoutWrite = vi.fn()
      await runCodexCli({
        env: {
          CLIPULSE_STATE_DIR: stateDir,
        },
        readStdin: async () => rawInput,
        stdout: {
          write: stdoutWrite,
        },
      })

      expect(stdoutWrite).toHaveBeenCalledTimes(1)
      expect(JSON.parse(String(stdoutWrite.mock.calls[0]?.[0]).trim())).toEqual({
        events: [
          expect.objectContaining({
            event_name: eventName,
            wait_ms: 5_000,
            file_deltas: [
              expect.objectContaining({
                language: 'TypeScript',
                added: 1,
                removed: 0,
              }),
            ],
          }),
        ],
      })
      await expect(fs.readdir(path.join(stateDir, 'sessions'))).resolves.toEqual([])
      await expect(fs.readdir(path.join(stateDir, 'snapshots'))).resolves.toEqual([])
    },
  )

  it('keeps checked-in Codex smoke fixtures aligned with the canonical wiring and failure-path contract', async () => {
    const hooksPath = path.resolve(import.meta.dirname, '../examples/hooks.json')
    const hooksJson = JSON.parse(readFileSync(hooksPath, 'utf-8')) as {
      hooks?: Record<string, unknown>
    }
    const sessionStart = await readCodexSmokeFixture('session-start.json')
    const preToolUse = await readCodexSmokeFixture('pre-tool-use.json')
    const postToolUseFailure = await readCodexSmokeFixture('post-tool-use-failure.json')
    const stopFailure = await readCodexSmokeFixture('stop-failure.json')
    const sessionEnd = await readCodexSmokeFixture('session-end.json')

    expect(sessionStart.session_id).toBe('codex-smoke-session')
    expect(preToolUse.session_id).toBe('codex-smoke-session')
    expect(postToolUseFailure.session_id).toBe('codex-smoke-session')
    expect(stopFailure.session_id).toBe('codex-smoke-session')
    expect(sessionEnd.session_id).toBe('codex-smoke-session')
    expect(sessionStart.cwd).toBe('__CODEX_SMOKE_PROJECT_ROOT__')
    expect(preToolUse.cwd).toBe('__CODEX_SMOKE_PROJECT_ROOT__')
    expect(postToolUseFailure.cwd).toBe('__CODEX_SMOKE_PROJECT_ROOT__')
    expect(stopFailure.cwd).toBe('__CODEX_SMOKE_PROJECT_ROOT__')
    expect(sessionEnd.cwd).toBe('__CODEX_SMOKE_PROJECT_ROOT__')

    expect(sessionStart.hook_event_name).toBe('SessionStart')
    expect(preToolUse.hook_event_name).toBe('PreToolUse')
    expect(postToolUseFailure.hook_event_name).toBe('PostToolUseFailure')
    expect(stopFailure.hook_event_name).toBe('StopFailure')
    expect(sessionEnd.hook_event_name).toBe('SessionEnd')
    expect(Object.keys(hooksJson.hooks ?? {})).toEqual(expect.arrayContaining([
      sessionStart.hook_event_name,
      preToolUse.hook_event_name,
      postToolUseFailure.hook_event_name,
      stopFailure.hook_event_name,
      sessionEnd.hook_event_name,
    ]))

    expect(preToolUse.tool_name).toBe('Bash')
    expect(postToolUseFailure.tool_name).toBe('Bash')
    expect(stopFailure.tool_name).toBe('Bash')
    expect(preToolUse.tool_input?.command).toBe('git add src/smoke.ts')
    expect(postToolUseFailure.tool_input?.command).toBe('git add src/smoke.ts')
    expect(stopFailure.tool_input?.command).toBe('git add src/smoke.ts')
    expect(postToolUseFailure.event_time).toBe('2026-04-10T04:00:07.000Z')
    expect(stopFailure.event_time).toBe('2026-04-10T04:00:08.000Z')
    expect(sessionEnd.event_time).toBe('2026-04-10T04:00:09.000Z')
  })

  it('locks the canonical Codex smoke script stdout contract to the checked-in stateful fixture flow through teardown', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-smoke-'))
    tempDirs.push(tempRoot)

    const projectRoot = path.join(tempRoot, 'demo')
    const stateDir = path.join(tempRoot, 'state')

    const result = spawnSync('node', ['scripts/smoke-codex.mjs'], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        CLIPULSE_CODEX_SMOKE_PROJECT_ROOT: projectRoot,
        CLIPULSE_STATE_DIR: stateDir,
      },
      encoding: 'utf8',
    })

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    const payloads = result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as { events: Array<Record<string, unknown>> })

    expect(payloads).toHaveLength(5)
    expect(payloads.map((payload) => payload.events[0]?.event_name)).toEqual([
      'session_start',
      'pre_tool_use',
      'post_tool_use_failure',
      'stop_failure',
      'session_end',
    ])
    expect(payloads[2]?.events[0]).toEqual(expect.objectContaining({
      wait_ms: 5_000,
      file_deltas: [{
        fingerprint: createFileFingerprint(path.join(projectRoot, 'src', 'smoke.ts'), projectRoot),
        language: 'TypeScript',
        added: 1,
        removed: 0,
      }],
    }))
    expect(payloads[3]?.events[0]).toEqual(expect.objectContaining({
      event_name: 'stop_failure',
      file_deltas: [],
    }))
    expect(payloads[4]?.events[0]).toEqual(expect.objectContaining({
      event_name: 'session_end',
      file_deltas: [],
    }))
    await expect(fs.readdir(path.join(stateDir, 'sessions'))).resolves.toEqual([])
    await expect(fs.readdir(path.join(stateDir, 'snapshots'))).resolves.toEqual([])
  })

  it('keeps direct CLI success output machine-readable', () => {
    const result = runCodexCliProcess(JSON.stringify({
      session_id: 'codex-process-session',
      cwd: REPO_ROOT,
      hook_event_name: 'UserPromptSubmit',
      model: 'gpt-5.4',
      event_time: '2026-04-13T00:00:00Z',
    }))

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    const outputLines = result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)

    expect(outputLines).toHaveLength(1)
    expect(JSON.parse(outputLines[0] ?? 'null')).toEqual(expect.objectContaining({
      events: [
        expect.objectContaining({
          host: 'codex',
          session_id: 'codex-process-session',
          event_name: 'user_prompt_submit',
        }),
      ],
    }))
  })

  it.each([
    {
      name: 'rejects malformed JSON input',
      rawInput: '{"session_id":"broken"',
      stderrSubstring: 'Invalid Codex hook JSON on stdin.',
    },
    {
      name: 'rejects missing session_id',
      rawInput: JSON.stringify({
        cwd: '/workspace/demo',
        hook_event_name: 'UserPromptSubmit',
      }),
      stderrSubstring: 'expected non-empty string "session_id"',
    },
    {
      name: 'rejects missing cwd',
      rawInput: JSON.stringify({
        session_id: 'codex-session',
        hook_event_name: 'UserPromptSubmit',
      }),
      stderrSubstring: 'expected non-empty string "cwd"',
    },
    {
      name: 'rejects missing hook_event_name',
      rawInput: JSON.stringify({
        session_id: 'codex-session',
        cwd: '/workspace/demo',
      }),
      stderrSubstring: 'expected non-empty string "hook_event_name"',
    },
  ])('$name', ({ rawInput, stderrSubstring }) => {
    const result = runCodexCliProcess(rawInput)

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain(stderrSubstring)
  })


  it('keeps a prompt-only user submit event with project context and zero deltas', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-prompt-only-'))
    tempDirs.push(projectRoot)

    await fs.writeFile(path.join(projectRoot, 'README.md'), '# Demo\n', 'utf-8')

    const stdoutWrite = vi.fn()

    await runCodexCli({
      env: {
        CLIPULSE_STATE_DIR: path.join(projectRoot, '.state'),
      },
      readStdin: async () => JSON.stringify({
        session_id: 'codex-prompt-only-session',
        cwd: projectRoot,
        hook_event_name: 'UserPromptSubmit',
        model: 'gpt-5.4',
        event_time: '2026-04-09T08:00:00.000Z',
      }),
      stdout: {
        write: stdoutWrite,
      },
    })

    expect(stdoutWrite).toHaveBeenCalledTimes(1)
    const output = String(stdoutWrite.mock.calls[0]?.[0])
    expect(output).toContain('"event_name":"user_prompt_submit"')
    expect(output).toContain('"file_deltas":[]')
    expect(output).toContain('"event_id":"')
    expect(output).not.toContain(`"project_root":"${projectRoot}"`)
    expect(output).toContain(`"project_name":"${path.basename(projectRoot)}"`)
  })

  it('finalizes wait_ms on post_tool_use_failure without widening bash heuristics', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-post-failure-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-post-failure-state-'))
    tempDirs.push(projectRoot, stateDir)

    const appFile = path.join(projectRoot, 'src', 'app.ts')
    const readmeFile = path.join(projectRoot, 'README.md')
    await fs.mkdir(path.dirname(appFile), { recursive: true })
    await fs.writeFile(appFile, 'export const value = 1;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n', 'utf-8')

    await buildCodexHookEvent({
      session_id: 'codex-post-failure-session',
      cwd: projectRoot,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-09T09:00:00.000Z',
    }, {
      stateDir,
    })

    await buildCodexHookEvent({
      session_id: 'codex-post-failure-session',
      cwd: projectRoot,
      hook_event_name: 'PreToolUse',
      model: 'gpt-5.4',
      event_time: '2026-04-09T09:00:01.000Z',
      tool_name: 'Bash',
      tool_input: {
        command: 'git add src/app.ts',
      },
    }, {
      stateDir,
    })

    await fs.writeFile(appFile, 'export const value = 1;\nexport const next = 2;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n\nExtra line\n', 'utf-8')

    const event = await buildCodexHookEvent({
      session_id: 'codex-post-failure-session',
      cwd: projectRoot,
      hook_event_name: 'PostToolUseFailure',
      model: 'gpt-5.4',
      event_time: '2026-04-09T09:00:06.000Z',
      tool_name: 'Bash',
      tool_input: {
        command: 'git add src/app.ts',
      },
    }, {
      stateDir,
    })

    expect(event.wait_ms).toBe(5_000)
    expect(event.active_ms).toBe(0)
    expect(event.file_deltas).toEqual([
      expect.objectContaining({
        language: 'TypeScript',
        added: 1,
        removed: 0,
      }),
    ])
  })

  it('clears session and snapshot state on stop_failure after finalizing wait time', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-stop-failure-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-stop-failure-state-'))
    tempDirs.push(projectRoot, stateDir)

    const appFile = path.join(projectRoot, 'src', 'app.ts')
    await fs.mkdir(path.dirname(appFile), { recursive: true })
    await fs.writeFile(appFile, 'export const value = 1;\n', 'utf-8')

    await buildCodexHookEvent({
      session_id: 'codex-stop-failure-session',
      cwd: projectRoot,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-09T09:10:00.000Z',
    }, {
      stateDir,
    })

    await buildCodexHookEvent({
      session_id: 'codex-stop-failure-session',
      cwd: projectRoot,
      hook_event_name: 'PreToolUse',
      model: 'gpt-5.4',
      event_time: '2026-04-09T09:10:01.000Z',
    }, {
      stateDir,
    })

    await fs.writeFile(appFile, 'export const value = 1;\nexport const next = 2;\n', 'utf-8')

    const stopFailure = await buildCodexHookEvent({
      session_id: 'codex-stop-failure-session',
      cwd: projectRoot,
      hook_event_name: 'StopFailure',
      model: 'gpt-5.4',
      event_time: '2026-04-09T09:10:06.000Z',
      tool_name: 'Bash',
      tool_input: {
        command: 'git add src/app.ts',
      },
    }, {
      stateDir,
    })

    expect(stopFailure.wait_ms).toBe(5_000)
    await expect(fs.readdir(path.join(stateDir, 'snapshots'))).resolves.toEqual([])
    await expect(fs.readdir(path.join(stateDir, 'sessions'))).resolves.toEqual([])
  })

  it('clears lingering snapshot state on session_end without requiring a final tool event', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-session-end-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-session-end-state-'))
    tempDirs.push(projectRoot, stateDir)

    const appFile = path.join(projectRoot, 'src', 'app.ts')
    await fs.mkdir(path.dirname(appFile), { recursive: true })
    await fs.writeFile(appFile, 'export const value = 1;\n', 'utf-8')

    await buildCodexHookEvent({
      session_id: 'codex-session-end-session',
      cwd: projectRoot,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-09T09:20:00.000Z',
    }, {
      stateDir,
    })

    await fs.writeFile(appFile, 'export const value = 1;\nexport const next = 2;\n', 'utf-8')

    await buildCodexHookEvent({
      session_id: 'codex-session-end-session',
      cwd: projectRoot,
      hook_event_name: 'SessionEnd',
      model: 'gpt-5.4',
      event_time: '2026-04-09T09:20:05.000Z',
    }, {
      stateDir,
    })

    await expect(fs.readdir(path.join(stateDir, 'snapshots'))).resolves.toEqual([])
  })

  it('keeps prompt-only user submissions as project-scoped activity', async () => {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-prompt-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-prompt-state-'))
    tempDirs.push(sandboxRoot, stateDir)

    const repoRoot = path.join(sandboxRoot, 'Clipulse')
    const nestedCwd = path.join(repoRoot, '.worktrees', 'v1-alpha')
    await fs.mkdir(path.join(repoRoot, '.git'), { recursive: true })
    await fs.mkdir(nestedCwd, { recursive: true })
    await fs.writeFile(path.join(repoRoot, '.git', 'HEAD'), 'ref: refs/heads/feat/v1-alpha\n', 'utf-8')
    const canonicalRepoRoot = await fs.realpath(repoRoot)

    const event = await buildCodexHookEvent({
      session_id: 'codex-prompt-session',
      cwd: nestedCwd,
      hook_event_name: 'UserPromptSubmit',
      model: 'gpt-5.4',
      event_time: '2026-04-09T12:00:00.000Z',
    }, {
      stateDir,
    })

    expect(event.event_name).toBe('user_prompt_submit')
    expect(event.project_root).toBe(canonicalRepoRoot)
    expect(event.project_name).toBe('Clipulse')
    expect(event.git_branch).toBe('feat/v1-alpha')
    expect(event.file_deltas).toEqual([])
    expect(event.language_stats).toEqual({})
  })

  it('finalizes wait time on post_tool_use_failure and still captures snapshot deltas', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-post-tool-failure-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-post-tool-failure-state-'))
    tempDirs.push(projectRoot, stateDir)

    const appFile = path.join(projectRoot, 'src', 'app.ts')
    await fs.mkdir(path.dirname(appFile), { recursive: true })
    await fs.writeFile(appFile, 'export const value = 1;\n', 'utf-8')

    await buildCodexHookEvent({
      session_id: 'codex-post-tool-failure-session',
      cwd: projectRoot,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-09T12:00:00.000Z',
    }, {
      stateDir,
    })

    await buildCodexHookEvent({
      session_id: 'codex-post-tool-failure-session',
      cwd: projectRoot,
      hook_event_name: 'PreToolUse',
      model: 'gpt-5.4',
      event_time: '2026-04-09T12:00:02.000Z',
    }, {
      stateDir,
    })

    await fs.writeFile(appFile, 'export const value = 1;\nexport const next = 2;\n', 'utf-8')

    const event = await buildCodexHookEvent({
      session_id: 'codex-post-tool-failure-session',
      cwd: projectRoot,
      hook_event_name: 'PostToolUseFailure',
      model: 'gpt-5.4',
      event_time: '2026-04-09T12:00:07.000Z',
      tool_name: 'Bash',
      tool_input: {
        command: 'git add src/app.ts',
      },
    }, {
      stateDir,
    })

    expect(event.wait_ms).toBe(5_000)
    expect(event.file_deltas).toEqual([
      expect.objectContaining({
        language: 'TypeScript',
        added: 1,
        removed: 0,
      }),
    ])
  })

  it.each(['StopFailure', 'SessionEnd'])(
    'clears snapshots on %s after a pending tool wait',
    async (hookEventName) => {
      const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-stop-failure-'))
      const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-stop-failure-state-'))
      tempDirs.push(projectRoot, stateDir)

      const appFile = path.join(projectRoot, 'src', 'app.ts')
      await fs.mkdir(path.dirname(appFile), { recursive: true })
      await fs.writeFile(appFile, 'export const value = 1;\n', 'utf-8')

      await buildCodexHookEvent({
        session_id: 'codex-stop-failure-session',
        cwd: projectRoot,
        hook_event_name: 'SessionStart',
        model: 'gpt-5.4',
        event_time: '2026-04-09T12:10:00.000Z',
      }, {
        stateDir,
      })

      await buildCodexHookEvent({
        session_id: 'codex-stop-failure-session',
        cwd: projectRoot,
        hook_event_name: 'PreToolUse',
        model: 'gpt-5.4',
        event_time: '2026-04-09T12:10:02.000Z',
      }, {
        stateDir,
      })

      await fs.writeFile(appFile, 'export const value = 1;\nexport const next = 2;\n', 'utf-8')

      const event = await buildCodexHookEvent({
        session_id: 'codex-stop-failure-session',
        cwd: projectRoot,
        hook_event_name: hookEventName,
        model: 'gpt-5.4',
        event_time: '2026-04-09T12:10:07.000Z',
        tool_name: 'Bash',
        tool_input: {
          command: 'git add src/app.ts',
        },
      }, {
        stateDir,
      })

      expect(event.wait_ms).toBe(5_000)
      await expect(fs.readdir(path.join(stateDir, 'snapshots'))).resolves.toEqual([])
      await expect(fs.readdir(path.join(stateDir, 'sessions'))).resolves.toEqual([])
    },
  )

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

  it('keeps clearly read-only non-Bash tools from attributing snapshot deltas', async () => {
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

    expect(event.file_deltas).toEqual([])
    expect(event.language_stats).toEqual({})
  })

  it('refreshes the snapshot baseline after read-only tools without attributing prior repo changes', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-read-only-baseline-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-read-only-baseline-state-'))
    tempDirs.push(projectRoot, stateDir)

    const appFile = path.join(projectRoot, 'src', 'app.ts')
    const readmeFile = path.join(projectRoot, 'README.md')
    await fs.mkdir(path.dirname(appFile), { recursive: true })
    await fs.writeFile(appFile, 'export const value = 1;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n', 'utf-8')

    await buildCodexHookEvent({
      session_id: 'codex-read-only-baseline-session',
      cwd: projectRoot,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-05T12:00:00.000Z',
    }, {
      stateDir,
    })

    await fs.writeFile(appFile, 'export const value = 1;\nexport const next = 2;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n\nExtra line\n', 'utf-8')

    const readOnlyEvent = await buildCodexHookEvent({
      session_id: 'codex-read-only-baseline-session',
      cwd: projectRoot,
      hook_event_name: 'PostToolUse',
      model: 'gpt-5.4',
      event_time: '2026-04-05T12:00:05.000Z',
      tool_name: 'ReadFile',
    }, {
      stateDir,
    })

    expect(readOnlyEvent.file_deltas).toEqual([])

    await fs.writeFile(appFile, 'export const value = 1;\nexport const next = 2;\nexport const final = 3;\n', 'utf-8')

    const narrowed = await buildCodexHookEvent({
      session_id: 'codex-read-only-baseline-session',
      cwd: projectRoot,
      hook_event_name: 'PostToolUse',
      model: 'gpt-5.4',
      event_time: '2026-04-05T12:00:08.000Z',
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

  it('ignores -- markers when narrowing bash candidates', async () => {
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
        command: 'git add -- src/app.ts',
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

  it('falls back to a full snapshot for semicolon-chained bash commands', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-semicolon-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-semicolon-state-'))
    tempDirs.push(projectRoot, stateDir)

    const appFile = path.join(projectRoot, 'src', 'app.ts')
    const readmeFile = path.join(projectRoot, 'README.md')
    await fs.mkdir(path.dirname(appFile), { recursive: true })
    await fs.writeFile(appFile, 'export const value = 1;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n', 'utf-8')

    await buildCodexHookEvent({
      session_id: 'codex-semicolon-session',
      cwd: projectRoot,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-06T12:36:00.000Z',
    }, {
      stateDir,
    })

    await fs.writeFile(appFile, 'export const value = 1;\nexport const next = 2;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n\nExtra line\n', 'utf-8')

    const event = await buildCodexHookEvent({
      session_id: 'codex-semicolon-session',
      cwd: projectRoot,
      hook_event_name: 'PostToolUse',
      model: 'gpt-5.4',
      event_time: '2026-04-06T12:36:05.000Z',
      tool_name: 'Bash',
      tool_input: {
        command: 'git add src/app.ts; echo done',
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

  it('falls back to a full snapshot for parenthesized bash commands', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-parenthesized-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-parenthesized-state-'))
    tempDirs.push(projectRoot, stateDir)

    const appFile = path.join(projectRoot, 'src', 'app.ts')
    const readmeFile = path.join(projectRoot, 'README.md')
    await fs.mkdir(path.dirname(appFile), { recursive: true })
    await fs.writeFile(appFile, 'export const value = 1;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n', 'utf-8')

    await buildCodexHookEvent({
      session_id: 'codex-parenthesized-session',
      cwd: projectRoot,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-06T14:00:00.000Z',
    }, {
      stateDir,
    })

    await fs.writeFile(appFile, 'export const value = 1;\nexport const next = 2;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n\nExtra line\n', 'utf-8')

    const event = await buildCodexHookEvent({
      session_id: 'codex-parenthesized-session',
      cwd: projectRoot,
      hook_event_name: 'PostToolUse',
      model: 'gpt-5.4',
      event_time: '2026-04-06T14:00:05.000Z',
      tool_name: 'Bash',
      tool_input: {
        command: '(git add src/app.ts)',
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

  it('falls back to a full snapshot for piped bash commands', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-pipe-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-pipe-state-'))
    tempDirs.push(projectRoot, stateDir)

    const appFile = path.join(projectRoot, 'src', 'app.ts')
    const readmeFile = path.join(projectRoot, 'README.md')
    await fs.mkdir(path.dirname(appFile), { recursive: true })
    await fs.writeFile(appFile, 'export const value = 1;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n', 'utf-8')

    await buildCodexHookEvent({
      session_id: 'codex-pipe-session',
      cwd: projectRoot,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-06T14:01:00.000Z',
    }, {
      stateDir,
    })

    await fs.writeFile(appFile, 'export const value = 1;\nexport const next = 2;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n\nExtra line\n', 'utf-8')

    const event = await buildCodexHookEvent({
      session_id: 'codex-pipe-session',
      cwd: projectRoot,
      hook_event_name: 'PostToolUse',
      model: 'gpt-5.4',
      event_time: '2026-04-06T14:01:05.000Z',
      tool_name: 'Bash',
      tool_input: {
        command: 'git add src/app.ts | cat',
      },
    }, {
      stateDir,
    })

    expect(event.file_deltas).toHaveLength(2)
  })

  it('falls back to a full snapshot for redirected bash commands', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-redirect-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-redirect-state-'))
    tempDirs.push(projectRoot, stateDir)

    const appFile = path.join(projectRoot, 'src', 'app.ts')
    const readmeFile = path.join(projectRoot, 'README.md')
    await fs.mkdir(path.dirname(appFile), { recursive: true })
    await fs.writeFile(appFile, 'export const value = 1;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n', 'utf-8')

    await buildCodexHookEvent({
      session_id: 'codex-redirect-session',
      cwd: projectRoot,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-06T14:02:00.000Z',
    }, {
      stateDir,
    })

    await fs.writeFile(appFile, 'export const value = 1;\nexport const next = 2;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n\nExtra line\n', 'utf-8')

    const event = await buildCodexHookEvent({
      session_id: 'codex-redirect-session',
      cwd: projectRoot,
      hook_event_name: 'PostToolUse',
      model: 'gpt-5.4',
      event_time: '2026-04-06T14:02:05.000Z',
      tool_name: 'Bash',
      tool_input: {
        command: 'echo done > README.md',
      },
    }, {
      stateDir,
    })

    expect(event.file_deltas).toHaveLength(2)
  })

  it('falls back to a full snapshot for command-substitution bash commands', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-subshell-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-subshell-state-'))
    tempDirs.push(projectRoot, stateDir)

    const appFile = path.join(projectRoot, 'src', 'app.ts')
    const readmeFile = path.join(projectRoot, 'README.md')
    await fs.mkdir(path.dirname(appFile), { recursive: true })
    await fs.writeFile(appFile, 'export const value = 1;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n', 'utf-8')

    await buildCodexHookEvent({
      session_id: 'codex-subshell-session',
      cwd: projectRoot,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-06T14:03:00.000Z',
    }, {
      stateDir,
    })

    await fs.writeFile(appFile, 'export const value = 1;\nexport const next = 2;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n\nExtra line\n', 'utf-8')

    const event = await buildCodexHookEvent({
      session_id: 'codex-subshell-session',
      cwd: projectRoot,
      hook_event_name: 'PostToolUse',
      model: 'gpt-5.4',
      event_time: '2026-04-06T14:03:05.000Z',
      tool_name: 'Bash',
      tool_input: {
        command: 'git add $(printf src/app.ts)',
      },
    }, {
      stateDir,
    })

    expect(event.file_deltas).toHaveLength(2)
  })

  it('captures quoted absolute paths inside the project root but ignores external ones', async () => {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-absolute-'))
    const projectRoot = path.join(sandboxRoot, 'demo project')
    const externalRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-external-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-absolute-state-'))
    tempDirs.push(sandboxRoot, externalRoot, stateDir)

    const appFile = path.join(projectRoot, 'src', 'app.ts')
    const externalFile = path.join(externalRoot, 'outside.ts')
    await fs.mkdir(path.dirname(appFile), { recursive: true })
    await fs.writeFile(appFile, 'export const value = 1;\n', 'utf-8')
    await fs.writeFile(externalFile, 'export const outside = true;\n', 'utf-8')

    await buildCodexHookEvent({
      session_id: 'codex-absolute-session',
      cwd: projectRoot,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-06T14:10:00.000Z',
    }, {
      stateDir,
    })

    await fs.writeFile(appFile, 'export const value = 1;\nexport const next = 2;\n', 'utf-8')

    const event = await buildCodexHookEvent({
      session_id: 'codex-absolute-session',
      cwd: projectRoot,
      hook_event_name: 'PostToolUse',
      model: 'gpt-5.4',
      event_time: '2026-04-06T14:10:05.000Z',
      tool_name: 'Bash',
      tool_input: {
        command: `git add "${appFile}" "${externalFile}"`,
      },
    }, {
      stateDir,
    })

    expect(event.file_deltas).toEqual([
      expect.objectContaining({
        language: 'TypeScript',
        added: 1,
        removed: 0,
      }),
    ])
  })

  it('captures quoted relative paths with spaces inside the project root', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-quoted-relative-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-quoted-relative-state-'))
    tempDirs.push(projectRoot, stateDir)

    const appFile = path.join(projectRoot, 'src', 'my file.ts')
    const readmeFile = path.join(projectRoot, 'README.md')
    await fs.mkdir(path.dirname(appFile), { recursive: true })
    await fs.writeFile(appFile, 'export const value = 1;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n', 'utf-8')

    await buildCodexHookEvent({
      session_id: 'codex-quoted-relative-session',
      cwd: projectRoot,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-06T14:14:00.000Z',
    }, {
      stateDir,
    })

    await fs.writeFile(appFile, 'export const value = 1;\nexport const next = 2;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n\nExtra line\n', 'utf-8')

    const event = await buildCodexHookEvent({
      session_id: 'codex-quoted-relative-session',
      cwd: projectRoot,
      hook_event_name: 'PostToolUse',
      model: 'gpt-5.4',
      event_time: '2026-04-06T14:14:05.000Z',
      tool_name: 'Bash',
      tool_input: {
        command: 'git add "src/my file.ts"',
      },
    }, {
      stateDir,
    })

    expect(event.file_deltas).toEqual([
      expect.objectContaining({
        language: 'TypeScript',
        added: 1,
        removed: 0,
      }),
    ])
  })

  it('captures absolute directory paths inside the project root', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-absolute-dir-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-absolute-dir-state-'))
    tempDirs.push(projectRoot, stateDir)

    const appFile = path.join(projectRoot, 'src', 'app.ts')
    const readmeFile = path.join(projectRoot, 'README.md')
    await fs.mkdir(path.dirname(appFile), { recursive: true })
    await fs.writeFile(appFile, 'export const value = 1;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n', 'utf-8')

    await buildCodexHookEvent({
      session_id: 'codex-absolute-dir-session',
      cwd: projectRoot,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-06T14:15:00.000Z',
    }, {
      stateDir,
    })

    await fs.writeFile(appFile, 'export const value = 1;\nexport const next = 2;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n\nExtra line\n', 'utf-8')

    const event = await buildCodexHookEvent({
      session_id: 'codex-absolute-dir-session',
      cwd: projectRoot,
      hook_event_name: 'PostToolUse',
      model: 'gpt-5.4',
      event_time: '2026-04-06T14:15:05.000Z',
      tool_name: 'Bash',
      tool_input: {
        command: `git add "${path.join(projectRoot, 'src')}"`,
      },
    }, {
      stateDir,
    })

    expect(event.file_deltas).toEqual([
      expect.objectContaining({
        language: 'TypeScript',
        added: 1,
        removed: 0,
      }),
    ])
  })

  it('unwraps simple bash -lc commands before narrowing candidates', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-bash-lc-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-bash-lc-state-'))
    tempDirs.push(projectRoot, stateDir)

    const appFile = path.join(projectRoot, 'src', 'app.ts')
    const readmeFile = path.join(projectRoot, 'README.md')
    await fs.mkdir(path.dirname(appFile), { recursive: true })
    await fs.writeFile(appFile, 'export const value = 1;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n', 'utf-8')

    await buildCodexHookEvent({
      session_id: 'codex-bash-lc-session',
      cwd: projectRoot,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-07T10:00:00.000Z',
    }, {
      stateDir,
    })

    await fs.writeFile(appFile, 'export const value = 1;\nexport const next = 2;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n\nExtra line\n', 'utf-8')

    const event = await buildCodexHookEvent({
      session_id: 'codex-bash-lc-session',
      cwd: projectRoot,
      hook_event_name: 'PostToolUse',
      model: 'gpt-5.4',
      event_time: '2026-04-07T10:00:05.000Z',
      tool_name: 'Bash',
      tool_input: {
        command: `bash -lc 'git add "src/app.ts"'`,
      },
    }, {
      stateDir,
    })

    expect(event.file_deltas).toEqual([
      expect.objectContaining({
        language: 'TypeScript',
        added: 1,
        removed: 0,
      }),
    ])
  })

  it('unwraps nested env and shell-wrapper prefixes before narrowing candidates', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-nested-wrappers-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-nested-wrappers-state-'))
    tempDirs.push(projectRoot, stateDir)

    const appFile = path.join(projectRoot, 'src', 'app.ts')
    const readmeFile = path.join(projectRoot, 'README.md')
    await fs.mkdir(path.dirname(appFile), { recursive: true })
    await fs.writeFile(appFile, 'export const value = 1;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n', 'utf-8')

    await buildCodexHookEvent({
      session_id: 'codex-nested-wrappers-session',
      cwd: projectRoot,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-07T10:00:00.000Z',
    }, {
      stateDir,
    })

    await fs.writeFile(appFile, 'export const value = 1;\nexport const next = 2;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n\nExtra line\n', 'utf-8')

    const event = await buildCodexHookEvent({
      session_id: 'codex-nested-wrappers-session',
      cwd: projectRoot,
      hook_event_name: 'PostToolUse',
      model: 'gpt-5.4',
      event_time: '2026-04-07T10:00:05.000Z',
      tool_name: 'Bash',
      tool_input: {
        command: `env DEBUG=1 command builtin noglob bash -lc 'git add "src/app.ts"'`,
      },
    }, {
      stateDir,
    })

    expect(event.file_deltas).toEqual([
      expect.objectContaining({
        language: 'TypeScript',
        added: 1,
        removed: 0,
      }),
    ])
  })

  it('unwraps absolute zsh -lc launchers before narrowing candidates', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-zsh-lc-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-zsh-lc-state-'))
    tempDirs.push(projectRoot, stateDir)

    const appFile = path.join(projectRoot, 'src', 'app.ts')
    const readmeFile = path.join(projectRoot, 'README.md')
    await fs.mkdir(path.dirname(appFile), { recursive: true })
    await fs.writeFile(appFile, 'export const value = 1;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n', 'utf-8')

    await buildCodexHookEvent({
      session_id: 'codex-zsh-lc-session',
      cwd: projectRoot,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-08T16:00:00.000Z',
    }, {
      stateDir,
    })

    await fs.writeFile(appFile, 'export const value = 1;\nexport const next = 2;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n\nExtra line\n', 'utf-8')

    const event = await buildCodexHookEvent({
      session_id: 'codex-zsh-lc-session',
      cwd: projectRoot,
      hook_event_name: 'PostToolUse',
      model: 'gpt-5.4',
      event_time: '2026-04-08T16:00:05.000Z',
      tool_name: 'Bash',
      tool_input: {
        command: `/bin/zsh -lc 'git add "src/app.ts"'`,
      },
    }, {
      stateDir,
    })

    expect(event.file_deltas).toEqual([
      expect.objectContaining({
        language: 'TypeScript',
        added: 1,
        removed: 0,
      }),
    ])
  })

  it('unwraps quoted Windows bash.exe launchers before narrowing candidates', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-win-bash-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-win-bash-state-'))
    tempDirs.push(projectRoot, stateDir)

    const appFile = path.join(projectRoot, 'src', 'app.ts')
    const readmeFile = path.join(projectRoot, 'README.md')
    await fs.mkdir(path.dirname(appFile), { recursive: true })
    await fs.writeFile(appFile, 'export const value = 1;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n', 'utf-8')

    await buildCodexHookEvent({
      session_id: 'codex-win-bash-session',
      cwd: projectRoot,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-08T16:01:00.000Z',
    }, {
      stateDir,
    })

    await fs.writeFile(appFile, 'export const value = 1;\nexport const next = 2;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n\nExtra line\n', 'utf-8')

    const event = await buildCodexHookEvent({
      session_id: 'codex-win-bash-session',
      cwd: projectRoot,
      hook_event_name: 'PostToolUse',
      model: 'gpt-5.4',
      event_time: '2026-04-08T16:01:05.000Z',
      tool_name: 'Bash',
      tool_input: {
        command: `"C:\\tools\\bash.exe" -lc "git add src/app.ts"`,
      },
    }, {
      stateDir,
    })

    expect(event.file_deltas).toEqual([
      expect.objectContaining({
        language: 'TypeScript',
        added: 1,
        removed: 0,
      }),
    ])
  })

  it('captures touch-created files as narrow candidate deltas', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-touch-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-touch-state-'))
    tempDirs.push(projectRoot, stateDir)

    const existingFile = path.join(projectRoot, 'README.md')
    const createdFile = path.join(projectRoot, 'src', 'created.ts')
    await fs.mkdir(path.dirname(createdFile), { recursive: true })
    await fs.writeFile(existingFile, '# Demo\n', 'utf-8')

    await buildCodexHookEvent({
      session_id: 'codex-touch-session',
      cwd: projectRoot,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-07T10:09:00.000Z',
    }, {
      stateDir,
    })

    await fs.writeFile(createdFile, 'export const created = true;\n', 'utf-8')

    const event = await buildCodexHookEvent({
      session_id: 'codex-touch-session',
      cwd: projectRoot,
      hook_event_name: 'PostToolUse',
      model: 'gpt-5.4',
      event_time: '2026-04-07T10:09:05.000Z',
      tool_name: 'Bash',
      tool_input: {
        command: 'touch src/created.ts',
      },
    }, {
      stateDir,
    })

    expect(event.file_deltas).toEqual([
      expect.objectContaining({
        language: 'TypeScript',
        added: 1,
        removed: 0,
      }),
    ])
  })

  it('captures copied files without widening to unrelated project files', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-cp-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-cp-state-'))
    tempDirs.push(projectRoot, stateDir)

    const sourceFile = path.join(projectRoot, 'src', 'source.ts')
    const copiedFile = path.join(projectRoot, 'src', 'copied.ts')
    const readmeFile = path.join(projectRoot, 'README.md')
    await fs.mkdir(path.dirname(sourceFile), { recursive: true })
    await fs.writeFile(sourceFile, 'export const source = true;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n', 'utf-8')

    await buildCodexHookEvent({
      session_id: 'codex-cp-session',
      cwd: projectRoot,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-07T10:10:00.000Z',
    }, {
      stateDir,
    })

    await fs.copyFile(sourceFile, copiedFile)

    const event = await buildCodexHookEvent({
      session_id: 'codex-cp-session',
      cwd: projectRoot,
      hook_event_name: 'PostToolUse',
      model: 'gpt-5.4',
      event_time: '2026-04-07T10:10:05.000Z',
      tool_name: 'Bash',
      tool_input: {
        command: 'cp src/source.ts src/copied.ts',
      },
    }, {
      stateDir,
    })

    expect(event.file_deltas).toEqual([
      expect.objectContaining({
        language: 'TypeScript',
        added: 1,
        removed: 0,
      }),
    ])
  })

  it('captures tee-created files as narrow candidate deltas', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-tee-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-tee-state-'))
    tempDirs.push(projectRoot, stateDir)

    const createdFile = path.join(projectRoot, 'src', 'tee-output.ts')
    const readmeFile = path.join(projectRoot, 'README.md')
    await fs.mkdir(path.dirname(createdFile), { recursive: true })
    await fs.writeFile(readmeFile, '# Demo\n', 'utf-8')

    await buildCodexHookEvent({
      session_id: 'codex-tee-session',
      cwd: projectRoot,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-07T10:10:30.000Z',
    }, {
      stateDir,
    })

    await fs.writeFile(createdFile, 'export const teeOutput = true;\n', 'utf-8')

    const event = await buildCodexHookEvent({
      session_id: 'codex-tee-session',
      cwd: projectRoot,
      hook_event_name: 'PostToolUse',
      model: 'gpt-5.4',
      event_time: '2026-04-07T10:10:35.000Z',
      tool_name: 'Bash',
      tool_input: {
        command: 'tee src/tee-output.ts',
      },
    }, {
      stateDir,
    })

    expect(event.file_deltas).toEqual([
      expect.objectContaining({
        language: 'TypeScript',
        added: 1,
        removed: 0,
      }),
    ])
  })

  it('captures sed -i edits as narrow write deltas', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-sed-i-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-sed-i-state-'))
    tempDirs.push(projectRoot, stateDir)

    const appFile = path.join(projectRoot, 'src', 'app.ts')
    const readmeFile = path.join(projectRoot, 'README.md')
    await fs.mkdir(path.dirname(appFile), { recursive: true })
    await fs.writeFile(appFile, 'export const value = 1;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n', 'utf-8')

    await buildCodexHookEvent({
      session_id: 'codex-sed-i-session',
      cwd: projectRoot,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-07T10:11:00.000Z',
    }, {
      stateDir,
    })

    await fs.writeFile(appFile, 'export const value = 2;\n', 'utf-8')

    const event = await buildCodexHookEvent({
      session_id: 'codex-sed-i-session',
      cwd: projectRoot,
      hook_event_name: 'PostToolUse',
      model: 'gpt-5.4',
      event_time: '2026-04-07T10:11:05.000Z',
      tool_name: 'Bash',
      tool_input: {
        command: `sed -i '' 's/1/2/' src/app.ts`,
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
  })

  it('summarizes delete-then-recreate on the same path as a single edited file delta', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-recreate-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-recreate-state-'))
    tempDirs.push(projectRoot, stateDir)

    const targetFile = path.join(projectRoot, 'src', 'app.ts')
    const readmeFile = path.join(projectRoot, 'README.md')
    await fs.mkdir(path.dirname(targetFile), { recursive: true })
    await fs.writeFile(targetFile, 'export const value = 1;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n', 'utf-8')

    await buildCodexHookEvent({
      session_id: 'codex-recreate-session',
      cwd: projectRoot,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-07T10:12:00.000Z',
    }, {
      stateDir,
    })

    await fs.rm(targetFile, { force: true })
    await fs.writeFile(targetFile, 'export const value = 2;\n', 'utf-8')

    const event = await buildCodexHookEvent({
      session_id: 'codex-recreate-session',
      cwd: projectRoot,
      hook_event_name: 'PostToolUse',
      model: 'gpt-5.4',
      event_time: '2026-04-07T10:12:05.000Z',
      tool_name: 'Bash',
      tool_input: {
        command: 'touch src/app.ts',
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
  })

  it('keeps read-only git show commands from attributing repo-wide snapshot deltas', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-git-show-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-git-show-state-'))
    tempDirs.push(projectRoot, stateDir)

    const appFile = path.join(projectRoot, 'src', 'app.ts')
    const readmeFile = path.join(projectRoot, 'README.md')
    await fs.mkdir(path.dirname(appFile), { recursive: true })
    await fs.writeFile(appFile, 'export const value = 1;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n', 'utf-8')

    await buildCodexHookEvent({
      session_id: 'codex-git-show-session',
      cwd: projectRoot,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-07T10:02:00.000Z',
    }, {
      stateDir,
    })

    await fs.writeFile(appFile, 'export const value = 1;\nexport const next = 2;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n\nExtra line\n', 'utf-8')

    const event = await buildCodexHookEvent({
      session_id: 'codex-git-show-session',
      cwd: projectRoot,
      hook_event_name: 'PostToolUse',
      model: 'gpt-5.4',
      event_time: '2026-04-07T10:02:05.000Z',
      tool_name: 'Bash',
      tool_input: {
        command: 'git show src/app.ts',
      },
    }, {
      stateDir,
    })

    expect(event.file_deltas).toEqual([])
  })

  it('keeps read-only sort commands from attributing repo-wide snapshot deltas', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-sort-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-sort-state-'))
    tempDirs.push(projectRoot, stateDir)

    const appFile = path.join(projectRoot, 'src', 'app.ts')
    const readmeFile = path.join(projectRoot, 'README.md')
    await fs.mkdir(path.dirname(appFile), { recursive: true })
    await fs.writeFile(appFile, 'export const value = 1;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n', 'utf-8')

    await buildCodexHookEvent({
      session_id: 'codex-sort-session',
      cwd: projectRoot,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-07T10:03:00.000Z',
    }, {
      stateDir,
    })

    await fs.writeFile(appFile, 'export const value = 1;\nexport const next = 2;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n\nExtra line\n', 'utf-8')

    const event = await buildCodexHookEvent({
      session_id: 'codex-sort-session',
      cwd: projectRoot,
      hook_event_name: 'PostToolUse',
      model: 'gpt-5.4',
      event_time: '2026-04-07T10:03:05.000Z',
      tool_name: 'Bash',
      tool_input: {
        command: 'sort src/app.ts',
      },
    }, {
      stateDir,
    })

    expect(event.file_deltas).toEqual([])
  })

  it('keeps read-only awk commands from attributing repo-wide snapshot deltas', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-awk-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-awk-state-'))
    tempDirs.push(projectRoot, stateDir)

    const appFile = path.join(projectRoot, 'src', 'app.ts')
    const readmeFile = path.join(projectRoot, 'README.md')
    await fs.mkdir(path.dirname(appFile), { recursive: true })
    await fs.writeFile(appFile, 'export const value = 1;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n', 'utf-8')

    await buildCodexHookEvent({
      session_id: 'codex-awk-session',
      cwd: projectRoot,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-07T10:04:00.000Z',
    }, {
      stateDir,
    })

    await fs.writeFile(appFile, 'export const value = 1;\nexport const next = 2;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n\nExtra line\n', 'utf-8')

    const event = await buildCodexHookEvent({
      session_id: 'codex-awk-session',
      cwd: projectRoot,
      hook_event_name: 'PostToolUse',
      model: 'gpt-5.4',
      event_time: '2026-04-07T10:04:05.000Z',
      tool_name: 'Bash',
      tool_input: {
        command: "awk 'NR==1 { print $0 }' src/app.ts",
      },
    }, {
      stateDir,
    })

    expect(event.file_deltas).toEqual([])
  })

  it('keeps read-only cut commands from attributing repo-wide snapshot deltas', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-cut-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-cut-state-'))
    tempDirs.push(projectRoot, stateDir)

    const appFile = path.join(projectRoot, 'src', 'app.ts')
    const readmeFile = path.join(projectRoot, 'README.md')
    await fs.mkdir(path.dirname(appFile), { recursive: true })
    await fs.writeFile(appFile, 'export const value = 1;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n', 'utf-8')

    await buildCodexHookEvent({
      session_id: 'codex-cut-session',
      cwd: projectRoot,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-08T12:00:00.000Z',
    }, {
      stateDir,
    })

    await fs.writeFile(appFile, 'export const value = 1;\nexport const next = 2;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n\nExtra line\n', 'utf-8')

    const event = await buildCodexHookEvent({
      session_id: 'codex-cut-session',
      cwd: projectRoot,
      hook_event_name: 'PostToolUse',
      model: 'gpt-5.4',
      event_time: '2026-04-08T12:00:05.000Z',
      tool_name: 'Bash',
      tool_input: {
        command: 'cut -d: -f1 src/app.ts',
      },
    }, {
      stateDir,
    })

    expect(event.file_deltas).toEqual([])
  })

  it('keeps read-only uniq commands from attributing repo-wide snapshot deltas', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-uniq-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-uniq-state-'))
    tempDirs.push(projectRoot, stateDir)

    const appFile = path.join(projectRoot, 'src', 'app.ts')
    const readmeFile = path.join(projectRoot, 'README.md')
    await fs.mkdir(path.dirname(appFile), { recursive: true })
    await fs.writeFile(appFile, 'export const value = 1;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n', 'utf-8')

    await buildCodexHookEvent({
      session_id: 'codex-uniq-session',
      cwd: projectRoot,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-08T12:01:00.000Z',
    }, {
      stateDir,
    })

    await fs.writeFile(appFile, 'export const value = 1;\nexport const next = 2;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n\nExtra line\n', 'utf-8')

    const event = await buildCodexHookEvent({
      session_id: 'codex-uniq-session',
      cwd: projectRoot,
      hook_event_name: 'PostToolUse',
      model: 'gpt-5.4',
      event_time: '2026-04-08T12:01:05.000Z',
      tool_name: 'Bash',
      tool_input: {
        command: 'uniq src/app.ts',
      },
    }, {
      stateDir,
    })

    expect(event.file_deltas).toEqual([])
  })

  it('falls back to a full snapshot for python -m commands that mention project files', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-python-module-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-python-module-state-'))
    tempDirs.push(projectRoot, stateDir)

    const appFile = path.join(projectRoot, 'src', 'app.ts')
    const readmeFile = path.join(projectRoot, 'README.md')
    await fs.mkdir(path.dirname(appFile), { recursive: true })
    await fs.writeFile(appFile, 'export const value = 1;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n', 'utf-8')

    await buildCodexHookEvent({
      session_id: 'codex-python-module-session',
      cwd: projectRoot,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-08T12:02:00.000Z',
    }, {
      stateDir,
    })

    await fs.writeFile(appFile, 'export const value = 1;\nexport const next = 2;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n\nExtra line\n', 'utf-8')

    const event = await buildCodexHookEvent({
      session_id: 'codex-python-module-session',
      cwd: projectRoot,
      hook_event_name: 'PostToolUse',
      model: 'gpt-5.4',
      event_time: '2026-04-08T12:02:05.000Z',
      tool_name: 'Bash',
      tool_input: {
        command: 'python -m black src/app.ts',
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

  it('falls back to a full snapshot for tar extraction commands', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-tar-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-tar-state-'))
    tempDirs.push(projectRoot, stateDir)

    const archiveFile = path.join(projectRoot, 'archive.tar')
    const appFile = path.join(projectRoot, 'src', 'app.ts')
    const readmeFile = path.join(projectRoot, 'README.md')
    await fs.mkdir(path.dirname(appFile), { recursive: true })
    await fs.writeFile(archiveFile, 'placeholder archive\n', 'utf-8')
    await fs.writeFile(appFile, 'export const value = 1;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n', 'utf-8')

    await buildCodexHookEvent({
      session_id: 'codex-tar-session',
      cwd: projectRoot,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-08T12:03:00.000Z',
    }, {
      stateDir,
    })

    await fs.writeFile(appFile, 'export const value = 1;\nexport const next = 2;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n\nExtra line\n', 'utf-8')

    const event = await buildCodexHookEvent({
      session_id: 'codex-tar-session',
      cwd: projectRoot,
      hook_event_name: 'PostToolUse',
      model: 'gpt-5.4',
      event_time: '2026-04-08T12:03:05.000Z',
      tool_name: 'Bash',
      tool_input: {
        command: 'tar -xf archive.tar -C src',
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

  it('falls back to a full snapshot for unzip extraction commands', async () => {
    await expectBroadFallbackForCommand(
      'unzip archive.zip -d src',
      'clipulse-codex-unzip-',
    )
  })

  it('falls back to a full snapshot for wrapped python3 -m commands', async () => {
    await expectBroadFallbackForCommand(
      "/bin/bash -lc 'python3 -m black src/app.ts'",
      'clipulse-codex-wrapped-python3-module-',
    )
  })

  it('falls back to a full snapshot for Windows-style python.exe -m commands', async () => {
    await expectBroadFallbackForCommand(
      'C:\\tools\\python.exe -m black src/app.ts',
      'clipulse-codex-windows-python-exe-',
    )
  })

  it('falls back to a full snapshot for Windows cmd /c launchers', async () => {
    await expectBroadFallbackForCommand(
      'cmd /c git add src/app.ts',
      'clipulse-codex-windows-cmd-launcher-',
    )
  })

  it('falls back to a full snapshot for PowerShell -Command launchers', async () => {
    await expectBroadFallbackForCommand(
      'powershell -Command git add src/app.ts',
      'clipulse-codex-powershell-launcher-',
    )
  })

  it('falls back to a full snapshot for Windows sh.exe -c launchers', async () => {
    await expectBroadFallbackForCommand(
      "\"C:\\Program Files\\Git\\bin\\sh.exe\" -c 'git add src/app.ts'",
      'clipulse-codex-windows-sh-launcher-',
    )
  })

  it('falls back to a full snapshot for wrapped tar extraction commands', async () => {
    await expectBroadFallbackForCommand(
      "/bin/bash -lc 'tar -xf archive.tar -C src'",
      'clipulse-codex-wrapped-tar-',
    )
  })

  it('falls back to a full snapshot for xargs commands that hide write targets behind list files', async () => {
    await expectBroadFallbackForCommand(
      'xargs -a tmp/targets.txt rm -f',
      'clipulse-codex-xargs-',
    )
  })

  it('falls back to a full snapshot for xargs -I commands that hide write targets behind substitutions', async () => {
    await expectBroadFallbackForCommand(
      "xargs -I{} sed -i '' 's/value/next/' {} < tmp/targets.txt",
      'clipulse-codex-xargs-template-',
    )
  })

  it('falls back to a full snapshot for find -exec commands that hide write targets behind traversal', async () => {
    await expectBroadFallbackForCommand(
      "find src -name '*.ts' -exec perl -pi -e 's/value/next/' {} +",
      'clipulse-codex-find-exec-',
    )
  })

  it('falls back to a full snapshot for find -execdir commands that hide write targets behind traversal', async () => {
    await expectBroadFallbackForCommand(
      "find src -name '*.ts' -execdir perl -pi -e 's/value/next/' {} +",
      'clipulse-codex-find-execdir-',
    )
  })

  it('falls back to a full snapshot for install commands', async () => {
    await expectBroadFallbackForCommand(
      'install src/app.ts src/generated.ts',
      'clipulse-codex-install-',
    )
  })

  it('falls back to a full snapshot for install -d commands', async () => {
    await expectBroadFallbackForCommand(
      'install -d src/generated',
      'clipulse-codex-install-d-',
    )
  })

  it('falls back to a full snapshot for install -t commands', async () => {
    await expectBroadFallbackForCommand(
      'install -t src src/app.ts README.md',
      'clipulse-codex-install-t-',
    )
  })

  it('falls back to a full snapshot for perl -pi commands', async () => {
    await expectBroadFallbackForCommand(
      "perl -pi -e 's/value/next/' src/app.ts",
      'clipulse-codex-perl-pi-',
    )
  })

  it('falls back to a full snapshot for perl -pi.bak commands', async () => {
    await expectBroadFallbackForCommand(
      "perl -pi.bak -e 's/value/next/' src/app.ts",
      'clipulse-codex-perl-pi-bak-',
    )
  })

  it('falls back to a full snapshot for .venv python -m launchers', async () => {
    await expectBroadFallbackForCommand(
      '.venv/bin/python -m black src/app.ts',
      'clipulse-codex-venv-python-m-',
    )
  })

  it('falls back to a full snapshot for sort -o commands', async () => {
    await expectBroadFallbackForCommand(
      'sort -o src/app.ts src/app.ts',
      'clipulse-codex-sort-o-',
    )
  })

  it('falls back to a full snapshot for rsync commands that can rewrite whole directory trees', async () => {
    await expectBroadFallbackForCommand(
      'rsync -a src/ lib/',
      'clipulse-codex-rsync-',
    )
  })

  it('falls back to a full snapshot for cp -R commands that can copy whole directory trees', async () => {
    await expectBroadFallbackForCommand(
      'cp -R src lib',
      'clipulse-codex-cp-r-',
    )
  })

  it('falls back to a full snapshot for cp -r commands with directory slash arguments', async () => {
    await expectBroadFallbackForCommand(
      'cp -r src/ lib/',
      'clipulse-codex-cp-lower-r-',
    )
  })

  it('falls back to a full snapshot for mixed safe and unsafe command chains', async () => {
    await expectBroadFallbackForCommand(
      "git diff src/app.ts && sed -i '' 's/value/next/' src/app.ts",
      'clipulse-codex-mixed-chain-',
    )
  })

  it('summarizes file moves as remove plus add for file-level mv commands', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-file-mv-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-file-mv-state-'))
    tempDirs.push(projectRoot, stateDir)

    const sourceFile = path.join(projectRoot, 'src', 'app.ts')
    await fs.mkdir(path.dirname(sourceFile), { recursive: true })
    await fs.writeFile(sourceFile, 'export const moved = true;\n', 'utf-8')

    await buildCodexHookEvent({
      session_id: 'codex-file-mv-session',
      cwd: projectRoot,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-07T10:05:00.000Z',
    }, {
      stateDir,
    })

    const targetDir = path.join(projectRoot, 'lib')
    await fs.mkdir(targetDir, { recursive: true })
    await fs.rename(sourceFile, path.join(targetDir, 'app.ts'))

    const event = await buildCodexHookEvent({
      session_id: 'codex-file-mv-session',
      cwd: projectRoot,
      hook_event_name: 'PostToolUse',
      model: 'gpt-5.4',
      event_time: '2026-04-07T10:05:05.000Z',
      tool_name: 'Bash',
      tool_input: {
        command: 'mv src/app.ts lib/app.ts',
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

  it('keeps empty directory mkdir commands from inventing file deltas', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-mkdir-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-mkdir-state-'))
    tempDirs.push(projectRoot, stateDir)

    const appFile = path.join(projectRoot, 'src', 'app.ts')
    await fs.mkdir(path.dirname(appFile), { recursive: true })
    await fs.writeFile(appFile, 'export const value = 1;\n', 'utf-8')

    await buildCodexHookEvent({
      session_id: 'codex-mkdir-session',
      cwd: projectRoot,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-07T10:08:00.000Z',
    }, {
      stateDir,
    })

    await fs.mkdir(path.join(projectRoot, 'src', 'newdir'), { recursive: true })

    const event = await buildCodexHookEvent({
      session_id: 'codex-mkdir-session',
      cwd: projectRoot,
      hook_event_name: 'PostToolUse',
      model: 'gpt-5.4',
      event_time: '2026-04-07T10:08:05.000Z',
      tool_name: 'Bash',
      tool_input: {
        command: 'mkdir src/newdir',
      },
    }, {
      stateDir,
    })

    expect(event.file_deltas).toEqual([])
  })

  it('keeps read-only bash commands from attributing repo-wide snapshot deltas', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-readonly-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-readonly-state-'))
    tempDirs.push(projectRoot, stateDir)

    const appFile = path.join(projectRoot, 'src', 'app.ts')
    const readmeFile = path.join(projectRoot, 'README.md')
    await fs.mkdir(path.dirname(appFile), { recursive: true })
    await fs.writeFile(appFile, 'export const value = 1;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n', 'utf-8')

    await buildCodexHookEvent({
      session_id: 'codex-readonly-session',
      cwd: projectRoot,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-06T14:13:00.000Z',
    }, {
      stateDir,
    })

    await fs.writeFile(appFile, 'export const value = 1;\nexport const next = 2;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n\nExtra line\n', 'utf-8')

    const event = await buildCodexHookEvent({
      session_id: 'codex-readonly-session',
      cwd: projectRoot,
      hook_event_name: 'PostToolUse',
      model: 'gpt-5.4',
      event_time: '2026-04-06T14:13:05.000Z',
      tool_name: 'Bash',
      tool_input: {
        command: 'git diff src/app.ts',
      },
    }, {
      stateDir,
    })

    expect(event.file_deltas).toEqual([])
  })

  it('falls back to a full snapshot when bash has no reliable write-path candidates', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-no-paths-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-no-paths-state-'))
    tempDirs.push(projectRoot, stateDir)

    const appFile = path.join(projectRoot, 'src', 'app.ts')
    const readmeFile = path.join(projectRoot, 'README.md')
    await fs.mkdir(path.dirname(appFile), { recursive: true })
    await fs.writeFile(appFile, 'export const value = 1;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n', 'utf-8')

    await buildCodexHookEvent({
      session_id: 'codex-no-paths-session',
      cwd: projectRoot,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-06T14:12:00.000Z',
    }, {
      stateDir,
    })

    await fs.writeFile(appFile, 'export const value = 1;\nexport const next = 2;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n\nExtra line\n', 'utf-8')

    const event = await buildCodexHookEvent({
      session_id: 'codex-no-paths-session',
      cwd: projectRoot,
      hook_event_name: 'PostToolUse',
      model: 'gpt-5.4',
      event_time: '2026-04-06T14:12:05.000Z',
      tool_name: 'Bash',
      tool_input: {
        command: 'npm test',
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

  it('falls back to a full snapshot for escaped bash paths with spaces', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-escaped-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-escaped-state-'))
    tempDirs.push(projectRoot, stateDir)

    const appFile = path.join(projectRoot, 'src', 'my file.ts')
    const readmeFile = path.join(projectRoot, 'README.md')
    await fs.mkdir(path.dirname(appFile), { recursive: true })
    await fs.writeFile(appFile, 'export const value = 1;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n', 'utf-8')

    await buildCodexHookEvent({
      session_id: 'codex-escaped-session',
      cwd: projectRoot,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-06T14:11:00.000Z',
    }, {
      stateDir,
    })

    await fs.writeFile(appFile, 'export const value = 1;\nexport const next = 2;\n', 'utf-8')
    await fs.writeFile(readmeFile, '# Demo\n\nExtra line\n', 'utf-8')

    const event = await buildCodexHookEvent({
      session_id: 'codex-escaped-session',
      cwd: projectRoot,
      hook_event_name: 'PostToolUse',
      model: 'gpt-5.4',
      event_time: '2026-04-06T14:11:05.000Z',
      tool_name: 'Bash',
      tool_input: {
        command: 'git add src/my\\ file.ts',
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

  it('records deleted directories as remove deltas for nested files', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-dir-delete-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-dir-delete-state-'))
    tempDirs.push(projectRoot, stateDir)

    const sourceFile = path.join(projectRoot, 'src', 'legacy', 'app.ts')
    await fs.mkdir(path.dirname(sourceFile), { recursive: true })
    await fs.writeFile(sourceFile, 'export const removed = true;\n', 'utf-8')

    await buildCodexHookEvent({
      session_id: 'codex-dir-delete-session',
      cwd: projectRoot,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-06T13:05:00.000Z',
    }, {
      stateDir,
    })

    await fs.rm(path.join(projectRoot, 'src', 'legacy'), { recursive: true, force: true })

    const event = await buildCodexHookEvent({
      session_id: 'codex-dir-delete-session',
      cwd: projectRoot,
      hook_event_name: 'PostToolUse',
      model: 'gpt-5.4',
      event_time: '2026-04-06T13:05:05.000Z',
      tool_name: 'Bash',
      tool_input: {
        command: 'rm -rf src/legacy',
      },
    }, {
      stateDir,
    })

    expect(event.file_deltas).toEqual([
      expect.objectContaining({ language: 'TypeScript', added: 0, removed: 1 }),
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
    const canonicalRepoRoot = await fs.realpath(repoRoot)

    const event = await buildCodexHookEvent({
      session_id: 'codex-context-session',
      cwd: worktreeRoot,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-06T12:40:00.000Z',
    }, {
      stateDir: sandboxRoot,
    })

    expect(event.project_root).toBe(canonicalRepoRoot)
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
    const canonicalRepoRoot = await fs.realpath(repoRoot)

    const event = await buildCodexHookEvent({
      session_id: 'codex-nested-context-session',
      cwd: nestedCwd,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-06T12:45:00.000Z',
    }, {
      stateDir,
    })

    expect(event.project_root).toBe(canonicalRepoRoot)
    expect(event.project_name).toBe('demo')
    expect(event.git_branch).toBe('main')
  })

  it('resolves relative Bash write targets from the original cwd instead of the repo root', async () => {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-relative-cwd-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-relative-cwd-state-'))
    tempDirs.push(sandboxRoot, stateDir)

    const repoRoot = path.join(sandboxRoot, 'demo')
    const nestedCwd = path.join(repoRoot, 'src', 'features')
    const nestedFile = path.join(nestedCwd, 'local.ts')

    await fs.mkdir(path.join(repoRoot, '.git'), { recursive: true })
    await fs.mkdir(nestedCwd, { recursive: true })
    await fs.writeFile(path.join(repoRoot, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf-8')
    await fs.writeFile(nestedFile, 'export const before = 1;\n', 'utf-8')
    const canonicalRepoRoot = await fs.realpath(repoRoot)

    await buildCodexHookEvent({
      session_id: 'codex-relative-cwd-session',
      cwd: nestedCwd,
      hook_event_name: 'SessionStart',
      model: 'gpt-5.4',
      event_time: '2026-04-10T00:40:00.000Z',
    }, {
      stateDir,
    })

    await buildCodexHookEvent({
      session_id: 'codex-relative-cwd-session',
      cwd: nestedCwd,
      hook_event_name: 'PreToolUse',
      model: 'gpt-5.4',
      event_time: '2026-04-10T00:40:01.000Z',
      tool_name: 'Bash',
      tool_input: {
        command: 'touch local.ts',
      },
    }, {
      stateDir,
    })

    await fs.writeFile(nestedFile, 'export const before = 1;\nexport const after = 2;\n', 'utf-8')

    const event = await buildCodexHookEvent({
      session_id: 'codex-relative-cwd-session',
      cwd: nestedCwd,
      hook_event_name: 'PostToolUse',
      model: 'gpt-5.4',
      event_time: '2026-04-10T00:40:04.000Z',
      tool_name: 'Bash',
      tool_input: {
        command: 'touch local.ts',
      },
    }, {
      stateDir,
    })

    expect(event.project_root).toBe(canonicalRepoRoot)
    expect(event.file_deltas).toEqual([
      expect.objectContaining({
        language: 'TypeScript',
        added: 1,
        removed: 0,
      }),
    ])
  })

  it('keeps prompt-only user_prompt_submit events with shared project context and zero deltas', async () => {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-prompt-context-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-codex-prompt-context-state-'))
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

    const event = await buildCodexHookEvent({
      session_id: 'codex-prompt-only-session',
      cwd: worktreeRoot,
      hook_event_name: 'UserPromptSubmit',
      model: 'gpt-5.4',
      event_time: '2026-04-10T00:05:00.000Z',
    }, {
      stateDir,
    })

    expect(event.event_name).toBe('user_prompt_submit')
    expect(event.project_root).toBe(canonicalRepoRoot)
    expect(event.project_name).toBe('Clipulse')
    expect(event.git_branch).toBe('feat/v1-alpha')
    expect(event.file_deltas).toEqual([])
    expect(event.language_stats).toEqual({})
  })

})

async function expectBroadFallbackForCommand(
  command: string,
  tempPrefix: string,
): Promise<void> {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), tempPrefix))
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), `${tempPrefix}state-`))
  tempDirs.push(projectRoot, stateDir)

  const appFile = path.join(projectRoot, 'src', 'app.ts')
  const readmeFile = path.join(projectRoot, 'README.md')
  const tmpFile = path.join(projectRoot, 'tmp', 'targets.txt')
  const archiveFile = path.join(projectRoot, 'archive.zip')
  const generatedFile = path.join(projectRoot, 'src', 'generated.ts')
  await fs.mkdir(path.dirname(appFile), { recursive: true })
  await fs.mkdir(path.dirname(tmpFile), { recursive: true })
  await fs.writeFile(appFile, 'export const value = 1;\n', 'utf-8')
  await fs.writeFile(readmeFile, '# Demo\n', 'utf-8')
  await fs.writeFile(tmpFile, 'src/app.ts\nREADME.md\n', 'utf-8')
  await fs.writeFile(archiveFile, 'placeholder archive\n', 'utf-8')
  await fs.writeFile(generatedFile, 'export const generated = true;\n', 'utf-8')

  await buildCodexHookEvent({
    session_id: `${tempPrefix}session`,
    cwd: projectRoot,
    hook_event_name: 'SessionStart',
    model: 'gpt-5.4',
    event_time: '2026-04-08T15:00:00.000Z',
  }, {
    stateDir,
  })

  await fs.writeFile(appFile, 'export const value = 1;\nexport const next = 2;\n', 'utf-8')
  await fs.writeFile(readmeFile, '# Demo\n\nExtra line\n', 'utf-8')

  const event = await buildCodexHookEvent({
    session_id: `${tempPrefix}session`,
    cwd: projectRoot,
    hook_event_name: 'PostToolUse',
    model: 'gpt-5.4',
    event_time: '2026-04-08T15:00:05.000Z',
    tool_name: 'Bash',
    tool_input: {
      command,
    },
  }, {
    stateDir,
  })

  expect(event.file_deltas).toHaveLength(2)
  expect(event.file_deltas).toEqual(expect.arrayContaining([
    expect.objectContaining({ language: 'TypeScript', added: 1, removed: 0 }),
    expect.objectContaining({ language: 'Markdown', added: 2, removed: 0 }),
  ]))
}
