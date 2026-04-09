import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildClaudeHookEvent,
  getClaudeTranscriptStatePath,
  normalizeClaudeHookEvent,
  writeClaudeTranscriptState,
} from '../src/index.js'
import { runClaudeCli } from '../src/cli.js'

const tempDirs: string[] = []

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
    expect(String(stdoutWrite.mock.calls[0]?.[0])).toContain('"host":"claude-code"')
    expect(String(stdoutWrite.mock.calls[0]?.[0])).toContain('"session_id":"claude-session"')
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
})
