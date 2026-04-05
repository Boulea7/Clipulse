import { describe, expect, it, vi } from 'vitest'

import { normalizeClaudeHookEvent } from '../src/index.js'
import { runClaudeCli } from '../src/cli.js'

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
})
