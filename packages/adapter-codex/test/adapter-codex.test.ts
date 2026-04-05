import { describe, expect, it, vi } from 'vitest'

import { normalizeCodexHookEvent } from '../src/index.js'
import { runCodexCli } from '../src/cli.js'

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
})
