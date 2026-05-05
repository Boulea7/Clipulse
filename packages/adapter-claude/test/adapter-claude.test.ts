import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { createFileFingerprint, prepareOutboundBatch } from '@clipulse/collector-core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildClaudeHookEvent,
  getClaudeTranscriptStatePath,
  normalizeClaudeHookEvent,
  readClaudeTranscriptState,
  writeClaudeTranscriptState,
} from '../src/index.js'
import { runClaudeCli } from '../src/cli.js'

const tempDirs: string[] = []
const CLAUDE_SMOKE_STDIN_FIXTURE_PATH = new URL('./fixtures/smoke.stdin.json', import.meta.url)
const CLAUDE_SMOKE_TRANSCRIPT_FIXTURE_PATH = new URL('./fixtures/smoke.transcript.jsonl', import.meta.url)
const REPO_ROOT = new URL('../../../', import.meta.url)
const CLAUDE_DIST_CLI_PATH = path.resolve(REPO_ROOT.pathname, 'packages/adapter-claude/dist/cli.js')

async function readClaudeSmokeStdinFixture(): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(CLAUDE_SMOKE_STDIN_FIXTURE_PATH, 'utf-8')) as Record<string, unknown>
}

async function readClaudeSmokeTranscriptFixture(): Promise<string> {
  return fs.readFile(CLAUDE_SMOKE_TRANSCRIPT_FIXTURE_PATH, 'utf-8')
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true })
    }),
  )
})

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

function runClaudeCliProcess(
  rawInput: string,
  options: {
    env?: NodeJS.ProcessEnv
  } = {},
) {
  return spawnSync('node', [CLAUDE_DIST_CLI_PATH], {
    cwd: path.resolve(REPO_ROOT.pathname),
    env: {
      ...process.env,
      ...options.env,
    },
    encoding: 'utf8',
    input: rawInput,
  })
}

describe('adapter-claude', () => {
  it('normalizes a Claude hook event and transcript into a Clipulse event', () => {
    const input = {
      session_id: 'claude-session',
      transcript_path: '/tmp/transcript.jsonl',
      cwd: '/workspace/demo',
      hook_event_name: 'Stop',
      model: 'claude-sonnet-4',
    }

    const transcript = [
      JSON.stringify({
        timestamp: '2026-04-05T12:00:00Z',
        toolUseResult: {
          filePath: '/workspace/demo/src/app.ts',
          structuredPatch: [
            {
              oldStart: 1,
              oldLines: 1,
              newStart: 1,
              newLines: 2,
              lines: ['@@ -1 +1,2 @@', 'export const a = 1;', '+export const b = 2;'],
            },
          ],
        },
      }),
    ].join('\n')

    const normalized = normalizeClaudeHookEvent(input, transcript)

    expect(normalized.host).toBe('claude-code')
    expect(normalized.project_name).toBe('demo')
    expect(normalized.event_name).toBe('stop')
    expect(normalized.model_name).toBe('claude-sonnet-4')
    expect(normalized.file_deltas).toHaveLength(1)
    expect(normalized.language_stats.TypeScript.changed).toBe(1)
    expect(normalized.file_deltas[0].language).toBe('TypeScript')
  })

  it('falls back to stdout when no Clipulse API URL is configured', async () => {
    const stdoutWrite = vi.fn()

    await runClaudeCli({
      env: {},
      readStdin: async () => JSON.stringify({
        session_id: 'claude-session',
        transcript_path: '/tmp/transcript.jsonl',
        cwd: '/workspace/demo',
        hook_event_name: 'Stop',
        model: 'claude-sonnet-4',
      }),
      fileExists: async () => true,
      readFile: async (filePath) => {
        if (filePath === '/tmp/transcript.jsonl') {
          return JSON.stringify({
            timestamp: '2026-04-05T12:00:00Z',
            toolUseResult: {
              filePath: '/workspace/demo/src/app.ts',
              structuredPatch: [
                {
                  lines: ['@@ -1 +1,2 @@', '+export const b = 2;'],
                },
              ],
            },
          })
        }

        throw new Error(`unexpected read for ${filePath}`)
      },
      stdout: {
        write: stdoutWrite,
      },
    })

    expect(stdoutWrite).toHaveBeenCalledTimes(1)
    const output = String(stdoutWrite.mock.calls[0]?.[0])
    expect(output).toContain('"host":"claude-code"')
    expect(output).toContain('"session_id":"claude-session"')
    expect(output).toContain('"event_id":"')
    expect(output).not.toContain('/workspace/demo')
  })

  it('trims surrounding whitespace from session_id before stdout handoff', async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-claude-state-'))
    tempDirs.push(stateDir)
    const stdoutWrite = vi.fn()

    await runClaudeCli({
      env: {
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: '  claude-session  ',
        cwd: '/workspace/demo',
        hook_event_name: 'UserPromptSubmit',
        model: 'claude-sonnet-4',
        event_time: '2026-04-10T00:00:00Z',
      }),
      fileExists: async () => false,
      stdout: {
        write: stdoutWrite,
      },
    })

    expect(String(stdoutWrite.mock.calls[0]?.[0])).toContain('"session_id":"claude-session"')
  })

  it('keeps a tiny real-smoke Claude fixture aligned with the checked-in smoke contract', async () => {
    const fixture = await readClaudeSmokeStdinFixture()
    const transcript = await readClaudeSmokeTranscriptFixture()
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-claude-state-'))
    tempDirs.push(stateDir)

    const result = await buildClaudeHookEvent({
      session_id: String(fixture.session_id),
      transcript_path: '/tmp/claude-smoke.transcript.jsonl',
      cwd: String(fixture.cwd),
      hook_event_name: String(fixture.hook_event_name),
      model: String(fixture.model),
      event_time: String(fixture.event_time),
    }, transcript, {
      stateDir,
    })

    expect(fixture.session_id).toBe('claude-smoke-session')
    expect(fixture.cwd).toBe('/workspace/demo')
    expect(fixture.hook_event_name).toBe('PostToolUse')
    expect(fixture.model).toBe('claude-sonnet-4')
    expect(fixture.transcript_path).toBe('__SMOKE_TRANSCRIPT_PATH__')
    expect(result.event).toEqual(expect.objectContaining({
      event_name: 'post_tool_use',
      event_time: '2026-04-12T03:00:00Z',
      file_deltas: [
        expect.objectContaining({
          language: 'TypeScript',
          added: 1,
          removed: 0,
        }),
      ],
      language_stats: {
        TypeScript: {
          added: 1,
          removed: 0,
          changed: 1,
        },
      },
    }))
  })

  it('ships a checked-in Claude wiring example that keeps the documented cleanup hooks', async () => {
    const hooksPath = new URL('../hooks/hooks.json', import.meta.url)
    const hooksConfig = JSON.parse(await fs.readFile(hooksPath, 'utf-8'))
    const hookNames = Object.keys(hooksConfig.hooks ?? {})

    expect(hookNames).toEqual(expect.arrayContaining([
      'SessionStart',
      'UserPromptSubmit',
      'PreToolUse',
      'PostToolUse',
      'PostToolUseFailure',
      'Stop',
      'StopFailure',
      'SessionEnd',
      'PreCompact',
      'SubagentStop',
    ]))
  })

  it('passes the resolved stateDir through to deliverBatch', async () => {
    const deliverBatch = vi.fn().mockResolvedValue({
      delivered: true,
      buffered: false,
      flushed: 0,
    })

    await runClaudeCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_API_BEARER_TOKEN: 'stable-claude-token',
        CLIPULSE_STATE_DIR: '/tmp/clipulse-claude-state',
      },
      readStdin: async () => JSON.stringify({
        session_id: 'claude-session',
        cwd: '/workspace/demo',
        hook_event_name: 'UserPromptSubmit',
        model: 'claude-sonnet-4',
        event_time: '2026-04-10T00:00:00Z',
      }),
      deliverBatch,
      fileExists: async () => false,
    })

    expect(deliverBatch).toHaveBeenCalledWith(
      'http://localhost:8000',
      expect.objectContaining({
        events: [
          expect.objectContaining({
            event_name: 'user_prompt_submit',
          }),
        ],
      }),
      expect.objectContaining({
        apiBearerToken: 'stable-claude-token',
        stateDir: '/tmp/clipulse-claude-state',
      }),
    )
  })

  it('skips tracking when CLIPULSE_REQUIRE_PROJECT_FILE=1 and the project has no .clipulse-project', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-claude-project-file-'))
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-claude-project-file-state-'))
    tempDirs.push(projectRoot, stateDir)
    const stdoutWrite = vi.fn()
    const deliverBatch = vi.fn()

    await fs.mkdir(path.join(projectRoot, '.git'), { recursive: true })
    await fs.writeFile(path.join(projectRoot, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf-8')

    await runClaudeCli({
      env: {
        CLIPULSE_REQUIRE_PROJECT_FILE: '1',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'claude-session',
        cwd: projectRoot,
        hook_event_name: 'UserPromptSubmit',
        model: 'claude-sonnet-4',
        event_time: '2026-04-10T00:00:00Z',
      }),
      deliverBatch,
      fileExists: async () => false,
      stdout: {
        write: stdoutWrite,
      },
    })

    expect(stdoutWrite).not.toHaveBeenCalled()
    expect(deliverBatch).not.toHaveBeenCalled()
  })

  it('maps Claude failure and end hooks to snake_case event names', () => {
    const stopFailure = normalizeClaudeHookEvent({
      session_id: 'claude-session',
      cwd: '/workspace/demo',
      hook_event_name: 'StopFailure',
      model: 'claude-sonnet-4',
    }, '')

    const sessionEnd = normalizeClaudeHookEvent({
      session_id: 'claude-session',
      cwd: '/workspace/demo',
      hook_event_name: 'SessionEnd',
      model: 'claude-sonnet-4',
    }, '')

    expect(stopFailure.event_name).toBe('stop_failure')
    expect(sessionEnd.event_name).toBe('session_end')
  })

  it('filters structured patches that do not change any file lines', () => {
    const normalized = normalizeClaudeHookEvent({
      session_id: 'claude-session',
      cwd: '/workspace/demo',
      hook_event_name: 'PostToolUse',
      model: 'claude-sonnet-4',
    }, JSON.stringify({
      timestamp: '2026-04-06T12:05:00Z',
      toolUseResult: {
        filePath: '/workspace/demo/src/app.ts',
        structuredPatch: [
          {
            lines: ['--- a/src/app.ts', '+++ b/src/app.ts', '@@ -1 +1 @@'],
          },
        ],
      },
    }))

    expect(normalized.file_deltas).toEqual([])
  })

  it('drops repo-external transcript file paths from Claude file delta attribution', async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-claude-external-path-'))
    tempDirs.push(stateDir)

    const result = await buildClaudeHookEvent({
      session_id: 'claude-session',
      cwd: '/workspace/demo',
      hook_event_name: 'PostToolUse',
      model: 'claude-sonnet-4',
      event_time: '2026-04-12T03:00:00Z',
    }, JSON.stringify({
      timestamp: '2026-04-12T03:00:00Z',
      toolUseResult: {
        filePath: '/tmp/outside-demo.ts',
        structuredPatch: [
          {
            lines: ['@@ -1 +1,2 @@', '+export const leaked = true;'],
          },
        ],
      },
    }), {
      stateDir,
    })

    expect(result.event).toBeNull()
  })

  it('only reports new transcript entries after a successful previous send', async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-claude-state-'))
    const transcriptDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-claude-transcript-'))
    tempDirs.push(stateDir, transcriptDir)

    const transcriptPath = path.join(transcriptDir, 'session.jsonl')
    const deliverBatch = vi.fn().mockResolvedValue({
      delivered: true,
      buffered: false,
      flushed: 0,
    })

    await fs.writeFile(
      transcriptPath,
      [
        JSON.stringify({
          timestamp: '2026-04-06T12:00:00Z',
          toolUseResult: {
            filePath: '/workspace/demo/src/app.ts',
            structuredPatch: [
              {
                lines: ['@@ -1 +1,2 @@', '+export const first = 1;'],
              },
            ],
          },
        }),
      ].join('\n'),
      'utf-8',
    )

    await runClaudeCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'claude-session',
        transcript_path: transcriptPath,
        cwd: '/workspace/demo',
        hook_event_name: 'PostToolUse',
        model: 'claude-sonnet-4',
        event_time: '2026-04-06T12:00:01Z',
      }),
      deliverBatch,
    })

    await fs.appendFile(
      transcriptPath,
      `\n${JSON.stringify({
        timestamp: '2026-04-06T12:00:10Z',
        toolUseResult: {
          filePath: '/workspace/demo/src/app.ts',
          structuredPatch: [
            {
              lines: ['@@ -2 +2,2 @@', '+export const second = 2;'],
            },
          ],
        },
      })}`,
      'utf-8',
    )

    await runClaudeCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'claude-session',
        transcript_path: transcriptPath,
        cwd: '/workspace/demo',
        hook_event_name: 'PostToolUse',
        model: 'claude-sonnet-4',
        event_time: '2026-04-06T12:00:11Z',
      }),
      deliverBatch,
    })

    expect(deliverBatch).toHaveBeenCalledTimes(2)
    expect(deliverBatch.mock.calls[0]?.[1]).toEqual({
      events: [
        expect.objectContaining({
          language_stats: {
            TypeScript: expect.objectContaining({ changed: 1 }),
          },
        }),
      ],
    })
    expect(deliverBatch.mock.calls[1]?.[1]).toEqual({
      events: [
        expect.objectContaining({
          language_stats: {
            TypeScript: expect.objectContaining({ changed: 1 }),
          },
        }),
      ],
    })
  })

  it('does not advance incremental state when delivery throws', async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-claude-state-'))
    const transcriptDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-claude-transcript-'))
    tempDirs.push(stateDir, transcriptDir)

    const transcriptPath = path.join(transcriptDir, 'session.jsonl')
    await fs.writeFile(
      transcriptPath,
      JSON.stringify({
        timestamp: '2026-04-06T12:10:00Z',
        toolUseResult: {
          filePath: '/workspace/demo/src/app.ts',
          structuredPatch: [
            {
              lines: ['@@ -1 +1,2 @@', '+export const retry = true;'],
            },
          ],
        },
      }),
      'utf-8',
    )

    await expect(runClaudeCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'claude-session',
        transcript_path: transcriptPath,
        cwd: '/workspace/demo',
        hook_event_name: 'PostToolUse',
        model: 'claude-sonnet-4',
        event_time: '2026-04-06T12:10:01Z',
      }),
      deliverBatch: vi.fn().mockRejectedValue(new Error('offline')),
    })).rejects.toThrow('offline')

    const retryDeliverBatch = vi.fn().mockResolvedValue({
      delivered: true,
      buffered: false,
      flushed: 0,
    })

    await runClaudeCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'claude-session',
        transcript_path: transcriptPath,
        cwd: '/workspace/demo',
        hook_event_name: 'PostToolUse',
        model: 'claude-sonnet-4',
        event_time: '2026-04-06T12:10:03Z',
      }),
      deliverBatch: retryDeliverBatch,
    })

    expect(retryDeliverBatch).toHaveBeenCalledTimes(1)
    expect(retryDeliverBatch.mock.calls[0]?.[1]).toEqual({
      events: [
        expect.objectContaining({
          language_stats: {
            TypeScript: expect.objectContaining({ changed: 1 }),
          },
        }),
      ],
    })
  })

  it('retries the same post_tool_use_failure with the original wait gap after delivery fails', async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-claude-state-'))
    tempDirs.push(stateDir)

    await runClaudeCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'claude-session',
        cwd: '/workspace/demo',
        hook_event_name: 'PreToolUse',
        model: 'claude-sonnet-4',
        event_time: '2026-04-06T12:11:00Z',
      }),
      deliverBatch: vi.fn(),
      fileExists: async () => false,
    })

    await expect(runClaudeCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'claude-session',
        cwd: '/workspace/demo',
        hook_event_name: 'PostToolUseFailure',
        model: 'claude-sonnet-4',
        event_time: '2026-04-06T12:11:05Z',
      }),
      deliverBatch: vi.fn().mockRejectedValue(new Error('offline')),
      fileExists: async () => false,
    })).rejects.toThrow('offline')

    const retryDeliverBatch = vi.fn().mockResolvedValue({
      delivered: true,
      buffered: false,
      flushed: 0,
    })

    await runClaudeCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'claude-session',
        cwd: '/workspace/demo',
        hook_event_name: 'PostToolUseFailure',
        model: 'claude-sonnet-4',
        event_time: '2026-04-06T12:11:05Z',
      }),
      deliverBatch: retryDeliverBatch,
      fileExists: async () => false,
    })

    expect(retryDeliverBatch).toHaveBeenCalledTimes(1)
    expect(retryDeliverBatch.mock.calls[0]?.[1]).toEqual({
      events: [
        expect.objectContaining({
          event_name: 'post_tool_use_failure',
          active_ms: 0,
          wait_ms: 5_000,
          file_deltas: [],
        }),
      ],
    })
  })

  it('advances local transcript state after a buffered post_tool_use_failure handoff', async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-claude-state-'))
    tempDirs.push(stateDir)

    await runClaudeCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'claude-session',
        cwd: '/workspace/demo',
        hook_event_name: 'PreToolUse',
        model: 'claude-sonnet-4',
        event_time: '2026-04-06T12:11:00Z',
      }),
      deliverBatch: vi.fn(),
      fileExists: async () => false,
    })

    const bufferedDeliverBatch = vi.fn().mockResolvedValue({
      delivered: false,
      buffered: true,
      flushed: 0,
    })

    await runClaudeCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'claude-session',
        cwd: '/workspace/demo',
        hook_event_name: 'PostToolUseFailure',
        model: 'claude-sonnet-4',
        event_time: '2026-04-06T12:11:05Z',
      }),
      deliverBatch: bufferedDeliverBatch,
      fileExists: async () => false,
    })

    const persistedState = await readClaudeTranscriptState(stateDir, {
      session_id: 'claude-session',
      cwd: '/workspace/demo',
      hook_event_name: 'PostToolUseFailure',
    })
    const retryDeliverBatch = vi.fn()

    await runClaudeCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'claude-session',
        cwd: '/workspace/demo',
        hook_event_name: 'PostToolUseFailure',
        model: 'claude-sonnet-4',
        event_time: '2026-04-06T12:11:05Z',
      }),
      deliverBatch: retryDeliverBatch,
      fileExists: async () => false,
    })

    expect(bufferedDeliverBatch).toHaveBeenCalledTimes(1)
    expect(bufferedDeliverBatch.mock.calls[0]?.[1]).toEqual({
      events: [
        expect.objectContaining({
          event_name: 'post_tool_use_failure',
          wait_ms: 5_000,
        }),
      ],
    })
    expect(persistedState).toEqual(expect.objectContaining({
      lastSubmittedAt: '2026-04-06T12:11:05Z',
      lastActivityAt: '2026-04-06T12:11:05Z',
      pendingToolStartedAt: undefined,
    }))
    expect(retryDeliverBatch).not.toHaveBeenCalled()
  })

  it('rebuilds the transcript baseline when the transcript shrinks', async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-claude-state-'))
    const transcriptDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-claude-transcript-'))
    tempDirs.push(stateDir, transcriptDir)

    const transcriptPath = path.join(transcriptDir, 'session.jsonl')
    const deliverBatch = vi.fn().mockResolvedValue({
      delivered: true,
      buffered: false,
      flushed: 0,
    })

    await fs.writeFile(
      transcriptPath,
      [
        JSON.stringify({
          timestamp: '2026-04-06T12:12:00Z',
          toolUseResult: {
            filePath: '/workspace/demo/src/app.ts',
            structuredPatch: [{ lines: ['@@ -1 +1,2 @@', '+export const first = 1;'] }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-04-06T12:12:05Z',
          toolUseResult: {
            filePath: '/workspace/demo/src/app.ts',
            structuredPatch: [{ lines: ['@@ -2 +2,2 @@', '+export const second = 2;'] }],
          },
        }),
      ].join('\n'),
      'utf-8',
    )

    await runClaudeCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'claude-session',
        transcript_path: transcriptPath,
        cwd: '/workspace/demo',
        hook_event_name: 'PostToolUse',
        model: 'claude-sonnet-4',
        event_time: '2026-04-06T12:12:06Z',
      }),
      deliverBatch,
    })

    await fs.writeFile(
      transcriptPath,
      JSON.stringify({
        timestamp: '2026-04-06T12:13:00Z',
        toolUseResult: {
          filePath: '/workspace/demo/src/reset.ts',
          structuredPatch: [{ lines: ['@@ -1 +1,2 @@', '+export const reset = true;'] }],
        },
      }),
      'utf-8',
    )

    await runClaudeCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'claude-session',
        transcript_path: transcriptPath,
        cwd: '/workspace/demo',
        hook_event_name: 'PostToolUse',
        model: 'claude-sonnet-4',
        event_time: '2026-04-06T12:13:01Z',
      }),
      deliverBatch,
    })

    expect(deliverBatch).toHaveBeenCalledTimes(2)
    expect(deliverBatch.mock.calls[1]?.[1]).toEqual({
      events: [
        expect.objectContaining({
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

  it('reads legacy Claude transcript state files without schema metadata', async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-claude-state-'))
    const transcriptDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-claude-transcript-'))
    tempDirs.push(stateDir, transcriptDir)

    const transcriptPath = path.join(transcriptDir, 'session.jsonl')
    const input = {
      session_id: 'claude-session',
      transcript_path: transcriptPath,
      cwd: '/workspace/demo',
      hook_event_name: 'PostToolUse',
      model: 'claude-sonnet-4',
      event_time: '2026-04-06T12:14:01Z',
    }
    const statePath = getClaudeTranscriptStatePath(stateDir, input)
    const deliverBatch = vi.fn().mockResolvedValue({
      delivered: true,
      buffered: false,
      flushed: 0,
    })

    await fs.mkdir(path.dirname(statePath), { recursive: true })
    await fs.writeFile(
      statePath,
      JSON.stringify({
        lineCount: 1,
        lastSubmittedAt: '2026-04-06T12:14:00Z',
      }),
      'utf-8',
    )
    await fs.writeFile(
      transcriptPath,
      [
        JSON.stringify({
          timestamp: '2026-04-06T12:14:00Z',
          toolUseResult: {
            filePath: '/workspace/demo/src/app.ts',
            structuredPatch: [{ lines: ['@@ -1 +1,2 @@', '+export const first = 1;'] }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-04-06T12:14:01Z',
          toolUseResult: {
            filePath: '/workspace/demo/src/app.ts',
            structuredPatch: [{ lines: ['@@ -2 +2,2 @@', '+export const second = 2;'] }],
          },
        }),
      ].join('\n'),
      'utf-8',
    )

    await runClaudeCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify(input),
      deliverBatch,
    })

    expect(deliverBatch).toHaveBeenCalledTimes(1)
    expect(deliverBatch.mock.calls[0]?.[1]).toEqual({
      events: [
        expect.objectContaining({
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

  it('skips empty pre_tool_use events without transcript changes', async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-claude-state-'))
    tempDirs.push(stateDir)

    const deliverBatch = vi.fn().mockResolvedValue({
      delivered: true,
      buffered: false,
      flushed: 0,
    })

    await runClaudeCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'claude-session',
        cwd: '/workspace/demo',
        hook_event_name: 'PreToolUse',
        model: 'claude-sonnet-4',
        event_time: '2026-04-06T12:15:00Z',
      }),
      deliverBatch,
      fileExists: async () => false,
    })

    expect(deliverBatch).not.toHaveBeenCalled()
  })

  it('keeps an empty post_tool_use event when it closes out wait time', async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-claude-state-'))
    tempDirs.push(stateDir)

    const preToolUse = await buildClaudeHookEvent({
      session_id: 'claude-session',
      cwd: '/workspace/demo',
      hook_event_name: 'PreToolUse',
      model: 'claude-sonnet-4',
      event_time: '2026-04-06T12:16:00Z',
    }, '', {
      stateDir,
    })

    const postToolUse = await buildClaudeHookEvent({
      session_id: 'claude-session',
      cwd: '/workspace/demo',
      hook_event_name: 'PostToolUse',
      model: 'claude-sonnet-4',
      event_time: '2026-04-06T12:16:05Z',
    }, '', {
      stateDir,
      previousState: preToolUse.nextState,
    })

    expect(preToolUse.event).toBeNull()
    expect(postToolUse.event).toEqual(expect.objectContaining({
      event_name: 'post_tool_use',
      wait_ms: 5_000,
      file_deltas: [],
    }))
  })

  it('keeps pending wait state across interleaved non-tool events until post_tool_use closes it', async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-claude-state-'))
    tempDirs.push(stateDir)

    const preToolUse = await buildClaudeHookEvent({
      session_id: 'claude-session',
      cwd: '/workspace/demo',
      hook_event_name: 'PreToolUse',
      model: 'claude-sonnet-4',
      event_time: '2026-04-06T12:16:00Z',
    }, '', {
      stateDir,
    })

    const interleavedPrompt = await buildClaudeHookEvent({
      session_id: 'claude-session',
      cwd: '/workspace/demo',
      hook_event_name: 'UserPromptSubmit',
      model: 'claude-sonnet-4',
      event_time: '2026-04-06T12:16:02Z',
    }, '', {
      stateDir,
      previousState: preToolUse.nextState,
    })

    const postToolUse = await buildClaudeHookEvent({
      session_id: 'claude-session',
      cwd: '/workspace/demo',
      hook_event_name: 'PostToolUse',
      model: 'claude-sonnet-4',
      event_time: '2026-04-06T12:16:05Z',
    }, '', {
      stateDir,
      previousState: interleavedPrompt.nextState,
    })

    expect(preToolUse.event).toBeNull()
    expect(interleavedPrompt.event).toEqual(expect.objectContaining({
      event_name: 'user_prompt_submit',
      active_ms: 2_000,
      wait_ms: 0,
      file_deltas: [],
    }))
    expect(postToolUse.event).toEqual(expect.objectContaining({
      event_name: 'post_tool_use',
      wait_ms: 5_000,
      file_deltas: [],
    }))
  })

  it('reuses transcript cursor state across equivalent repo-root and nested cwd inputs', async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-claude-state-'))
    const transcriptDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-claude-transcript-'))
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-claude-repo-'))
    tempDirs.push(stateDir, transcriptDir, sandboxRoot)

    const repoRoot = path.join(sandboxRoot, 'Clipulse')
    const nestedCwd = path.join(repoRoot, 'packages', 'adapter-claude')
    const gitDir = path.join(repoRoot, '.git')
    const transcriptPath = path.join(transcriptDir, 'session.jsonl')
    const deliverBatch = vi.fn().mockResolvedValue({
      delivered: true,
      buffered: false,
      flushed: 0,
    })

    await fs.mkdir(nestedCwd, { recursive: true })
    await fs.mkdir(gitDir, { recursive: true })
    await fs.writeFile(path.join(gitDir, 'HEAD'), 'ref: refs/heads/feat/v1-alpha\n', 'utf-8')
    await fs.writeFile(
      transcriptPath,
      JSON.stringify({
        timestamp: '2026-04-06T12:18:00Z',
        toolUseResult: {
          filePath: path.join(repoRoot, 'src', 'app.ts'),
          structuredPatch: [{ lines: ['@@ -1 +1,2 @@', '+export const first = 1;'] }],
        },
      }),
      'utf-8',
    )

    await runClaudeCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'claude-session',
        transcript_path: transcriptPath,
        cwd: nestedCwd,
        hook_event_name: 'PostToolUse',
        model: 'claude-sonnet-4',
        event_time: '2026-04-06T12:18:01Z',
      }),
      deliverBatch,
    })

    await runClaudeCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'claude-session',
        transcript_path: transcriptPath,
        cwd: repoRoot,
        hook_event_name: 'PostToolUse',
        model: 'claude-sonnet-4',
        event_time: '2026-04-06T12:18:01Z',
      }),
      deliverBatch,
    })

    expect(deliverBatch).toHaveBeenCalledTimes(1)
  })

  it('resets transcript cursor state on pre_compact before the next transcript pass', async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-claude-state-'))
    const transcriptDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-claude-transcript-'))
    tempDirs.push(stateDir, transcriptDir)

    const transcriptPath = path.join(transcriptDir, 'session.jsonl')
    const deliverBatch = vi.fn().mockResolvedValue({
      delivered: true,
      buffered: false,
      flushed: 0,
    })

    await fs.writeFile(
      transcriptPath,
      JSON.stringify({
        timestamp: '2026-04-06T12:20:00Z',
        toolUseResult: {
          filePath: '/workspace/demo/src/app.ts',
          structuredPatch: [{ lines: ['@@ -1 +1,2 @@', '+export const first = 1;'] }],
        },
      }),
      'utf-8',
    )

    await runClaudeCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'claude-session',
        transcript_path: transcriptPath,
        cwd: '/workspace/demo',
        hook_event_name: 'PostToolUse',
        model: 'claude-sonnet-4',
        event_time: '2026-04-06T12:20:01Z',
      }),
      deliverBatch,
    })

    await runClaudeCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'claude-session',
        transcript_path: transcriptPath,
        cwd: '/workspace/demo',
        hook_event_name: 'PreCompact',
        model: 'claude-sonnet-4',
        event_time: '2026-04-06T12:20:05Z',
      }),
      deliverBatch,
    })

    await fs.writeFile(
      transcriptPath,
      JSON.stringify({
        timestamp: '2026-04-06T12:21:00Z',
        toolUseResult: {
          filePath: '/workspace/demo/src/after-compact.ts',
          structuredPatch: [{ lines: ['@@ -1 +1,2 @@', '+export const compact = true;'] }],
        },
      }),
      'utf-8',
    )

    await runClaudeCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'claude-session',
        transcript_path: transcriptPath,
        cwd: '/workspace/demo',
        hook_event_name: 'PostToolUse',
        model: 'claude-sonnet-4',
        event_time: '2026-04-06T12:21:01Z',
      }),
      deliverBatch,
    })

    expect(deliverBatch).toHaveBeenCalledTimes(3)
    expect(deliverBatch.mock.calls[1]?.[1]).toEqual({
      events: [
        expect.objectContaining({
          event_name: 'pre_compact',
        }),
      ],
    })
    expect(deliverBatch.mock.calls[2]?.[1]).toEqual({
      events: [
        expect.objectContaining({
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

  it('keeps a project-level activity event for prompt submits without file changes', async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-claude-state-'))
    tempDirs.push(stateDir)
    const stdoutWrite = vi.fn()

    await runClaudeCli({
      env: {
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'claude-session',
        cwd: '/workspace/demo',
        hook_event_name: 'UserPromptSubmit',
        model: 'claude-sonnet-4',
        event_time: '2026-04-06T12:20:00Z',
      }),
      fileExists: async () => false,
      stdout: {
        write: stdoutWrite,
      },
    })

    expect(stdoutWrite).toHaveBeenCalledTimes(1)
    expect(String(stdoutWrite.mock.calls[0]?.[0])).toContain('"event_name":"user_prompt_submit"')
    expect(String(stdoutWrite.mock.calls[0]?.[0])).toContain('"file_deltas":[]')
  })

  it('skips repeated empty session_start events inside the debounce window', async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-claude-state-'))
    tempDirs.push(stateDir)

    const deliverBatch = vi.fn().mockResolvedValue({
      delivered: true,
      buffered: false,
      flushed: 0,
    })

    await runClaudeCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'claude-session',
        cwd: '/workspace/demo',
        hook_event_name: 'SessionStart',
        model: 'claude-sonnet-4',
        event_time: '2026-04-06T12:30:00Z',
      }),
      deliverBatch,
      fileExists: async () => false,
    })

    await runClaudeCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'claude-session',
        cwd: '/workspace/demo',
        hook_event_name: 'SessionStart',
        model: 'claude-sonnet-4',
        event_time: '2026-04-06T12:30:05Z',
      }),
      deliverBatch,
      fileExists: async () => false,
    })

    expect(deliverBatch).toHaveBeenCalledTimes(1)
  })

  it('debounces noisy empty events per event name instead of suppressing different event types', async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-claude-state-'))
    tempDirs.push(stateDir)

    const deliverBatch = vi.fn().mockResolvedValue({
      delivered: true,
      buffered: false,
      flushed: 0,
    })

    await runClaudeCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'claude-session',
        cwd: '/workspace/demo',
        hook_event_name: 'SessionStart',
        model: 'claude-sonnet-4',
        event_time: '2026-04-06T12:31:00Z',
      }),
      deliverBatch,
      fileExists: async () => false,
    })

    await runClaudeCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'claude-session',
        cwd: '/workspace/demo',
        hook_event_name: 'SubagentStart',
        model: 'claude-sonnet-4',
        event_time: '2026-04-06T12:31:05Z',
      }),
      deliverBatch,
      fileExists: async () => false,
    })

    await runClaudeCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'claude-session',
        cwd: '/workspace/demo',
        hook_event_name: 'SessionStart',
        model: 'claude-sonnet-4',
        event_time: '2026-04-06T12:31:10Z',
      }),
      deliverBatch,
      fileExists: async () => false,
    })

    expect(deliverBatch).toHaveBeenCalledTimes(2)
    expect(deliverBatch.mock.calls[0]?.[1]).toEqual({
      events: [
        expect.objectContaining({
          event_name: 'session_start',
        }),
      ],
    })
    expect(deliverBatch.mock.calls[1]?.[1]).toEqual({
      events: [
        expect.objectContaining({
          event_name: 'subagent_start',
        }),
      ],
    })
  })

  it('rebuilds transcript state when the transcript content rotates without shrinking', async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-claude-state-'))
    const transcriptDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-claude-transcript-'))
    tempDirs.push(stateDir, transcriptDir)

    const transcriptPath = path.join(transcriptDir, 'session.jsonl')
    const deliverBatch = vi.fn().mockResolvedValue({
      delivered: true,
      buffered: false,
      flushed: 0,
    })

    await fs.writeFile(
      transcriptPath,
      JSON.stringify({
        timestamp: '2026-04-06T12:50:00Z',
        toolUseResult: {
          filePath: '/workspace/demo/src/first.ts',
          structuredPatch: [{ lines: ['@@ -1 +1,2 @@', '+export const first = true;'] }],
        },
      }),
      'utf-8',
    )

    await runClaudeCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'claude-session',
        transcript_path: transcriptPath,
        cwd: '/workspace/demo',
        hook_event_name: 'PostToolUse',
        model: 'claude-sonnet-4',
        event_time: '2026-04-06T12:50:01Z',
      }),
      deliverBatch,
    })

    await fs.writeFile(
      transcriptPath,
      JSON.stringify({
        timestamp: '2026-04-06T12:51:00Z',
        toolUseResult: {
          filePath: '/workspace/demo/src/rotated.ts',
          structuredPatch: [{ lines: ['@@ -1 +1,2 @@', '+export const rotated = true;'] }],
        },
      }),
      'utf-8',
    )

    await runClaudeCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'claude-session',
        transcript_path: transcriptPath,
        cwd: '/workspace/demo',
        hook_event_name: 'PostToolUse',
        model: 'claude-sonnet-4',
        event_time: '2026-04-06T12:51:01Z',
      }),
      deliverBatch,
    })

    expect(deliverBatch).toHaveBeenCalledTimes(2)
    expect(deliverBatch.mock.calls[1]?.[1]).toEqual({
      events: [
        expect.objectContaining({
          file_deltas: [
            expect.objectContaining({
              fingerprint: expect.any(String),
              language: 'TypeScript',
              added: 1,
              removed: 0,
            }),
          ],
        }),
      ],
    })
  })

  it('does not replay the last valid entry when a trailing partial transcript line is later completed', async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-claude-state-'))
    const transcriptDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-claude-transcript-'))
    tempDirs.push(stateDir, transcriptDir)

    const transcriptPath = path.join(transcriptDir, 'session.jsonl')
    const deliverBatch = vi.fn().mockResolvedValue({
      delivered: true,
      buffered: false,
      flushed: 0,
    })

    await fs.writeFile(
      transcriptPath,
      [
        JSON.stringify({
          timestamp: '2026-04-06T12:52:00Z',
          toolUseResult: {
            filePath: '/workspace/demo/src/first.ts',
            structuredPatch: [{ lines: ['@@ -1 +1,2 @@', '+export const first = true;'] }],
          },
        }),
        '{"timestamp":"2026-04-06T12:52:05Z"',
      ].join('\n'),
      'utf-8',
    )

    const baseInput = {
      session_id: 'claude-session',
      transcript_path: transcriptPath,
      cwd: '/workspace/demo',
      hook_event_name: 'PostToolUse',
      model: 'claude-sonnet-4',
    }

    await runClaudeCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        ...baseInput,
        event_time: '2026-04-06T12:52:06Z',
      }),
      deliverBatch,
    })

    await fs.writeFile(
      transcriptPath,
      [
        JSON.stringify({
          timestamp: '2026-04-06T12:52:00Z',
          toolUseResult: {
            filePath: '/workspace/demo/src/first.ts',
            structuredPatch: [{ lines: ['@@ -1 +1,2 @@', '+export const first = true;'] }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-04-06T12:52:05Z',
          toolUseResult: {
            filePath: '/workspace/demo/src/second.ts',
            structuredPatch: [{ lines: ['@@ -1 +1,2 @@', '+export const second = true;'] }],
          },
        }),
      ].join('\n'),
      'utf-8',
    )

    await runClaudeCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        ...baseInput,
        event_time: '2026-04-06T12:52:07Z',
      }),
      deliverBatch,
    })

    expect(deliverBatch).toHaveBeenCalledTimes(2)
    expect(deliverBatch.mock.calls[1]?.[1]).toEqual({
      events: [
        expect.objectContaining({
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
    expect(deliverBatch.mock.calls[1]?.[1]).not.toEqual({
      events: [
        expect.objectContaining({
          file_deltas: expect.arrayContaining([
            expect.objectContaining({
              fingerprint: createFileFingerprint('/workspace/demo/src/first.ts', '/workspace/demo'),
            }),
          ]),
        }),
      ],
    })
  })

  it('only emits newly appended valid transcript entries once when invalid middle lines remain', async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-claude-state-'))
    const transcriptDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-claude-transcript-'))
    tempDirs.push(stateDir, transcriptDir)

    const transcriptPath = path.join(transcriptDir, 'session.jsonl')
    const deliverBatch = vi.fn().mockResolvedValue({
      delivered: true,
      buffered: false,
      flushed: 0,
    })

    const baseInput = {
      session_id: 'claude-session',
      transcript_path: transcriptPath,
      cwd: '/workspace/demo',
      hook_event_name: 'PostToolUse',
      model: 'claude-sonnet-4',
    }

    await fs.writeFile(
      transcriptPath,
      [
        JSON.stringify({
          timestamp: '2026-04-06T12:53:00Z',
          toolUseResult: {
            filePath: '/workspace/demo/src/first.ts',
            structuredPatch: [{ lines: ['@@ -1 +1,2 @@', '+export const first = true;'] }],
          },
        }),
        '{"timestamp":"2026-04-06T12:53:03Z"',
        JSON.stringify({
          timestamp: '2026-04-06T12:53:05Z',
          toolUseResult: {
            filePath: '/workspace/demo/src/third.ts',
            structuredPatch: [{ lines: ['@@ -1 +1,2 @@', '+export const third = true;'] }],
          },
        }),
      ].join('\n'),
      'utf-8',
    )

    await runClaudeCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        ...baseInput,
        event_time: '2026-04-06T12:53:06Z',
      }),
      deliverBatch,
    })

    await fs.writeFile(
      transcriptPath,
      [
        JSON.stringify({
          timestamp: '2026-04-06T12:53:00Z',
          toolUseResult: {
            filePath: '/workspace/demo/src/first.ts',
            structuredPatch: [{ lines: ['@@ -1 +1,2 @@', '+export const first = true;'] }],
          },
        }),
        '{"timestamp":"2026-04-06T12:53:03Z"',
        JSON.stringify({
          timestamp: '2026-04-06T12:53:05Z',
          toolUseResult: {
            filePath: '/workspace/demo/src/third.ts',
            structuredPatch: [{ lines: ['@@ -1 +1,2 @@', '+export const third = true;'] }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-04-06T12:53:08Z',
          toolUseResult: {
            filePath: '/workspace/demo/src/fourth.ts',
            structuredPatch: [{ lines: ['@@ -1 +1,2 @@', '+export const fourth = true;'] }],
          },
        }),
      ].join('\n'),
      'utf-8',
    )

    await runClaudeCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        ...baseInput,
        event_time: '2026-04-06T12:53:09Z',
      }),
      deliverBatch,
    })

    expect(deliverBatch).toHaveBeenCalledTimes(2)
    expect(deliverBatch.mock.calls[1]?.[1]).toEqual({
      events: [
        expect.objectContaining({
          file_deltas: [
            expect.objectContaining({
              fingerprint: createFileFingerprint('/workspace/demo/src/fourth.ts', '/workspace/demo'),
              language: 'TypeScript',
              added: 1,
              removed: 0,
            }),
          ],
        }),
      ],
    })
  })

  it('captures a recovered middle transcript entry without replaying later valid entries', async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-claude-state-'))
    const transcriptDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-claude-transcript-'))
    tempDirs.push(stateDir, transcriptDir)

    const transcriptPath = path.join(transcriptDir, 'session.jsonl')
    const deliverBatch = vi.fn().mockResolvedValue({
      delivered: true,
      buffered: false,
      flushed: 0,
    })

    const baseInput = {
      session_id: 'claude-session',
      transcript_path: transcriptPath,
      cwd: '/workspace/demo',
      hook_event_name: 'PostToolUse',
      model: 'claude-sonnet-4',
    }

    await fs.writeFile(
      transcriptPath,
      [
        JSON.stringify({
          timestamp: '2026-04-06T12:54:00Z',
          toolUseResult: {
            filePath: '/workspace/demo/src/first.ts',
            structuredPatch: [{ lines: ['@@ -1 +1,2 @@', '+export const first = true;'] }],
          },
        }),
        '{"timestamp":"2026-04-06T12:54:03Z"',
        JSON.stringify({
          timestamp: '2026-04-06T12:54:05Z',
          toolUseResult: {
            filePath: '/workspace/demo/src/third.ts',
            structuredPatch: [{ lines: ['@@ -1 +1,2 @@', '+export const third = true;'] }],
          },
        }),
      ].join('\n'),
      'utf-8',
    )

    await runClaudeCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        ...baseInput,
        event_time: '2026-04-06T12:54:06Z',
      }),
      deliverBatch,
    })

    await fs.writeFile(
      transcriptPath,
      [
        JSON.stringify({
          timestamp: '2026-04-06T12:54:00Z',
          toolUseResult: {
            filePath: '/workspace/demo/src/first.ts',
            structuredPatch: [{ lines: ['@@ -1 +1,2 @@', '+export const first = true;'] }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-04-06T12:54:03Z',
          toolUseResult: {
            filePath: '/workspace/demo/src/second.ts',
            structuredPatch: [{ lines: ['@@ -1 +1,2 @@', '+export const second = true;'] }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-04-06T12:54:05Z',
          toolUseResult: {
            filePath: '/workspace/demo/src/third.ts',
            structuredPatch: [{ lines: ['@@ -1 +1,2 @@', '+export const third = true;'] }],
          },
        }),
      ].join('\n'),
      'utf-8',
    )

    await runClaudeCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        ...baseInput,
        event_time: '2026-04-06T12:54:07Z',
      }),
      deliverBatch,
    })

    expect(deliverBatch).toHaveBeenCalledTimes(2)
    expect(deliverBatch.mock.calls[1]?.[1]).toEqual({
      events: [
        expect.objectContaining({
          file_deltas: [
            expect.objectContaining({
              fingerprint: createFileFingerprint('/workspace/demo/src/second.ts', '/workspace/demo'),
              language: 'TypeScript',
              added: 1,
              removed: 0,
            }),
          ],
        }),
      ],
    })
    expect(deliverBatch.mock.calls[1]?.[1]).not.toEqual({
      events: [
        expect.objectContaining({
          file_deltas: expect.arrayContaining([
            expect.objectContaining({
              fingerprint: createFileFingerprint('/workspace/demo/src/third.ts', '/workspace/demo'),
            }),
          ]),
        }),
      ],
    })
  })

  it('skips empty post_tool_use events without transcript changes or timing signal', async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-claude-state-'))
    tempDirs.push(stateDir)

    const deliverBatch = vi.fn().mockResolvedValue({
      delivered: true,
      buffered: false,
      flushed: 0,
    })

    await runClaudeCli({
      env: {
        CLIPULSE_API_URL: 'http://localhost:8000',
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'claude-session',
        cwd: '/workspace/demo',
        hook_event_name: 'PostToolUse',
        model: 'claude-sonnet-4',
        event_time: '2026-04-06T12:52:00Z',
      }),
      deliverBatch,
      fileExists: async () => false,
    })

    expect(deliverBatch).not.toHaveBeenCalled()
  })

  it.each(['Stop', 'SessionEnd', 'PreCompact'])(
    'clears transcript state for all transcript_path variants on %s',
    async (hookEventName) => {
      const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-claude-state-'))
      tempDirs.push(stateDir)

      const baseInput = {
        session_id: 'claude-session',
        cwd: '/workspace/demo',
      }
      const transcriptA = '/tmp/transcript-a.jsonl'
      const transcriptB = '/tmp/transcript-b.jsonl'
      const inputA = { ...baseInput, transcript_path: transcriptA }
      const inputB = { ...baseInput, transcript_path: transcriptB }
      const statePathA = getClaudeTranscriptStatePath(stateDir, inputA)
      const statePathB = getClaudeTranscriptStatePath(stateDir, inputB)

      await writeClaudeTranscriptState(stateDir, inputA, {
        lineCount: 2,
        lastSubmittedAt: '2026-04-06T12:40:00Z',
      })
      await writeClaudeTranscriptState(stateDir, inputB, {
        lineCount: 4,
        lastSubmittedAt: '2026-04-06T12:40:05Z',
      })

      expect(await pathExists(statePathA)).toBe(true)
      expect(await pathExists(statePathB)).toBe(true)

      await runClaudeCli({
        env: {
          CLIPULSE_STATE_DIR: stateDir,
        },
        readStdin: async () => JSON.stringify({
          ...inputA,
          hook_event_name: hookEventName,
          model: 'claude-sonnet-4',
          event_time: '2026-04-06T12:41:00Z',
        }),
        fileExists: async () => false,
        stdout: {
          write: vi.fn(),
        },
      })

      expect(await pathExists(statePathA)).toBe(false)
      expect(await pathExists(statePathB)).toBe(false)
    },
  )

  it('does not advance transcript state when stdout handoff throws for post_tool_use_failure', async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-claude-state-'))
    tempDirs.push(stateDir)

    await runClaudeCli({
      env: {
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'claude-session',
        cwd: '/workspace/demo',
        hook_event_name: 'PreToolUse',
        model: 'claude-sonnet-4',
        event_time: '2026-04-06T12:43:00Z',
      }),
      fileExists: async () => false,
      stdout: {
        write: vi.fn(),
      },
    })

    const stdoutError = new Error('stdout offline')

    await expect(runClaudeCli({
      env: {
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'claude-session',
        cwd: '/workspace/demo',
        hook_event_name: 'PostToolUseFailure',
        model: 'claude-sonnet-4',
        event_time: '2026-04-06T12:43:05Z',
      }),
      fileExists: async () => false,
      stdout: {
        write: () => {
          throw stdoutError
        },
      },
    })).rejects.toThrow('stdout offline')

    const persistedStateAfterFailure = await readClaudeTranscriptState(stateDir, {
      session_id: 'claude-session',
      cwd: '/workspace/demo',
      hook_event_name: 'PostToolUseFailure',
    })
    const retryStdoutWrite = vi.fn()

    await runClaudeCli({
      env: {
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        session_id: 'claude-session',
        cwd: '/workspace/demo',
        hook_event_name: 'PostToolUseFailure',
        model: 'claude-sonnet-4',
        event_time: '2026-04-06T12:43:05Z',
      }),
      fileExists: async () => false,
      stdout: {
        write: retryStdoutWrite,
      },
    })

    expect(persistedStateAfterFailure).toEqual(expect.objectContaining({
      pendingToolStartedAt: '2026-04-06T12:43:00Z',
    }))
    expect(retryStdoutWrite).toHaveBeenCalledTimes(1)
    expect(String(retryStdoutWrite.mock.calls[0]?.[0])).toContain('"event_name":"post_tool_use_failure"')
    expect(String(retryStdoutWrite.mock.calls[0]?.[0])).toContain('"wait_ms":5000')
  })

  it('does not clear transcript state variants on subagent_stop but does on stop_failure', async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-claude-state-'))
    tempDirs.push(stateDir)

    const baseInput = {
      session_id: 'claude-session',
      cwd: '/workspace/demo',
    }
    const primaryInput = { ...baseInput, transcript_path: '/tmp/transcript-primary.jsonl' }
    const rotatedInput = { ...baseInput, transcript_path: '/tmp/transcript-rotated.jsonl' }
    const primaryPath = getClaudeTranscriptStatePath(stateDir, primaryInput)
    const rotatedPath = getClaudeTranscriptStatePath(stateDir, rotatedInput)

    await writeClaudeTranscriptState(stateDir, primaryInput, { lineCount: 1 })
    await writeClaudeTranscriptState(stateDir, rotatedInput, { lineCount: 2 })

    await runClaudeCli({
      env: {
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        ...primaryInput,
        hook_event_name: 'SubagentStop',
        model: 'claude-sonnet-4',
        event_time: '2026-04-06T12:42:00Z',
      }),
      fileExists: async () => false,
      stdout: {
        write: vi.fn(),
      },
    })

    expect(await pathExists(primaryPath)).toBe(true)
    expect(await pathExists(rotatedPath)).toBe(true)

    await runClaudeCli({
      env: {
        CLIPULSE_STATE_DIR: stateDir,
      },
      readStdin: async () => JSON.stringify({
        ...primaryInput,
        hook_event_name: 'StopFailure',
        model: 'claude-sonnet-4',
        event_time: '2026-04-06T12:42:05Z',
      }),
      fileExists: async () => false,
      stdout: {
        write: vi.fn(),
      },
    })

    expect(await pathExists(primaryPath)).toBe(false)
    expect(await pathExists(rotatedPath)).toBe(false)
  })

  it.each(['StopFailure', 'SessionEnd'])(
    'keeps transcript variants until %s reaches stdout successfully',
    async (hookEventName) => {
      const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-claude-state-'))
      tempDirs.push(stateDir)

      const baseInput = {
        session_id: 'claude-session',
        cwd: '/workspace/demo',
      }
      const primaryInput = { ...baseInput, transcript_path: '/tmp/transcript-primary.jsonl' }
      const rotatedInput = { ...baseInput, transcript_path: '/tmp/transcript-rotated.jsonl' }
      const primaryPath = getClaudeTranscriptStatePath(stateDir, primaryInput)
      const rotatedPath = getClaudeTranscriptStatePath(stateDir, rotatedInput)

      await writeClaudeTranscriptState(stateDir, primaryInput, { lineCount: 1 })
      await writeClaudeTranscriptState(stateDir, rotatedInput, { lineCount: 2 })

      await expect(runClaudeCli({
        env: {
          CLIPULSE_STATE_DIR: stateDir,
        },
        readStdin: async () => JSON.stringify({
          ...primaryInput,
          hook_event_name: hookEventName,
          model: 'claude-sonnet-4',
          event_time: '2026-04-06T12:44:00Z',
        }),
        fileExists: async () => false,
        stdout: {
          write: () => {
            throw new Error('stdout offline')
          },
        },
      })).rejects.toThrow('stdout offline')

      expect(await pathExists(primaryPath)).toBe(true)
      expect(await pathExists(rotatedPath)).toBe(true)

      await runClaudeCli({
        env: {
          CLIPULSE_STATE_DIR: stateDir,
        },
        readStdin: async () => JSON.stringify({
          ...primaryInput,
          hook_event_name: hookEventName,
          model: 'claude-sonnet-4',
          event_time: '2026-04-06T12:44:00Z',
        }),
        fileExists: async () => false,
        stdout: {
          write: vi.fn(),
        },
      })

      expect(await pathExists(primaryPath)).toBe(false)
      expect(await pathExists(rotatedPath)).toBe(false)
    },
  )

  it('locks the canonical Claude smoke script sequence and cleanup contract to the checked-in fixtures', async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-claude-smoke-'))
    tempDirs.push(stateDir)

    const expectedBatches = [
      prepareOutboundBatch({
        events: [{
          host: 'claude-code',
          host_version: 'unknown',
          session_id: 'claude-smoke-session',
          project_root: '/workspace/demo',
          project_name: 'demo',
          git_branch: 'unknown',
          event_name: 'session_start',
          event_time: '2026-04-12T03:00:00Z',
          model_name: 'claude-sonnet-4',
          os_name: process.platform,
          editor_or_terminal: 'terminal',
          active_ms: 0,
          wait_ms: 0,
          privacy_mode: 'hashed',
          language_stats: {},
          file_deltas: [],
        }],
      }),
      prepareOutboundBatch({
        events: [{
          host: 'claude-code',
          host_version: 'unknown',
          session_id: 'claude-smoke-session',
          project_root: '/workspace/demo',
          project_name: 'demo',
          git_branch: 'unknown',
          event_name: 'pre_tool_use',
          event_time: '2026-04-12T03:00:02Z',
          model_name: 'claude-sonnet-4',
          os_name: process.platform,
          editor_or_terminal: 'terminal',
          active_ms: 2_000,
          wait_ms: 0,
          privacy_mode: 'hashed',
          language_stats: {},
          file_deltas: [],
        }],
      }),
      prepareOutboundBatch({
        events: [{
          host: 'claude-code',
          host_version: 'unknown',
          session_id: 'claude-smoke-session',
          project_root: '/workspace/demo',
          project_name: 'demo',
          git_branch: 'unknown',
          event_name: 'post_tool_use',
          event_time: '2026-04-12T03:00:07Z',
          model_name: 'claude-sonnet-4',
          os_name: process.platform,
          editor_or_terminal: 'terminal',
          active_ms: 0,
          wait_ms: 5_000,
          privacy_mode: 'hashed',
          language_stats: {
            TypeScript: {
              added: 1,
              removed: 0,
              changed: 1,
            },
          },
          file_deltas: [{
            fingerprint: createFileFingerprint('/workspace/demo/src/smoke.ts', '/workspace/demo'),
            language: 'TypeScript',
            added: 1,
            removed: 0,
          }],
        }],
      }),
      prepareOutboundBatch({
        events: [{
          host: 'claude-code',
          host_version: 'unknown',
          session_id: 'claude-smoke-session',
          project_root: '/workspace/demo',
          project_name: 'demo',
          git_branch: 'unknown',
          event_name: 'session_end',
          event_time: '2026-04-12T03:00:08Z',
          model_name: 'claude-sonnet-4',
          os_name: process.platform,
          editor_or_terminal: 'terminal',
          active_ms: 1_000,
          wait_ms: 0,
          privacy_mode: 'hashed',
          language_stats: {},
          file_deltas: [],
        }],
      }),
    ]

    const result = spawnSync('node', ['scripts/smoke-claude.mjs'], {
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

    expect(outputLines).toEqual(expectedBatches.map((batch) => JSON.stringify(batch)))

    const transcriptStateDir = path.join(stateDir, 'claude-transcripts')
    if (await pathExists(transcriptStateDir)) {
      expect(await fs.readdir(transcriptStateDir)).toEqual([])
    }
  })

  it('keeps direct CLI success output machine-readable', async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-claude-cli-'))
    tempDirs.push(stateDir)

    const result = runClaudeCliProcess(JSON.stringify({
      session_id: 'claude-process-session',
      cwd: path.resolve(REPO_ROOT.pathname),
      hook_event_name: 'UserPromptSubmit',
      model: 'claude-sonnet-4',
      event_time: '2026-04-13T00:00:00Z',
    }), {
      env: {
        CLIPULSE_STATE_DIR: stateDir,
      },
    })

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
          host: 'claude-code',
          session_id: 'claude-process-session',
          event_name: 'user_prompt_submit',
        }),
      ],
    }))
  })

  it.each([
    {
      name: 'rejects malformed JSON input',
      rawInput: '{"session_id":"broken"',
      stderrSubstring: 'expected a JSON object',
    },
    {
      name: 'rejects missing session_id',
      rawInput: JSON.stringify({
        cwd: '/workspace/demo',
        hook_event_name: 'UserPromptSubmit',
      }),
      stderrSubstring: '"session_id" must be a non-empty string',
    },
    {
      name: 'rejects missing cwd',
      rawInput: JSON.stringify({
        session_id: 'claude-session',
        hook_event_name: 'UserPromptSubmit',
      }),
      stderrSubstring: '"cwd" must be a non-empty string',
    },
    {
      name: 'rejects missing hook_event_name',
      rawInput: JSON.stringify({
        session_id: 'claude-session',
        cwd: '/workspace/demo',
      }),
      stderrSubstring: '"hook_event_name" must be a non-empty string',
    },
    {
      name: 'rejects non-string transcript_path',
      rawInput: JSON.stringify({
        session_id: 'claude-session',
        cwd: '/workspace/demo',
        hook_event_name: 'PostToolUse',
        transcript_path: 123,
      }),
      stderrSubstring: '"transcript_path" must be a string',
    },
  ])('$name', ({ rawInput, stderrSubstring }) => {
    const result = runClaudeCliProcess(rawInput)

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain(stderrSubstring)
  })
})
