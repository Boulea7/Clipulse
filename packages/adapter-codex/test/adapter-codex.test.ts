import { describe, expect, it } from 'vitest'

import { normalizeCodexHookEvent } from '../src/index.js'

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
})
