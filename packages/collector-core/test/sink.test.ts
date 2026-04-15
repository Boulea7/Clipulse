import { describe, expect, it, vi } from 'vitest'

import { prepareOutboundBatch, sendBatch } from '../src/index.js'

describe('sendBatch', () => {
  it('normalizes project scope before generating outbound event ids', () => {
    const rawBatch = {
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
    }

    const preparedBatch = prepareOutboundBatch(rawBatch)
    const preparedEvent = preparedBatch.events[0]
    const replayBatch = prepareOutboundBatch({
      events: [{ ...rawBatch.events[0], project_root: preparedEvent!.project_root }],
    })

    expect(preparedEvent?.project_root).toMatch(/^[0-9a-f]{12}$/)
    expect(preparedEvent?.event_id).toMatch(/^[0-9a-f]{64}$/)
    expect(replayBatch.events[0]?.event_id).toBe(preparedEvent?.event_id)
  })

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

  it('keeps retryable batches sanitized when the API returns unreadable JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: vi.fn().mockRejectedValue(new Error('bad json')),
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

    expect(result.retryableBatch.events).toHaveLength(1)
    expect(result.retryableBatch.events[0]?.project_root).toMatch(/^[0-9a-f]{12}$/)
    expect(result.retryableBatch.events[0]?.project_root).not.toBe('/workspace/demo')
  })
})
