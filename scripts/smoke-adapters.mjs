import { runSmokeCommand } from './smoke-shared.mjs'
import { getRepoRoot } from './smoke-shared.mjs'

const smokeSuites = {
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
}

function resolveSelectedSuites(mode) {
  if (mode === undefined) {
    return [...Object.values(smokeSuites)]
  }

  if (mode in smokeSuites) {
    return [smokeSuites[mode]]
  }

  throw new Error(`Unknown adapter smoke mode "${mode}". Expected one of: stable, experimental.`)
}

const repoRoot = getRepoRoot(import.meta.url)
const selectedSuites = resolveSelectedSuites(process.argv[2])

for (const smokeSuite of selectedSuites) {
  for (const smokeStep of smokeSuite) {
    const startedAt = Date.now()
    process.stderr.write(`[clipulse smoke] start ${smokeStep.stepLabel}\n`)
    await runSmokeCommand({
      command: 'node',
      args: [smokeStep.scriptPath],
      cwd: repoRoot,
      onStdoutChunk: (chunk) => process.stdout.write(chunk),
      onStderrChunk: (chunk) => process.stderr.write(chunk),
      stepLabel: smokeStep.stepLabel,
    })
    process.stderr.write(
      `[clipulse smoke] done ${smokeStep.stepLabel} (${Date.now() - startedAt}ms)\n`,
    )
  }
}
