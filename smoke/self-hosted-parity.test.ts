import { describe, expect, it } from 'vitest'

import {
  assertProjectRollupConsistency,
  assertSessionDetailConsistency,
  assertSessionListResponseParity,
} from './self-hosted-parity.ts'

describe('self-hosted smoke parity helpers', () => {
  it('matches compact and full session lists by project_ref and session_id together', () => {
    const fullResponse = {
      items: [
        {
          session_id: 'shared-session',
          project_name: 'demo-a',
          project_ref: 'project-a',
          host: 'gemini-cli',
          active_ms: 45_000,
          wait_ms: 3_000,
          event_count: 2,
          changed_files_count: 1,
          host_model_mix_count: 1,
          host_model_primary: {
            host: 'gemini-cli',
            model_name: 'gemini-2.5-pro',
            active_ms: 45_000,
            events: 2,
          },
          host_model_mix: [
            {
              host: 'gemini-cli',
              model_name: 'gemini-2.5-pro',
              active_ms: 45_000,
              events: 2,
            },
          ],
        },
        {
          session_id: 'shared-session',
          project_name: 'demo-b',
          project_ref: 'project-b',
          host: 'opencode',
          active_ms: 30_000,
          wait_ms: 1_000,
          event_count: 1,
          changed_files_count: 2,
          host_model_mix_count: 1,
          host_model_primary: {
            host: 'opencode',
            model_name: 'gpt-5.4-mini',
            active_ms: 30_000,
            events: 1,
          },
          host_model_mix: [
            {
              host: 'opencode',
              model_name: 'gpt-5.4-mini',
              active_ms: 30_000,
              events: 1,
            },
          ],
        },
      ],
    }

    const compactResponse = {
      items: [
        {
          session_id: 'shared-session',
          project_name: 'demo-a',
          project_ref: 'project-a',
          host: 'gemini-cli',
          active_ms: 45_000,
          wait_ms: 3_000,
          event_count: 2,
          changed_files_count: 1,
          host_model_mix_count: 1,
          host_model_primary: {
            host: 'gemini-cli',
            model_name: 'gemini-2.5-pro',
            active_ms: 45_000,
            events: 2,
          },
        },
        {
          session_id: 'shared-session',
          project_name: 'demo-b',
          project_ref: 'project-b',
          host: 'opencode',
          active_ms: 30_000,
          wait_ms: 1_000,
          event_count: 1,
          changed_files_count: 2,
          host_model_mix_count: 1,
          host_model_primary: {
            host: 'opencode',
            model_name: 'gpt-5.4-mini',
            active_ms: 30_000,
            events: 1,
          },
        },
      ],
    }

    expect(() => assertSessionListResponseParity(fullResponse, compactResponse)).not.toThrow()
  })

  it('checks project detail rollups against project-scoped sessions and mixed host-model data', () => {
    const projectDetail = {
      project_name: 'Clipulse',
      project_ref: 'project-clipulse',
      session_count: 2,
      event_count: 5,
      last_host: 'opencode',
      last_model_name: 'gpt-5.4-mini',
      host_model_mix_count: 2,
      host_model_primary: {
        host: 'gemini-cli',
        model_name: 'gemini-2.5-pro',
        active_ms: 45_000,
        events: 3,
      },
      host_model_mix: [
        {
          host: 'gemini-cli',
          model_name: 'gemini-2.5-pro',
          active_ms: 45_000,
          events: 3,
        },
        {
          host: 'opencode',
          model_name: 'gpt-5.4-mini',
          active_ms: 30_000,
          events: 2,
        },
      ],
    }

    const projectSessions = {
      project_name: 'Clipulse',
      project_ref: 'project-clipulse',
      items: [
        {
          session_id: 'gemini-session',
          project_ref: 'project-clipulse',
          event_count: 3,
          host: 'gemini-cli',
          host_model_mix_count: 1,
          host_model_primary: {
            host: 'gemini-cli',
            model_name: 'gemini-2.5-pro',
            active_ms: 45_000,
            events: 3,
          },
        },
        {
          session_id: 'opencode-session',
          project_ref: 'project-clipulse',
          event_count: 2,
          host: 'opencode',
          host_model_mix_count: 1,
          host_model_primary: {
            host: 'opencode',
            model_name: 'gpt-5.4-mini',
            active_ms: 30_000,
            events: 2,
          },
        },
      ],
    }

    expect(() => assertProjectRollupConsistency(projectDetail, projectSessions, [
      'gemini-session',
      'opencode-session',
    ])).not.toThrow()
  })

  it('checks session detail consistency against recent and project-scoped summaries', () => {
    const recentSummary = {
      session_id: 'gemini-session',
      project_name: 'Clipulse',
      project_ref: 'project-clipulse',
      host: 'gemini-cli',
      event_count: 3,
      changed_files_count: 1,
      host_model_mix_count: 1,
      host_model_primary: {
        host: 'gemini-cli',
        model_name: 'gemini-2.5-pro',
        active_ms: 45_000,
        events: 3,
      },
    }
    const projectSummary = {
      ...recentSummary,
    }
    const detail = {
      ...recentSummary,
      host_model_mix: [
        {
          host: 'gemini-cli',
          model_name: 'gemini-2.5-pro',
          active_ms: 45_000,
          events: 3,
        },
      ],
    }

    expect(() => assertSessionDetailConsistency({
      detail,
      expectedHost: 'gemini-cli',
      projectSummary,
      recentSummary,
    })).not.toThrow()
  })
})
