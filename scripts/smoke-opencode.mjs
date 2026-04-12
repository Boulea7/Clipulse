import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { parseJsonBatchLinesOutput, runSmokeCommand } from './smoke-shared.mjs'

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

function buildSmokeDriverSource({ exampleModuleUrl, bridgeModuleUrl }) {
  return `
    const [{ runClipulseSmokeScenario }, { runOpenCodePlugin }] = await Promise.all([
      import(${JSON.stringify(exampleModuleUrl)}),
      import(${JSON.stringify(bridgeModuleUrl)}),
    ])

    await runClipulseSmokeScenario(
      {
        directory: '/workspace/demo',
        worktree: '/workspace/demo',
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

export async function main() {
  const stateDir = process.env.CLIPULSE_STATE_DIR ?? `${process.env.TMPDIR ?? '/tmp'}/clipulse-opencode-smoke`
  const repoRoot = process.cwd()
  const bridgeModulePath = path.join(repoRoot, 'packages/adapter-opencode/dist/plugin.js')

  assertOpenCodeSmokePreflight({
    repoRoot,
    bridgeModulePath,
  })

  const smokeDriverSource = buildSmokeDriverSource({
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
      CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF: '0',
      CLIPULSE_STATE_DIR: stateDir,
    },
    stepLabel: 'opencode smoke',
  })

  parseJsonBatchLinesOutput(result.stdout, {
    contextLabel: 'OpenCode smoke',
    expectedHost: 'opencode',
    expectedSessionId: 'opencode-smoke-session',
    requiredEventNames: ['session_start', 'pre_tool_use', 'file_edited', 'post_tool_use'],
  })

  process.stdout.write(result.stdout)
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  await main()
}
