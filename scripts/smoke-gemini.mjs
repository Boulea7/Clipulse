import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  assertLocalBuildExists,
  createOwnedSmokeTempDir,
  getRepoRoot,
  parseExpectedBatchLinesOutput,
  resolveRepoPath,
  runSequencedSmokeSteps,
  runSmokeCommand,
} from './smoke-shared.mjs'

const repoRoot = getRepoRoot(import.meta.url)
const adapterCliRelativePath = 'packages/adapter-gemini/dist/cli.js'
const adapterCliPath = path.join(repoRoot, adapterCliRelativePath)

export const geminiSmokeScenarios = Object.freeze([
  {
    name: 'official-baseline',
    cwd: '/workspace/gemini-baseline',
    requiredEventNames: ['session_start', 'user_prompt_submit', 'after_agent', 'session_end'],
    sessionId: 'gemini-baseline-session',
    steps: [
      { label: 'session start', fixtureRelativePath: 'packages/adapter-gemini/examples/session-start.json' },
      { label: 'prompt submit', fixtureRelativePath: 'packages/adapter-gemini/examples/before-agent.prompt-only.json' },
      { label: 'turn complete', fixtureRelativePath: 'packages/adapter-gemini/examples/after-agent.prompt-only.json' },
      { label: 'session end', fixtureRelativePath: 'packages/adapter-gemini/examples/session-end.json' },
    ],
  },
  {
    name: 'read-only-fallback',
    cwd: '/workspace/gemini-readonly',
    requiredEventNames: ['session_start', 'pre_tool_use', 'session_end'],
    sessionId: 'gemini-readonly-session',
    steps: [
      { label: 'session start', fixtureRelativePath: 'packages/adapter-gemini/examples/session-start.json' },
      { label: 'before read_file', fixtureRelativePath: 'packages/adapter-gemini/examples/before-tool.read-file.json' },
      { label: 'session end fallback', fixtureRelativePath: 'packages/adapter-gemini/examples/session-end.json' },
    ],
  },
  {
    name: 'multi-turn-mixed',
    requiredEventNames: [
      'session_start',
      'user_prompt_submit',
      'after_agent',
      'pre_tool_use',
      'post_tool_use',
      'session_end',
    ],
    sessionId: 'gemini-smoke-session',
    steps: [
      { label: 'session start', fixtureRelativePath: 'packages/adapter-gemini/examples/session-start.json' },
      { label: 'turn 1 prompt', fixtureRelativePath: 'packages/adapter-gemini/examples/before-agent.prompt-only.json' },
      { label: 'turn 1 complete', fixtureRelativePath: 'packages/adapter-gemini/examples/after-agent.prompt-only.json' },
      { label: 'before read_file', fixtureRelativePath: 'packages/adapter-gemini/examples/before-tool.read-file.json' },
      { label: 'after read_file', fixtureRelativePath: 'packages/adapter-gemini/examples/after-tool.read-file.json' },
      { label: 'turn 2 prompt', fixtureRelativePath: 'packages/adapter-gemini/examples/before-agent.prompt-only.json' },
      { label: 'turn 2 complete', fixtureRelativePath: 'packages/adapter-gemini/examples/after-agent.prompt-only.json' },
      { label: 'after write_file', fixtureRelativePath: 'packages/adapter-gemini/examples/after-tool.write-file.json' },
      { label: 'session end', fixtureRelativePath: 'packages/adapter-gemini/examples/session-end.json' },
    ],
  },
])

function readFixture(relativePath) {
  return JSON.parse(readFileSync(resolveRepoPath(import.meta.url, relativePath), 'utf8'))
}

function withOverrides(fixture, overrides = {}) {
  return {
    ...fixture,
    ...overrides,
    tool_input: fixture.tool_input || overrides.tool_input
      ? {
        ...(fixture.tool_input ?? {}),
        ...(overrides.tool_input ?? {}),
      }
      : undefined,
  }
}

export function materializeGeminiSmokeStep(step, scenario, stepIndex) {
  const fixture = readFixture(step.fixtureRelativePath)
  const secondOffset = scenario.name === 'official-baseline'
    ? [0, 2, 5, 6][stepIndex] ?? stepIndex
    : scenario.name === 'read-only-fallback'
      ? [0, 3, 8][stepIndex] ?? stepIndex
      : [0, 2, 5, 8, 10, 12, 16, 18, 24][stepIndex] ?? stepIndex
  const eventTime = new Date(Date.UTC(2026, 3, 10, 3, 0, 0 + secondOffset)).toISOString().replace('.000', '')
  const normalizedEventTime = eventTime.endsWith('Z') ? eventTime : `${eventTime}Z`

  return withOverrides(fixture, {
    session_id: scenario.sessionId,
    cwd: scenario.cwd ?? '/workspace/demo',
    event_time: normalizedEventTime,
    timestamp: normalizedEventTime,
  })
}

export async function runGeminiSmokeScenarios({
  apiBaseUrl,
  cwd = repoRoot,
  expectStdout = !apiBaseUrl,
  runner = async (step, input, stateDir) => runSmokeCommand({
    command: 'node',
    args: [adapterCliRelativePath],
    cwd,
    env: {
      ...(apiBaseUrl ? { CLIPULSE_API_URL: apiBaseUrl } : {}),
      CLIPULSE_STATE_DIR: stateDir,
    },
    input: JSON.stringify(input),
    stepLabel: step.label,
  }),
  scenarios = geminiSmokeScenarios,
  stateDir,
} = {}) {
  const allPayloads = []
  const allStdoutChunks = []

  for (const scenario of scenarios) {
    const sequenced = await runSequencedSmokeSteps(
      scenario.steps,
      async (step, stepIndex = scenario.steps.indexOf(step)) => {
        const input = materializeGeminiSmokeStep(step, scenario, stepIndex)
        return runner(step, input, stateDir)
      },
    )

    if (sequenced.stdout.trim() !== '') {
      allStdoutChunks.push(sequenced.stdout.trim())
    }

    if (expectStdout) {
      const payloads = parseExpectedBatchLinesOutput(sequenced.stdout, {
        contextLabel: `Gemini smoke (${scenario.name})`,
        expectedHost: 'gemini-cli',
        expectedSessionId: scenario.sessionId,
        requiredEventNames: scenario.requiredEventNames,
        expectedSequence: scenario.steps.map((step, stepIndex) => {
          const input = materializeGeminiSmokeStep(step, scenario, stepIndex)
          const eventNameByHook = {
            SessionStart: 'session_start',
            BeforeAgent: 'user_prompt_submit',
            AfterAgent: 'after_agent',
            BeforeTool: 'pre_tool_use',
            AfterTool: 'post_tool_use',
            SessionEnd: 'session_end',
          }
          return {
            label: step.label,
            host: 'gemini-cli',
            sessionId: scenario.sessionId,
            eventName: eventNameByHook[input.hook_event_name],
          }
        }),
      })

      allPayloads.push(...payloads)
    }
  }

  return {
    payloads: allPayloads,
    stdout: allStdoutChunks.join('\n'),
  }
}

const stateDir = process.env.CLIPULSE_STATE_DIR ?? await createOwnedSmokeTempDir('clipulse-gemini-smoke-')

assertLocalBuildExists({
  buildCommand: 'npm run build --workspace @clipulse/adapter-gemini',
  label: 'Gemini smoke',
  modulePath: adapterCliPath,
})

const { payloads, stdout } = await runGeminiSmokeScenarios({ stateDir })

if (!payloads.flatMap((payload) => payload.events).some((event) => event.privacy_mode === 'hashed')) {
  throw new Error('Gemini smoke must include a hashed privacy_mode event.')
}

process.stdout.write(`${stdout}\n`)
