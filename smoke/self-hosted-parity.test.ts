import { describe, expect, it } from 'vitest'

import {
  assertExactHostModelMixParity,
  assertProjectDetailConsistency,
  assertProjectRollupConsistency,
  assertQueueParityConsistency,
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

  it('checks project detail consistency against project summary and project-scoped sessions', () => {
    const projectSummary = {
      project_name: 'Clipulse',
      project_ref: 'project-clipulse',
      event_count: 5,
      active_ms: 75_000,
      wait_ms: 4_000,
      changed_files_count: 3,
      changed_languages_count: 2,
      lines_added: 10,
      lines_removed: 2,
      lines_changed: 12,
      top_language: { name: 'TypeScript', changed: 9 },
      last_event_time: '2026-04-05T10:10:00Z',
      last_event_name: 'stop',
      last_host: 'opencode',
      last_model_name: 'gpt-5.4-mini',
      last_git_branch: 'feat/demo',
      host_model_mix_count: 2,
      host_model_primary: {
        host: 'gemini-cli',
        model_name: 'gemini-2.5-pro',
        active_ms: 45_000,
        events: 3,
      },
    }
    const projectDetail = {
      ...projectSummary,
      session_count: 2,
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
          active_ms: 45_000,
          wait_ms: 2_000,
          changed_files_count: 1,
          changed_languages_count: 1,
          lines_added: 6,
          lines_removed: 1,
          lines_changed: 7,
          top_language: { name: 'TypeScript', changed: 7 },
          last_event_time: '2026-04-05T10:05:00Z',
          last_event_name: 'after_agent',
          last_host: 'gemini-cli',
          last_model_name: 'gemini-2.5-pro',
          last_git_branch: 'feat/gemini',
        },
        {
          session_id: 'opencode-session',
          project_ref: 'project-clipulse',
          event_count: 2,
          active_ms: 30_000,
          wait_ms: 2_000,
          changed_files_count: 2,
          changed_languages_count: 2,
          lines_added: 4,
          lines_removed: 1,
          lines_changed: 5,
          top_language: { name: 'TypeScript', changed: 2 },
          last_event_time: '2026-04-05T10:10:00Z',
          last_event_name: 'stop',
          last_host: 'opencode',
          last_model_name: 'gpt-5.4-mini',
          last_git_branch: 'feat/demo',
        },
      ],
    }

    expect(() => assertProjectDetailConsistency({
      detail: projectDetail,
      projectSummary,
      projectSessions,
    })).not.toThrow()
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

  it('checks exact mixed host-model parity across recent, project, and session detail payloads', () => {
    const recentSummary = {
      session_id: 'shared-session',
      project_ref: 'project-clipulse',
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
    const projectSummary = {
      ...recentSummary,
    }
    const detail = {
      ...recentSummary,
    }

    expect(() => assertExactHostModelMixParity(
      recentSummary,
      projectSummary,
      detail,
    )).not.toThrow()
  })

  it('fails exact mixed host-model parity when rollup metrics drift', () => {
    const recentSummary = {
      session_id: 'shared-session',
      project_ref: 'project-clipulse',
      host_model_mix: [
        {
          host: 'gemini-cli',
          model_name: 'gemini-2.5-pro',
          active_ms: 45_000,
          events: 3,
        },
      ],
    }
    const detail = {
      ...recentSummary,
      host_model_mix: [
        {
          host: 'gemini-cli',
          model_name: 'gemini-2.5-pro',
          active_ms: 44_999,
          events: 3,
        },
      ],
    }

    expect(() => assertExactHostModelMixParity(
      recentSummary,
      detail,
    )).toThrow()
  })

  it('fails project detail consistency when latest last_* metadata drifts from project sessions', () => {
    const projectSummary = {
      project_name: 'Clipulse',
      project_ref: 'project-clipulse',
      event_count: 5,
      active_ms: 75_000,
      wait_ms: 4_000,
      changed_files_count: 3,
      changed_languages_count: 2,
      lines_added: 10,
      lines_removed: 2,
      lines_changed: 12,
      top_language: { name: 'TypeScript', changed: 9 },
      last_event_time: '2026-04-05T10:10:00Z',
      last_event_name: 'stop',
      last_host: 'claude-code',
      last_model_name: 'claude-sonnet-4',
      last_git_branch: 'feat/wrong-summary',
      host_model_mix_count: 2,
      host_model_primary: {
        host: 'gemini-cli',
        model_name: 'gemini-2.5-pro',
        active_ms: 45_000,
        events: 3,
      },
    }
    const projectDetail = {
      ...projectSummary,
      session_count: 2,
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
          project_name: 'Clipulse',
          project_ref: 'project-clipulse',
          event_count: 3,
          active_ms: 45_000,
          wait_ms: 2_000,
          changed_files_count: 1,
          changed_languages_count: 1,
          lines_added: 6,
          lines_removed: 1,
          lines_changed: 7,
          top_language: { name: 'TypeScript', changed: 7 },
          last_event_time: '2026-04-05T10:05:00Z',
          last_event_name: 'after_agent',
          last_host: 'gemini-cli',
          last_model_name: 'gemini-2.5-pro',
          last_git_branch: 'feat/gemini',
        },
        {
          session_id: 'opencode-session',
          project_name: 'Clipulse',
          project_ref: 'project-clipulse',
          event_count: 2,
          active_ms: 30_000,
          wait_ms: 2_000,
          changed_files_count: 2,
          changed_languages_count: 2,
          lines_added: 4,
          lines_removed: 1,
          lines_changed: 5,
          top_language: { name: 'TypeScript', changed: 2 },
          last_event_time: '2026-04-05T10:10:00Z',
          last_event_name: 'stop',
          last_host: 'opencode',
          last_model_name: 'gpt-5.4-mini',
          last_git_branch: 'feat/opencode',
        },
      ],
    }

    expect(() => assertProjectDetailConsistency({
      detail: projectDetail,
      projectSummary,
      projectSessions,
    })).toThrow()
  })

  it('fails session detail consistency when project_name drifts across payloads', () => {
    const recentSummary = {
      session_id: 'gemini-session',
      project_name: 'Clipulse',
      project_ref: 'project-clipulse',
      host: 'gemini-cli',
      event_count: 3,
      changed_files_count: 1,
      last_event_name: 'stop',
      last_event_time: '2026-04-05T10:10:00Z',
      last_model_name: 'gemini-2.5-pro',
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
      project_name: 'Clipulse worktree',
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
    })).toThrow()
  })

  it('checks empty live queue parity when no backlog entries exist', () => {
    const spool = {
      state_dir: '/tmp/clipulse-state',
      state_dir_exists: true,
      ready: 0,
      processing: 0,
      quarantine: 0,
      ready_bytes: 0,
      processing_bytes: 0,
      quarantine_bytes: 0,
      oldest_backlog_age_seconds: 0,
      oldest_quarantine_age_seconds: 0,
    }

    const doctorOutput = [
      'Clipulse local operator doctor',
      'state dir: /tmp/clipulse-state',
      'state dir kind: directory',
      'ready: 0 | processing: 0 | quarantine: 0',
      'payload bytes: ready=0 processing=0 quarantine=0',
    ].join('\n')

    const pendingOutput = [
      'Clipulse local operator pending',
      'state dir: /tmp/clipulse-state',
      'state dir kind: directory',
      'no payload backlog entries',
    ].join('\n')

    expect(() => assertQueueParityConsistency(spool, {
      doctorOutput,
      pendingOutput,
    })).not.toThrow()
  })

  it('checks mixed backlog parity across status spool, doctor output, and pending output', () => {
    const spool = {
      backlog_mode: 'mixed',
      state_dir: '/tmp/clipulse-state',
      state_dir_kind: 'directory',
      state_dir_exists: true,
      ready: 1,
      processing: 1,
      quarantine: 1,
      ready_bytes: 31,
      processing_bytes: 36,
      quarantine_bytes: 36,
      orphan_sidecars: { ready: 0, processing: 0, quarantine: 0, total: 0 },
      quarantine_reason_counts: { http_error: 1 },
      oldest_backlog_age_seconds: 2,
      oldest_quarantine_age_seconds: 1,
    }

    const doctorOutput = [
      'Clipulse local operator doctor',
      'state dir: /tmp/clipulse-state',
      'state dir kind: directory',
      'ready: 1 | processing: 1 | quarantine: 1',
      'payload bytes: ready=31 processing=36 quarantine=36',
      'mixed backlog: flushable payloads coexist with quarantine entries',
      'quarantine reasons: http_error=1',
    ].join('\n')

    const pendingOutput = [
      'Clipulse local operator pending',
      'state dir: /tmp/clipulse-state',
      'state dir kind: directory',
      '[ready] ready-batch.json',
      '[processing] processing-batch.json',
      '[quarantine] quarantine-batch.json',
      'reason=http_error',
      'source_state=ready',
    ].join('\n')

    expect(() => assertQueueParityConsistency(spool, {
      doctorOutput,
      pendingOutput,
      expectedBacklogMode: 'mixed',
      expectedDoctorHints: ['mixed backlog'],
      expectedEntries: [
        { state: 'ready', file_name: 'ready-batch.json' },
        { state: 'processing', file_name: 'processing-batch.json' },
        {
          state: 'quarantine',
          file_name: 'quarantine-batch.json',
          reason: 'http_error',
          source_state: 'ready',
        },
      ],
      expectedQuarantineReasonCounts: { http_error: 1 },
      expectedStateDirKind: 'directory',
    })).not.toThrow()
  })

  it('checks orphan-only dirty queue parity across status spool, doctor output, and pending output', () => {
    const spool = {
      backlog_mode: 'empty',
      state_dir: '/tmp/clipulse-state',
      state_dir_kind: 'directory',
      state_dir_exists: true,
      ready: 0,
      processing: 0,
      quarantine: 0,
      ready_bytes: 0,
      processing_bytes: 0,
      quarantine_bytes: 0,
      orphan_sidecars: { ready: 1, processing: 1, quarantine: 1, total: 3 },
      quarantine_reason_counts: {},
      oldest_backlog_age_seconds: 0,
      oldest_quarantine_age_seconds: 0,
    }

    const doctorOutput = [
      'Clipulse local operator doctor',
      'state dir: /tmp/clipulse-state',
      'state dir kind: directory',
      'ready: 0 | processing: 0 | quarantine: 0',
      'payload bytes: ready=0 processing=0 quarantine=0',
      'orphan metadata sidecars: ready=1 processing=1 quarantine=1',
      'orphan-only backlog: metadata sidecars remain without payload files; inspect local spool cleanup and last recovery path',
    ].join('\n')

    const pendingOutput = [
      'Clipulse local operator pending',
      'state dir: /tmp/clipulse-state',
      'state dir kind: directory',
      'no payload backlog entries',
      'orphan metadata sidecars: ready=1 processing=1 quarantine=1',
    ].join('\n')

    expect(() => assertQueueParityConsistency(spool, {
      doctorOutput,
      pendingOutput,
      expectedBacklogMode: 'empty',
      expectedDoctorHints: ['orphan-only backlog'],
      expectedOrphanSidecars: { ready: 1, processing: 1, quarantine: 1, total: 3 },
      expectedStateDirKind: 'directory',
    })).not.toThrow()
  })
})
