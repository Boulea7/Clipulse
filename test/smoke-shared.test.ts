import { rm } from 'node:fs/promises'

import { afterEach, describe, expect, it } from 'vitest'

import {
  assertLocalBuildExists,
  createOwnedSmokeTempDir,
  parseExpectedBatchLinesOutput,
  runSequencedSmokeSteps,
} from '../scripts/smoke-shared.mjs'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true })
    }),
  )
})

describe('smoke shared helpers', () => {
  it('parses JSON batch lines with an exact expected sequence', () => {
    const payloads = parseExpectedBatchLinesOutput([
      JSON.stringify({
        events: [{ host: 'codex', session_id: 'seq-session', event_name: 'session_start' }],
      }),
      JSON.stringify({
        events: [{ host: 'codex', session_id: 'seq-session', event_name: 'pre_tool_use' }],
      }),
      JSON.stringify({
        events: [{ host: 'codex', session_id: 'seq-session', event_name: 'post_tool_use_failure' }],
      }),
    ].join('\n'), {
      contextLabel: 'Codex sequence smoke',
      expectedSequence: [
        { host: 'codex', sessionId: 'seq-session', eventName: 'session_start' },
        { host: 'codex', sessionId: 'seq-session', eventName: 'pre_tool_use' },
        { host: 'codex', sessionId: 'seq-session', eventName: 'post_tool_use_failure' },
      ],
    })

    expect(payloads).toHaveLength(3)
  })

  it('fails with line and event indexes when a batch line does not match the expected sequence', () => {
    expect(() => parseExpectedBatchLinesOutput([
      JSON.stringify({
        events: [{ host: 'codex', session_id: 'seq-session', event_name: 'session_start' }],
      }),
      JSON.stringify({
        events: [{ host: 'codex', session_id: 'seq-session', event_name: 'stop' }],
      }),
    ].join('\n'), {
      contextLabel: 'Codex sequence smoke',
      expectedSequence: [
        { host: 'codex', sessionId: 'seq-session', eventName: 'session_start' },
        { host: 'codex', sessionId: 'seq-session', eventName: 'pre_tool_use' },
      ],
    })).toThrowError(/line 2/i)
  })

  it('includes step labels in expected sequence mismatches when provided', () => {
    expect(() => parseExpectedBatchLinesOutput([
      JSON.stringify({
        events: [{ host: 'gemini-cli', session_id: 'seq-session', event_name: 'session_start' }],
      }),
      JSON.stringify({
        events: [{ host: 'gemini-cli', session_id: 'seq-session', event_name: 'stop' }],
      }),
    ].join('\n'), {
      contextLabel: 'Gemini sequence smoke',
      expectedSequence: [
        { label: 'fixture 1', host: 'gemini-cli', sessionId: 'seq-session', eventName: 'session_start' },
        { label: 'fixture 2', host: 'gemini-cli', sessionId: 'seq-session', eventName: 'after_agent' },
      ],
    })).toThrowError(/fixture 2/i)
  })

  it('runs sequenced smoke steps and preserves per-step labels in the result', async () => {
    const calls: string[] = []
    const result = await runSequencedSmokeSteps([
      {
        input: 'alpha',
        label: 'fixture alpha',
      },
      {
        input: 'beta',
        label: 'fixture beta',
      },
    ], async (step) => {
      calls.push(step.label)
      return {
        stdout: JSON.stringify({
          events: [{ host: 'codex', session_id: 'seq-session', event_name: step.input }],
        }),
      }
    })

    expect(calls).toEqual(['fixture alpha', 'fixture beta'])
    expect(result.outputs).toEqual([
      expect.objectContaining({ label: 'fixture alpha' }),
      expect.objectContaining({ label: 'fixture beta' }),
    ])
    expect(result.stdout).toContain('"event_name":"alpha"')
    expect(result.stdout).toContain('"event_name":"beta"')
  })

  it('creates owned smoke temp directories under the platform temp root', async () => {
    const tempDir = await createOwnedSmokeTempDir('clipulse-shared-test-')
    tempDirs.push(tempDir)

    expect(tempDir).toContain('clipulse-shared-test-')
  })

  it('throws a readable preflight error when a local smoke build is missing', () => {
    expect(() => assertLocalBuildExists({
      buildCommand: 'npm run build --workspace @clipulse/adapter-claude',
      label: 'Claude smoke',
      modulePath: '/tmp/missing-cli.js',
    })).toThrowError(/npm run build --workspace @clipulse\/adapter-claude/)
  })
})
