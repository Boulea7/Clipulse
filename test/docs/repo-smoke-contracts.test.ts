import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { parseExpectedBatchLinesOutput } from '../../scripts/smoke-shared.mjs'

const SMOKE_ADAPTERS_SCRIPT = new URL('../../scripts/smoke-adapters.mjs', import.meta.url)
const STABLE_SELF_HOSTED_SCRIPT = new URL('../../scripts/smoke-self-hosted.mjs', import.meta.url)
const EXPERIMENTAL_SELF_HOSTED_SCRIPT = new URL(
  '../../scripts/smoke-self-hosted-experimental.mjs',
  import.meta.url,
)

function readContent(file: URL): string {
  return readFileSync(file, 'utf8')
}

describe('repo smoke contracts', () => {
  it('pins adapter suite membership and self-hosted launcher targets', () => {
    const adaptersScript = readContent(SMOKE_ADAPTERS_SCRIPT)
    const stableSelfHostedScript = readContent(STABLE_SELF_HOSTED_SCRIPT)
    const experimentalSelfHostedScript = readContent(EXPERIMENTAL_SELF_HOSTED_SCRIPT)

    expect(adaptersScript).toContain('stable: [')
    expect(adaptersScript).toContain("scriptPath: 'scripts/smoke-claude.mjs'")
    expect(adaptersScript).toContain("scriptPath: 'scripts/smoke-codex.mjs'")
    expect(adaptersScript).toContain('experimental: [')
    expect(adaptersScript).toContain("scriptPath: 'scripts/smoke-gemini.mjs'")
    expect(adaptersScript).toContain("scriptPath: 'scripts/smoke-opencode.mjs'")
    expect(adaptersScript).toContain('Expected one of: stable, experimental.')

    expect(stableSelfHostedScript).toContain("const smokeTestPath = 'smoke/self-hosted-wiring.test.ts'")
    expect(experimentalSelfHostedScript).toContain(
      "const smokeTestPath = 'smoke/self-hosted-experimental.test.ts'",
    )
  })

  it('includes actual and expected event sequences when batch line validation fails', () => {
    const stdout = [
      JSON.stringify({
        events: [{ host: 'codex', session_id: 'session-1', event_name: 'session_start' }],
      }),
      JSON.stringify({
        events: [{ host: 'codex', session_id: 'session-1', event_name: 'stop_failure' }],
      }),
    ].join('\n')

    expect(() =>
      parseExpectedBatchLinesOutput(stdout, {
        contextLabel: 'Codex smoke',
        expectedSequence: [
          { host: 'codex', sessionId: 'session-1', eventName: 'session_start' },
          { host: 'codex', sessionId: 'session-1', eventName: 'session_end' },
        ],
      }),
    ).toThrowError(
      expect.objectContaining({
        message: expect.stringContaining('actual sequence:'),
      }),
    )

    expect(() =>
      parseExpectedBatchLinesOutput(stdout, {
        contextLabel: 'Codex smoke',
        expectedSequence: [
          { host: 'codex', sessionId: 'session-1', eventName: 'session_start' },
          { host: 'codex', sessionId: 'session-1', eventName: 'session_end' },
        ],
      }),
    ).toThrowError(
      expect.objectContaining({
        message: expect.stringContaining('2. host=codex session_id=session-1 event_name=stop_failure'),
      }),
    )

    expect(() =>
      parseExpectedBatchLinesOutput(stdout, {
        contextLabel: 'Codex smoke',
        expectedSequence: [
          { host: 'codex', sessionId: 'session-1', eventName: 'session_start' },
          { host: 'codex', sessionId: 'session-1', eventName: 'session_end' },
        ],
      }),
    ).toThrowError(
      expect.objectContaining({
        message: expect.stringContaining('expected sequence:'),
      }),
    )
  })
})
