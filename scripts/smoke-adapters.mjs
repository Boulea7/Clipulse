import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getRepoRoot, getSmokeRuntimeCommand, runSmokeCommand } from './smoke-shared.mjs'

export const smokeSuites = Object.freeze({
  stable: [
    {
      scriptPath: 'scripts/smoke-claude.mjs',
      stepLabel: 'adapter smoke: claude',
    },
    {
      scriptPath: 'scripts/smoke-codex.mjs',
      stepLabel: 'adapter smoke: codex',
    },
  ],
  experimental: [
    {
      scriptPath: 'scripts/smoke-gemini.mjs',
      stepLabel: 'adapter smoke: gemini',
    },
    {
      scriptPath: 'scripts/smoke-opencode.mjs',
      stepLabel: 'adapter smoke: opencode',
    },
  ],
})

export const launcherDescriptors = Object.freeze([
  ...smokeSuites.stable.map((step) => ({ kind: 'adapter', mode: 'stable', path: step.scriptPath })),
  ...smokeSuites.experimental.map((step) => ({
    kind: 'adapter',
    mode: 'experimental',
    path: step.scriptPath,
  })),
  { kind: 'self-hosted', mode: 'stable', path: 'smoke/self-hosted-wiring.test.ts' },
  { kind: 'self-hosted', mode: 'experimental', path: 'smoke/self-hosted-experimental.test.ts' },
])
export const smokeRuntimeCommand = getSmokeRuntimeCommand()

export function resolveSelectedSuites(mode) {
  if (mode === undefined) {
    return [...Object.values(smokeSuites)]
  }

  if (mode in smokeSuites) {
    return [smokeSuites[mode]]
  }

  throw new Error(`Unknown adapter smoke mode "${mode}". Expected one of: stable, experimental.`)
}

export async function runSelectedSuites(mode = process.argv[2]) {
  const repoRoot = getRepoRoot(import.meta.url)
  const selectedSuites = resolveSelectedSuites(mode)
  const selectedSteps = selectedSuites.flat()

  for (const [sequenceIndex, smokeStep] of selectedSteps.entries()) {
    const startedAt = Date.now()
    process.stderr.write(`[clipulse smoke] start ${smokeStep.stepLabel}\n`)
    await runSmokeCommand({
      command: smokeRuntimeCommand,
      args: [smokeStep.scriptPath],
      cwd: repoRoot,
      onStdoutChunk: (chunk) => process.stdout.write(chunk),
      onStderrChunk: (chunk) => process.stderr.write(chunk),
      sequenceIndex,
      sequenceLabel: smokeStep.stepLabel,
      sequenceTotal: selectedSteps.length,
      stepLabel: smokeStep.stepLabel,
    })
    process.stderr.write(
      `[clipulse smoke] done ${smokeStep.stepLabel} (${Date.now() - startedAt}ms)\n`,
    )
  }
}

const isDirectExecution = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false

if (isDirectExecution) {
  await runSelectedSuites()
}
