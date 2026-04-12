import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  parseJsonBatchLinesOutput,
  resolveRepoPath,
  runSmokeCommand,
} from './smoke-shared.mjs'

const ADAPTER_CLI_RELATIVE_PATH = 'packages/adapter-codex/dist/cli.js'
const SMOKE_PROJECT_ROOT_PLACEHOLDER = '__CODEX_SMOKE_PROJECT_ROOT__'
const SMOKE_FIXTURE_RELATIVE_PATHS = [
  'packages/adapter-codex/examples/smoke/session-start.json',
  'packages/adapter-codex/examples/smoke/pre-tool-use.json',
  'packages/adapter-codex/examples/smoke/post-tool-use-failure.json',
]

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

export async function main({
  importMetaUrl = import.meta.url,
  repoRoot = path.resolve(path.dirname(fileURLToPath(importMetaUrl)), '..'),
  stateDir,
  projectRoot = process.env.CLIPULSE_CODEX_SMOKE_PROJECT_ROOT,
} = {}) {
  const cliModulePath = path.join(repoRoot, ADAPTER_CLI_RELATIVE_PATH)
  const ownProjectRoot = !projectRoot
  const resolvedProjectRoot = projectRoot
    ?? await fsp.mkdtemp(path.join(tmpdir(), 'clipulse-codex-smoke-project-'))
  const resolvedStateDir = stateDir
    ?? process.env.CLIPULSE_STATE_DIR
    ?? await fsp.mkdtemp(path.join(tmpdir(), 'clipulse-codex-smoke-'))

  assertCodexSmokePreflight({
    repoRoot,
    cliModulePath,
  })

  try {
    await ensureSmokeProject(resolvedProjectRoot)

    const stdoutChunks = []
    for (const relativePath of SMOKE_FIXTURE_RELATIVE_PATHS) {
      if (relativePath.endsWith('post-tool-use-failure.json')) {
        await applySmokeFileChange(resolvedProjectRoot)
      }

      const fixture = loadCodexSmokeFixture(importMetaUrl, relativePath)
      const result = await runSmokeCommand({
        command: 'node',
        args: [ADAPTER_CLI_RELATIVE_PATH],
        cwd: repoRoot,
        env: {
          CLIPULSE_STATE_DIR: resolvedStateDir,
        },
        input: materializeCodexSmokeInput(fixture, resolvedProjectRoot),
        stepLabel: `codex smoke: ${fixture.hook_event_name}`,
      })

      stdoutChunks.push(result.stdout.trim())
    }

    const combinedStdout = `${stdoutChunks.filter((chunk) => chunk.length > 0).join('\n')}\n`
    const payloads = parseJsonBatchLinesOutput(combinedStdout, {
      contextLabel: 'Codex smoke',
      expectedHost: 'codex',
      expectedSessionId: 'codex-smoke-session',
      requiredEventNames: ['session_start', 'pre_tool_use', 'post_tool_use_failure'],
    })
    const finalEvent = payloads.at(-1)?.events?.[0]

    if (finalEvent?.wait_ms !== 5_000) {
      throw new Error('Codex smoke must finalize a 5000ms wait on the failure path.')
    }

    if (!Array.isArray(finalEvent?.file_deltas) || finalEvent.file_deltas.length !== 1) {
      throw new Error('Codex smoke must produce exactly one file delta on the failure path.')
    }

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
