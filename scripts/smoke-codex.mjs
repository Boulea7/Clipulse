import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  createOwnedSmokeTempDir,
  getSmokeRuntimeCommand,
  parseExpectedBatchLinesOutput,
  resolveRepoPath,
  runSmokeCommand,
  runSequencedSmokeSteps,
} from './smoke-shared.mjs'

const ADAPTER_CLI_RELATIVE_PATH = 'packages/adapter-codex/dist/cli.js'
const SMOKE_PROJECT_ROOT_PLACEHOLDER = '__CODEX_SMOKE_PROJECT_ROOT__'
const SMOKE_FIXTURE_RELATIVE_PATHS = [
  'packages/adapter-codex/examples/smoke/session-start.json',
  'packages/adapter-codex/examples/smoke/pre-tool-use.json',
  'packages/adapter-codex/examples/smoke/post-tool-use-failure.json',
  'packages/adapter-codex/examples/smoke/stop-failure.json',
  'packages/adapter-codex/examples/smoke/session-end.json',
]
export const smokeRuntimeCommand = getSmokeRuntimeCommand()

function formatMissingCliMessage(cliModulePath) {
  return [
    'Codex smoke preflight failed: missing local CLI build.',
    `expected: ${cliModulePath}`,
    'Build the Codex adapter first:',
    '  npm run build --workspace @clipulse/adapter-codex',
    'This smoke path intentionally depends on the local dist/cli.js output.',
  ].join('\n')
}

export function assertCodexSmokePreflight({
  repoRoot = process.cwd(),
  cliModulePath = path.join(repoRoot, ADAPTER_CLI_RELATIVE_PATH),
} = {}) {
  if (!fs.existsSync(cliModulePath)) {
    throw new Error(formatMissingCliMessage(cliModulePath))
  }
}

function loadCodexSmokeFixture(importMetaUrl, relativePath) {
  return JSON.parse(
    fs.readFileSync(resolveRepoPath(importMetaUrl, relativePath), 'utf8'),
  )
}

function materializeCodexSmokeInput(fixture, projectRoot) {
  return JSON.stringify({
    ...fixture,
    cwd: fixture.cwd === SMOKE_PROJECT_ROOT_PLACEHOLDER ? projectRoot : fixture.cwd,
  })
}

async function ensureSmokeProject(projectRoot) {
  const smokeFilePath = path.join(projectRoot, 'src', 'smoke.ts')
  await fsp.mkdir(path.dirname(smokeFilePath), { recursive: true })
  await fsp.writeFile(smokeFilePath, 'export const smoke = true;\n', 'utf8')
}

async function applySmokeFileChange(projectRoot) {
  const smokeFilePath = path.join(projectRoot, 'src', 'smoke.ts')
  await fsp.writeFile(
    smokeFilePath,
    'export const smoke = true;\nexport const changed = 1;\n',
    'utf8',
  )
}

async function assertDirectoryEmpty(stateDir, relativePath) {
  const entries = await fsp.readdir(path.join(stateDir, relativePath))
  if (entries.length !== 0) {
    throw new Error(`Codex smoke must leave ${relativePath} empty after teardown.`)
  }
}

function createCodexSmokeSteps() {
  return SMOKE_FIXTURE_RELATIVE_PATHS.map((relativePath) => ({
    label: path.basename(relativePath, '.json'),
    relativePath,
  }))
}

export async function main({
  importMetaUrl = import.meta.url,
  repoRoot = path.resolve(path.dirname(fileURLToPath(importMetaUrl)), '..'),
  stateDir,
  projectRoot = process.env.CLIPULSE_CODEX_SMOKE_PROJECT_ROOT,
} = {}) {
  const cliModulePath = path.join(repoRoot, ADAPTER_CLI_RELATIVE_PATH)
  const ownProjectRoot = !projectRoot
  const resolvedProjectRoot = projectRoot
    ?? await createOwnedSmokeTempDir('clipulse-codex-smoke-project-')
  const resolvedStateDir = stateDir
    ?? process.env.CLIPULSE_STATE_DIR
    ?? await createOwnedSmokeTempDir('clipulse-codex-smoke-')

  assertCodexSmokePreflight({
    repoRoot,
    cliModulePath,
  })

  try {
    await ensureSmokeProject(resolvedProjectRoot)

    const sequenced = await runSequencedSmokeSteps(createCodexSmokeSteps(), async (step) => {
      if (step.relativePath.endsWith('post-tool-use-failure.json')) {
        await applySmokeFileChange(resolvedProjectRoot)
      }

      const fixture = loadCodexSmokeFixture(importMetaUrl, step.relativePath)
      return runSmokeCommand({
        command: smokeRuntimeCommand,
        args: [ADAPTER_CLI_RELATIVE_PATH],
        cwd: repoRoot,
        env: {
          CLIPULSE_STATE_DIR: resolvedStateDir,
        },
        input: materializeCodexSmokeInput(fixture, resolvedProjectRoot),
        sequenceIndex: step.sequenceIndex,
        sequenceLabel: step.label ?? fixture.hook_event_name,
        sequenceTotal: step.sequenceTotal,
        stepLabel: `codex smoke: ${fixture.hook_event_name}`,
      })
    })

    const combinedStdout = sequenced.stdout === '' ? '' : `${sequenced.stdout}\n`
    const payloads = parseExpectedBatchLinesOutput(combinedStdout, {
      actualSequenceLabels: sequenced.outputs
        .filter((output) => output.stdout.trim() !== '')
        .map((output) => output.label),
      contextLabel: 'Codex smoke',
      expectedHost: 'codex',
      expectedSessionId: 'codex-smoke-session',
      requiredEventNames: [
        'session_start',
        'pre_tool_use',
        'post_tool_use_failure',
        'stop_failure',
        'session_end',
      ],
      expectedSequence: [
        { host: 'codex', sessionId: 'codex-smoke-session', eventName: 'session_start' },
        { host: 'codex', sessionId: 'codex-smoke-session', eventName: 'pre_tool_use' },
        { host: 'codex', sessionId: 'codex-smoke-session', eventName: 'post_tool_use_failure' },
        { host: 'codex', sessionId: 'codex-smoke-session', eventName: 'stop_failure' },
        { host: 'codex', sessionId: 'codex-smoke-session', eventName: 'session_end' },
      ],
    })
    const postToolUseFailureEvent = payloads
      .map((payload) => payload.events?.[0])
      .find((event) => event?.event_name === 'post_tool_use_failure')
    const teardownEvents = payloads
      .map((payload) => payload.events?.[0])
      .filter((event) => event?.event_name === 'stop_failure' || event?.event_name === 'session_end')

    if (postToolUseFailureEvent?.wait_ms !== 5_000) {
      throw new Error('Codex smoke must finalize a 5000ms wait on the failure path.')
    }

    if (!Array.isArray(postToolUseFailureEvent?.file_deltas) || postToolUseFailureEvent.file_deltas.length !== 1) {
      throw new Error('Codex smoke must produce exactly one file delta on the failure path.')
    }

    for (const event of teardownEvents) {
      if (!Array.isArray(event?.file_deltas) || event.file_deltas.length !== 0) {
        throw new Error('Codex smoke teardown events must not emit residual file deltas.')
      }
    }

    await assertDirectoryEmpty(resolvedStateDir, 'sessions')
    await assertDirectoryEmpty(resolvedStateDir, 'snapshots')

    process.stdout.write(combinedStdout)
  } finally {
    if (ownProjectRoot) {
      await fsp.rm(resolvedProjectRoot, { recursive: true, force: true })
    }
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  await main()
}
