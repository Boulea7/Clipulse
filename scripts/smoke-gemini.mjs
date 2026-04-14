import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

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
const DEFAULT_MODEL_NAME = 'gemini-2.5-pro'
const GEMINI_HOOK_EVENT_NAMES = Object.freeze({
  AfterAgent: 'after_agent',
  AfterTool: 'post_tool_use',
  AfterToolFailure: 'post_tool_use_failure',
  BeforeAgent: 'user_prompt_submit',
  BeforeTool: 'pre_tool_use',
  SessionEnd: 'session_end',
  SessionStart: 'session_start',
})

export const geminiSmokeScenarios = Object.freeze([
  {
    name: 'official-baseline',
    cwd: '/workspace/gemini-baseline',
    requiredEventNames: ['session_start', 'user_prompt_submit', 'after_agent', 'session_end'],
    secondOffsets: [0, 2, 5, 6],
    sessionId: 'gemini-baseline-session',
    steps: [
      {
        label: 'session start',
        fixtureRelativePath: 'packages/adapter-gemini/examples/session-start.json',
        expect: { activeMs: 0, fileDeltaCount: 0, waitMs: 0 },
      },
      {
        label: 'prompt submit',
        fixtureRelativePath: 'packages/adapter-gemini/examples/before-agent.prompt-only.json',
        expect: { activeMs: 2_000, fileDeltaCount: 0, waitMs: 0 },
      },
      {
        label: 'turn complete',
        fixtureRelativePath: 'packages/adapter-gemini/examples/after-agent.prompt-only.json',
        expect: { activeMs: 3_000, fileDeltaCount: 0, waitMs: 0 },
      },
      {
        label: 'session end',
        fixtureRelativePath: 'packages/adapter-gemini/examples/session-end.json',
        expect: { activeMs: 1_000, fileDeltaCount: 0, waitMs: 0 },
      },
    ],
  },
  {
    name: 'legacy-prompt-submit',
    cwd: '/workspace/gemini-legacy-prompt',
    requiredEventNames: ['session_start', 'user_prompt_submit', 'after_agent', 'session_end'],
    secondOffsets: [0, 1, 4, 5],
    sessionId: 'gemini-legacy-prompt-session',
    steps: [
      {
        label: 'session start',
        fixtureRelativePath: 'packages/adapter-gemini/examples/session-start.json',
        expect: { activeMs: 0, fileDeltaCount: 0, waitMs: 0 },
      },
      {
        label: 'legacy prompt alias',
        fixtureRelativePath: 'packages/adapter-gemini/examples/user-prompt-submit.prompt-only.json',
        expect: { activeMs: 1_000, fileDeltaCount: 0, waitMs: 0 },
      },
      {
        label: 'turn complete',
        fixtureRelativePath: 'packages/adapter-gemini/examples/after-agent.prompt-only.json',
        expect: { activeMs: 3_000, fileDeltaCount: 0, waitMs: 0 },
      },
      {
        label: 'session end',
        fixtureRelativePath: 'packages/adapter-gemini/examples/session-end.json',
        expect: { activeMs: 1_000, fileDeltaCount: 0, waitMs: 0 },
      },
    ],
  },
  {
    name: 'read-only-fallback',
    cwd: '/workspace/gemini-readonly',
    requiredEventNames: ['session_start', 'pre_tool_use', 'session_end'],
    secondOffsets: [0, 3, 8],
    sessionId: 'gemini-readonly-session',
    steps: [
      {
        label: 'session start',
        fixtureRelativePath: 'packages/adapter-gemini/examples/session-start.json',
        expect: { activeMs: 0, fileDeltaCount: 0, waitMs: 0 },
      },
      {
        label: 'before read_file',
        fixtureRelativePath: 'packages/adapter-gemini/examples/before-tool.read-file.json',
        expect: { activeMs: 3_000, fileDeltaCount: 0, waitMs: 0 },
      },
      {
        label: 'session end fallback',
        fixtureRelativePath: 'packages/adapter-gemini/examples/session-end.json',
        expect: { activeMs: 0, fileDeltaCount: 0, waitMs: 5_000 },
      },
    ],
  },
  {
    name: 'prompt-only-multi-turn',
    cwd: '/workspace/gemini-prompt-only',
    requiredEventNames: ['session_start', 'user_prompt_submit', 'after_agent', 'session_end'],
    secondOffsets: [0, 2, 5, 8, 12, 15],
    sessionId: 'gemini-prompt-only-session',
    steps: [
      {
        label: 'session start',
        fixtureRelativePath: 'packages/adapter-gemini/examples/session-start.json',
        expect: { activeMs: 0, fileDeltaCount: 0, waitMs: 0 },
      },
      {
        label: 'turn 1 prompt',
        fixtureRelativePath: 'packages/adapter-gemini/examples/before-agent.prompt-only.json',
        expect: { activeMs: 2_000, fileDeltaCount: 0, waitMs: 0 },
      },
      {
        label: 'turn 1 complete',
        fixtureRelativePath: 'packages/adapter-gemini/examples/after-agent.prompt-only.json',
        expect: { activeMs: 3_000, fileDeltaCount: 0, waitMs: 0 },
      },
      {
        label: 'turn 2 prompt',
        fixtureRelativePath: 'packages/adapter-gemini/examples/before-agent.prompt-only.json',
        expect: { activeMs: 3_000, fileDeltaCount: 0, waitMs: 0 },
      },
      {
        label: 'turn 2 complete',
        fixtureRelativePath: 'packages/adapter-gemini/examples/after-agent.prompt-only.json',
        expect: { activeMs: 4_000, fileDeltaCount: 0, waitMs: 0 },
      },
      {
        label: 'session end',
        fixtureRelativePath: 'packages/adapter-gemini/examples/session-end.json',
        expect: { activeMs: 3_000, fileDeltaCount: 0, waitMs: 0 },
      },
    ],
  },
  {
    name: 'tool-failure-read-only',
    cwd: '/workspace/gemini-failure',
    requiredEventNames: ['session_start', 'pre_tool_use', 'post_tool_use_failure', 'session_end'],
    secondOffsets: [0, 2, 6, 9],
    sessionId: 'gemini-failure-session',
    steps: [
      {
        label: 'session start',
        fixtureRelativePath: 'packages/adapter-gemini/examples/session-start.json',
        expect: { activeMs: 0, fileDeltaCount: 0, waitMs: 0 },
      },
      {
        label: 'before read_file',
        fixtureRelativePath: 'packages/adapter-gemini/examples/before-tool.read-file.json',
        expect: { activeMs: 2_000, fileDeltaCount: 0, waitMs: 0 },
      },
      {
        label: 'after read_file failure',
        fixtureRelativePath: 'packages/adapter-gemini/examples/after-tool-failure.read-file.json',
        expect: { activeMs: 0, fileDeltaCount: 0, waitMs: 4_000 },
      },
      {
        label: 'session end after failure',
        fixtureRelativePath: 'packages/adapter-gemini/examples/session-end.json',
        expect: { activeMs: 3_000, fileDeltaCount: 0, waitMs: 0 },
      },
    ],
  },
  {
    name: 'multi-turn-mixed',
    cwd: '/workspace/demo',
    requiredEventNames: [
      'session_start',
      'user_prompt_submit',
      'after_agent',
      'pre_tool_use',
      'post_tool_use',
      'session_end',
    ],
    secondOffsets: [0, 2, 5, 8, 10, 12, 16, 18, 20, 24],
    sessionId: 'gemini-smoke-session',
    steps: [
      {
        label: 'session start',
        fixtureRelativePath: 'packages/adapter-gemini/examples/session-start.json',
        expect: { activeMs: 0, fileDeltaCount: 0, waitMs: 0 },
      },
      {
        label: 'turn 1 prompt',
        fixtureRelativePath: 'packages/adapter-gemini/examples/before-agent.prompt-only.json',
        expect: { activeMs: 2_000, fileDeltaCount: 0, waitMs: 0 },
      },
      {
        label: 'turn 1 complete',
        fixtureRelativePath: 'packages/adapter-gemini/examples/after-agent.prompt-only.json',
        expect: { activeMs: 3_000, fileDeltaCount: 0, waitMs: 0 },
      },
      {
        label: 'before read_file',
        fixtureRelativePath: 'packages/adapter-gemini/examples/before-tool.read-file.json',
        expect: { activeMs: 3_000, fileDeltaCount: 0, waitMs: 0 },
      },
      {
        label: 'after read_file',
        fixtureRelativePath: 'packages/adapter-gemini/examples/after-tool.read-file.json',
        expect: { activeMs: 0, fileDeltaCount: 0, waitMs: 2_000 },
      },
      {
        label: 'turn 2 prompt',
        fixtureRelativePath: 'packages/adapter-gemini/examples/before-agent.prompt-only.json',
        expect: { activeMs: 2_000, fileDeltaCount: 0, waitMs: 0 },
      },
      {
        label: 'turn 2 complete',
        fixtureRelativePath: 'packages/adapter-gemini/examples/after-agent.prompt-only.json',
        expect: { activeMs: 4_000, fileDeltaCount: 0, waitMs: 0 },
      },
      {
        label: 'after write_file',
        fixtureRelativePath: 'packages/adapter-gemini/examples/after-tool.write-file.json',
        expect: {
          activeMs: 2_000,
          fileDeltaCount: 1,
          fileDeltas: [
            {
              language: 'TypeScript',
              added: 1,
              removed: 0,
            },
          ],
          languageStats: {
            TypeScript: {
              added: 1,
              removed: 0,
              changed: 1,
            },
          },
          waitMs: 0,
        },
      },
      {
        label: 'after replace',
        fixtureRelativePath: 'packages/adapter-gemini/examples/after-tool.replace.json',
        expect: {
          activeMs: 2_000,
          fileDeltaCount: 1,
          fileDeltas: [
            {
              language: 'TypeScript',
              added: 1,
              removed: 1,
            },
          ],
          languageStats: {
            TypeScript: {
              added: 1,
              removed: 1,
              changed: 2,
            },
          },
          waitMs: 0,
        },
      },
      {
        label: 'session end',
        fixtureRelativePath: 'packages/adapter-gemini/examples/session-end.json',
        expect: { activeMs: 4_000, fileDeltaCount: 0, waitMs: 0 },
      },
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
  const secondOffset = scenario.secondOffsets?.[stepIndex] ?? stepIndex
  const eventTime = new Date(Date.UTC(2026, 3, 10, 3, 0, secondOffset)).toISOString().replace('.000', '')
  const normalizedEventTime = eventTime.endsWith('Z') ? eventTime : `${eventTime}Z`

  return withOverrides(fixture, {
    session_id: scenario.sessionId,
    cwd: scenario.cwd ?? '/workspace/demo',
    event_time: normalizedEventTime,
    timestamp: normalizedEventTime,
  })
}

function formatGeminiSmokeStepLabel(step, input) {
  return `${step.label} (${input.hook_event_name})`
}

function buildExpectedSequence(scenario) {
  return scenario.steps.map((step, stepIndex) => {
    const input = materializeGeminiSmokeStep(step, scenario, stepIndex)
    return {
      label: formatGeminiSmokeStepLabel(step, input),
      host: 'gemini-cli',
      sessionId: scenario.sessionId,
      eventName: GEMINI_HOOK_EVENT_NAMES[input.hook_event_name],
    }
  })
}

function validateScenarioPayloads(payloads, scenario) {
  const scenarioProjectRoot = scenario.cwd ?? '/workspace/demo'
  const scenarioProjectName = path.basename(scenarioProjectRoot)

  payloads.forEach((payload, stepIndex) => {
    const step = scenario.steps[stepIndex]
    const expectedInput = materializeGeminiSmokeStep(step, scenario, stepIndex)
    const [event] = payload.events
    const mismatches = []
    const stepLabel = formatGeminiSmokeStepLabel(step, expectedInput)

    if (event.project_root !== scenarioProjectRoot) {
      mismatches.push(`project_root=${event.project_root ?? 'unknown'} expected ${scenarioProjectRoot}`)
    }

    if (event.project_name !== scenarioProjectName) {
      mismatches.push(`project_name=${event.project_name ?? 'unknown'} expected ${scenarioProjectName}`)
    }

    if (event.model_name !== DEFAULT_MODEL_NAME) {
      mismatches.push(`model_name=${event.model_name ?? 'unknown'} expected ${DEFAULT_MODEL_NAME}`)
    }

    if (event.event_time !== expectedInput.event_time) {
      mismatches.push(`event_time=${event.event_time ?? 'unknown'} expected ${expectedInput.event_time}`)
    }

    if (event.privacy_mode !== 'hashed') {
      mismatches.push(`privacy_mode=${event.privacy_mode ?? 'unknown'} expected hashed`)
    }

    if (step.expect?.activeMs !== undefined && event.active_ms !== step.expect.activeMs) {
      mismatches.push(`active_ms=${event.active_ms ?? 'unknown'} expected ${step.expect.activeMs}`)
    }

    if (step.expect?.waitMs !== undefined && event.wait_ms !== step.expect.waitMs) {
      mismatches.push(`wait_ms=${event.wait_ms ?? 'unknown'} expected ${step.expect.waitMs}`)
    }

    if (step.expect?.fileDeltaCount !== undefined && event.file_deltas.length !== step.expect.fileDeltaCount) {
      mismatches.push(`file_deltas=${event.file_deltas.length} expected ${step.expect.fileDeltaCount}`)
    }

    if (step.expect?.fileDeltas !== undefined) {
      const actualFileDeltas = event.file_deltas.map((delta) => ({
        language: delta.language,
        added: delta.added,
        removed: delta.removed,
      }))
      const expectedFileDeltas = step.expect.fileDeltas
      const actualFileDeltasJson = JSON.stringify(actualFileDeltas)
      const expectedFileDeltasJson = JSON.stringify(expectedFileDeltas)

      if (actualFileDeltasJson !== expectedFileDeltasJson) {
        mismatches.push(`file_deltas=${actualFileDeltasJson} expected ${expectedFileDeltasJson}`)
      }
    }

    if (step.expect?.languageStats !== undefined) {
      const actualLanguageStats = JSON.stringify(event.language_stats)
      const expectedLanguageStats = JSON.stringify(step.expect.languageStats)

      if (actualLanguageStats !== expectedLanguageStats) {
        mismatches.push(`language_stats=${actualLanguageStats} expected ${expectedLanguageStats}`)
      }
    }

    if (mismatches.length > 0) {
      throw new Error(
        [
          `Gemini smoke (${scenario.name}) metadata mismatch at step ${stepIndex + 1} "${stepLabel}".`,
          ...mismatches,
        ].join('\n'),
      )
    }
  })
}

function assertGeminiSmokePreflight() {
  assertLocalBuildExists({
    buildCommand: 'npm run build --workspace @clipulse/adapter-gemini',
    label: 'Gemini smoke',
    modulePath: adapterCliPath,
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
    const indexedSteps = scenario.steps.map((step, stepIndex) => ({
      ...step,
      stepIndex,
    }))

    const sequenced = await runSequencedSmokeSteps(
      indexedSteps,
      async (step) => {
        const input = materializeGeminiSmokeStep(step, scenario, step.stepIndex)
        return runner({
          ...step,
          label: `${scenario.name}: ${formatGeminiSmokeStepLabel(step, input)}`,
        }, input, stateDir)
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
        expectedSequence: buildExpectedSequence(scenario),
      })

      validateScenarioPayloads(payloads, scenario)
      allPayloads.push(...payloads)
    }
  }

  return {
    payloads: allPayloads,
    stdout: allStdoutChunks.join('\n'),
  }
}

export async function runGeminiSmokeMain(options = {}) {
  const stateDir = options.stateDir
    ?? process.env.CLIPULSE_STATE_DIR
    ?? await createOwnedSmokeTempDir('clipulse-gemini-smoke-')

  assertGeminiSmokePreflight()
  const { payloads, stdout } = await runGeminiSmokeScenarios({ stateDir })

  if (!payloads.flatMap((payload) => payload.events).every((event) => event.privacy_mode === 'hashed')) {
    throw new Error('Gemini smoke must keep every emitted event in hashed privacy mode.')
  }

  process.stdout.write(`${stdout}\n`)
}

function isDirectExecution() {
  const entrypoint = process.argv[1]
  if (!entrypoint) {
    return false
  }

  return import.meta.url === pathToFileURL(entrypoint).href
}

if (isDirectExecution()) {
  await runGeminiSmokeMain()
}
