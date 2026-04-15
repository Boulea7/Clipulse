import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { smokeRuntimeCommand as claudeSmokeRuntimeCommand } from '../../scripts/smoke-claude.mjs'
import { smokeRuntimeCommand as codexSmokeRuntimeCommand } from '../../scripts/smoke-codex.mjs'
import { smokeRuntimeCommand as geminiSmokeRuntimeCommand } from '../../scripts/smoke-gemini.mjs'
import { smokeRuntimeCommand as openCodeSmokeRuntimeCommand } from '../../scripts/smoke-opencode.mjs'
import { launcherDescriptors } from '../../scripts/smoke-adapters.mjs'
import { parseExpectedBatchLinesOutput } from '../../scripts/smoke-shared.mjs'

const SELF_HOSTED_EXPERIMENTAL_LAUNCHER = new URL('../../scripts/smoke-self-hosted-experimental.mjs', import.meta.url)

describe('repo smoke contracts', () => {
  it('pins adapter suite membership and self-hosted launcher targets', () => {
    expect(launcherDescriptors).toEqual([
      { kind: 'adapter', mode: 'stable', path: 'scripts/smoke-claude.mjs' },
      { kind: 'adapter', mode: 'stable', path: 'scripts/smoke-codex.mjs' },
      { kind: 'adapter', mode: 'experimental', path: 'scripts/smoke-gemini.mjs' },
      { kind: 'adapter', mode: 'experimental', path: 'scripts/smoke-opencode.mjs' },
      { kind: 'self-hosted', mode: 'stable', path: 'smoke/self-hosted-wiring.test.ts' },
      { kind: 'self-hosted', mode: 'experimental', path: 'smoke/self-hosted-experimental.test.ts' },
    ])
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

  it('keeps launcher runtime exports and experimental self-hosted launcher wiring pinned', () => {
    const experimentalLauncher = readFileSync(SELF_HOSTED_EXPERIMENTAL_LAUNCHER, 'utf8')

    expect(claudeSmokeRuntimeCommand).toBe(process.execPath)
    expect(codexSmokeRuntimeCommand).toBe(process.execPath)
    expect(geminiSmokeRuntimeCommand).toBe(process.execPath)
    expect(openCodeSmokeRuntimeCommand).toBe(process.execPath)
    expect(experimentalLauncher).toContain(
      "export const launcherSmokeTestPath = 'smoke/self-hosted-launchers.test.ts'",
    )
    expect(experimentalLauncher).toContain(
      "export const smokeTestPath = 'smoke/self-hosted-experimental.test.ts'",
    )
  })
})
