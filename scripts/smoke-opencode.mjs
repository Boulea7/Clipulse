import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { parseJsonBatchLinesOutput, runSmokeCommand } from './smoke-shared.mjs'

const stateDir = process.env.CLIPULSE_STATE_DIR ?? `${process.env.TMPDIR ?? '/tmp'}/clipulse-opencode-smoke`
const repoRoot = process.cwd()
const exampleModuleUrl = pathToFileURL(
  path.join(repoRoot, 'packages/adapter-opencode/examples/clipulse.ts'),
).href
const bridgeModuleUrl = pathToFileURL(
  path.join(repoRoot, 'packages/adapter-opencode/dist/plugin.js'),
).href

const smokeDriverSource = `
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
