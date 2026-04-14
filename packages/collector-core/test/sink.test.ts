import { describe, expect, it, vi } from 'vitest'

import { sendBatch } from '../src/index.js'

describe('sendBatch', () => {
  it('posts a normalized event batch to the Clipulse API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
    })

    const result = await sendBatch(
      'http://localhost:8000',
      {
        events: [
          {
            host: 'codex',
            host_version: '0.1.0',
            session_id: 'session-1',
            project_root: '/workspace/demo',
            project_name: 'demo',
            git_branch: 'main',
            event_name: 'stop',
            event_time: '2026-04-05T12:00:00Z',
            model_name: 'gpt-5.4',
            os_name: 'macos',
            editor_or_terminal: 'terminal',
            active_ms: 1000,
            wait_ms: 500,
            privacy_mode: 'hashed',
            language_stats: {},
            file_deltas: [],
          },
        ],
      },
      fetchMock,
    )

    expect(result).toEqual({
      retryableBatch: {
        events: [],
      },
      quarantineBatch: {
        events: [],
      },
      quarantineMetadata: null,
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/api/v1/events/batch',
      expect.objectContaining({
        method: 'POST',
      }),
    )
  })

  it('adds a bearer authorization header when an API bearer token is provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
    })

    await sendBatch(
      'http://localhost:8000',
      {
        events: [
          {
            host: 'codex',
            host_version: '0.1.0',
            session_id: 'session-1',
            project_root: '/workspace/demo',
            project_name: 'demo',
            git_branch: 'main',
            event_name: 'stop',
            event_time: '2026-04-05T12:00:00Z',
            model_name: 'gpt-5.4',
            os_name: 'macos',
            editor_or_terminal: 'terminal',
            active_ms: 1000,
            wait_ms: 500,
            privacy_mode: 'hashed',
            language_stats: {},
            file_deltas: [],
          },
        ],
      },
      fetchMock,
      'collector-token',
    )

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/api/v1/events/batch',
      expect.objectContaining({
        headers: {
          'content-type': 'application/json',
          Authorization: 'Bearer collector-token',
        },
      }),
    )
  })
})
