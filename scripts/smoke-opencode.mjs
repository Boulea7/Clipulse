import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  createOwnedSmokeTempDir,
  parseExpectedBatchLinesOutput,
  runSmokeCommand,
} from './smoke-shared.mjs'

const OPENCODE_SMOKE_HOST = 'opencode'
const OPENCODE_SMOKE_SESSION_ID = 'opencode-smoke-session'
const OPENCODE_SMOKE_SCENARIOS = Object.freeze(['default', 'gated-session-diff'])
const OPENCODE_SMOKE_TOPOLOGIES = Object.freeze(['shared-project', 'split-project'])

function formatMissingBridgeMessage(bridgeModulePath) {
  return [
    'OpenCode smoke preflight failed: missing local bridge build.',
    `expected: ${bridgeModulePath}`,
    'Build the experimental OpenCode bridge first:',
    '  npm run build --workspace @clipulse/adapter-opencode',
    'This smoke path intentionally depends on the local dist/plugin.js output.',
  ].join('\n')
}

function formatUnsupportedStripTypesMessage(nodeVersion) {
  return [
    'OpenCode smoke preflight failed: current Node runtime does not support --experimental-strip-types.',
    `node: ${nodeVersion}`,
    'The checked-in smoke helper imports examples/clipulse.ts directly.',
    'This experimental path does not promise a broader runtime beyond that strip-types-capable Node entrypoint.',
  ].join('\n')
}

export function runtimeSupportsExperimentalStripTypes(
  allowedNodeEnvironmentFlags = process.allowedNodeEnvironmentFlags,
) {
  return typeof allowedNodeEnvironmentFlags?.has === 'function'
    && allowedNodeEnvironmentFlags.has('--experimental-strip-types')
}

export function assertOpenCodeSmokePreflight({
  repoRoot = process.cwd(),
  bridgeModulePath = path.join(repoRoot, 'packages/adapter-opencode/dist/plugin.js'),
  supportsExperimentalStripTypes = runtimeSupportsExperimentalStripTypes(),
  nodeVersion = process.version,
} = {}) {
  if (!fs.existsSync(bridgeModulePath)) {
    throw new Error(formatMissingBridgeMessage(bridgeModulePath))
  }

  if (!supportsExperimentalStripTypes) {
    throw new Error(formatUnsupportedStripTypesMessage(nodeVersion))
  }
}

function validateOpenCodeSmokeSelection(flagName, value, supportedValues) {
  if (!supportedValues.includes(value)) {
    throw new Error(`Invalid value for ${flagName}: "${value}". Expected one of: ${supportedValues.join(', ')}.`)
  }
}

export function parseOpenCodeSmokeArgs(args = process.argv.slice(2)) {
  const parsed = {
    scenario: 'default',
    topology: 'shared-project',
  }
  const seenFlags = new Set()

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]

    if (token !== '--scenario' && token !== '--topology') {
      throw new Error(`Unexpected argument "${token}". Supported flags: --scenario, --topology.`)
    }

    if (seenFlags.has(token)) {
      throw new Error(`Duplicate flag "${token}". Pass it at most once.`)
    }
    seenFlags.add(token)

    const value = args[index + 1]
    if (!value || value.startsWith('--')) {
      const supportedValues = token === '--scenario'
        ? OPENCODE_SMOKE_SCENARIOS
        : OPENCODE_SMOKE_TOPOLOGIES
      throw new Error(`${token} requires one of: ${supportedValues.join(', ')}.`)
    }

    if (token === '--scenario') {
      validateOpenCodeSmokeSelection(token, value, OPENCODE_SMOKE_SCENARIOS)
      parsed.scenario = value
    } else {
      validateOpenCodeSmokeSelection(token, value, OPENCODE_SMOKE_TOPOLOGIES)
      parsed.topology = value
    }
    index += 1
  }

  return parsed
}

export function createOpenCodeSmokePlan({
  scenario = 'default',
  topology = 'shared-project',
} = {}) {
  validateOpenCodeSmokeSelection('--scenario', scenario, OPENCODE_SMOKE_SCENARIOS)
  validateOpenCodeSmokeSelection('--topology', topology, OPENCODE_SMOKE_TOPOLOGIES)

  const isGatedScenario = scenario === 'gated-session-diff'
  const worktree = topology === 'split-project' ? '/tmp/demo-worktree' : '/workspace/demo'
  const expectedEventNames = isGatedScenario
    ? ['session_start', 'pre_tool_use', 'post_tool_use_failure', 'file_edited', 'session_end']
    : ['session_start', 'pre_tool_use', 'file_edited', 'post_tool_use']

  return {
    diffMode: isGatedScenario ? 'gated-session-diff' : 'default',
    enableSessionDiff: isGatedScenario,
    expectedFileEditPath: isGatedScenario
      ? `${worktree}/src/smoke-gated.ts`
      : `${worktree}/src/smoke.ts`,
    expectedSequence: expectedEventNames.map((eventName) => ({
      host: OPENCODE_SMOKE_HOST,
      sessionId: OPENCODE_SMOKE_SESSION_ID,
      eventName,
    })),
    scenario,
    topology,
  }
}

function buildSmokeDriverSource({ exampleModuleUrl, bridgeModuleUrl, smokePlan }) {
  const worktree = smokePlan.topology === 'split-project' ? '/tmp/demo-worktree' : '/workspace/demo'

  return `
    const [{ runClipulseSmokeScenario }, { runOpenCodePlugin }] = await Promise.all([
      import(${JSON.stringify(exampleModuleUrl)}),
      import(${JSON.stringify(bridgeModuleUrl)}),
    ])

    await runClipulseSmokeScenario(
      {
        directory: '/workspace/demo',
        diffMode: ${JSON.stringify(smokePlan.diffMode)},
        scenario: ${JSON.stringify(smokePlan.scenario)},
        topology: ${JSON.stringify(smokePlan.topology)},
        worktree: ${JSON.stringify(worktree)},
      },
      {
        runPlugin: async (dependencies) => runOpenCodePlugin({
          ...dependencies,
          stdout: {
            write: (chunk) => process.stdout.write(chunk),
          },
        }),
      },
    )
  `
}

function assertOpenCodeSmokePayloads(payloads, smokePlan) {
  const fileEditedEvent = payloads
    .map((payload) => payload.events?.[0])
    .find((event) => event?.event_name === 'file_edited')

  if (!Array.isArray(fileEditedEvent?.file_deltas) || fileEditedEvent.file_deltas.length !== 1) {
    throw new Error(`OpenCode smoke (${smokePlan.scenario}, ${smokePlan.topology}) must emit exactly one file delta.`)
  }

  const [fileDelta] = fileEditedEvent.file_deltas
  const expectedCounts = smokePlan.enableSessionDiff
    ? { added: 5, removed: 1 }
    : { added: 0, removed: 0 }

  if (fileDelta?.added !== expectedCounts.added || fileDelta?.removed !== expectedCounts.removed) {
    throw new Error(
      `OpenCode smoke (${smokePlan.scenario}, ${smokePlan.topology}) produced file delta counts `
      + `added=${String(fileDelta?.added)} removed=${String(fileDelta?.removed)} `
      + `but expected added=${expectedCounts.added} removed=${expectedCounts.removed}.`,
    )
  }
}

export async function main({
  cliArgs = process.argv.slice(2),
} = {}) {
  const smokePlan = createOpenCodeSmokePlan(parseOpenCodeSmokeArgs(cliArgs))
  const stateDir = process.env.CLIPULSE_STATE_DIR ?? await createOwnedSmokeTempDir('clipulse-opencode-smoke-')
  const repoRoot = process.cwd()
  const bridgeModulePath = path.join(repoRoot, 'packages/adapter-opencode/dist/plugin.js')

  assertOpenCodeSmokePreflight({
    repoRoot,
    bridgeModulePath,
  })

  const smokeDriverSource = buildSmokeDriverSource({
    smokePlan,
    exampleModuleUrl: pathToFileURL(
      path.join(repoRoot, 'packages/adapter-opencode/examples/clipulse.ts'),
    ).href,
    bridgeModuleUrl: pathToFileURL(bridgeModulePath).href,
  })

  const result = await runSmokeCommand({
    command: 'node',
    args: ['--disable-warning=ExperimentalWarning', '--experimental-strip-types', '--input-type=module', '--eval', smokeDriverSource],
    cwd: repoRoot,
    env: {
      CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF: smokePlan.enableSessionDiff ? '1' : '0',
      CLIPULSE_STATE_DIR: stateDir,
    },
    stepLabel: 'opencode smoke',
  })

  const payloads = parseExpectedBatchLinesOutput(result.stdout, {
    contextLabel: `OpenCode smoke (${smokePlan.scenario}, ${smokePlan.topology})`,
    expectedHost: OPENCODE_SMOKE_HOST,
    expectedSessionId: OPENCODE_SMOKE_SESSION_ID,
    requiredEventNames: smokePlan.expectedSequence.map((event) => event.eventName),
    expectedSequence: smokePlan.expectedSequence,
  })
  assertOpenCodeSmokePayloads(payloads, smokePlan)

  process.stdout.write(result.stdout)
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  await main()
}
