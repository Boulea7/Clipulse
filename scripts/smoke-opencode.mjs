import path from 'node:path'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'

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

await new Promise((resolve, reject) => {
  const child = spawn(
    'node',
    ['--disable-warning=ExperimentalWarning', '--experimental-strip-types', '--input-type=module', '--eval', smokeDriverSource],
    {
      stdio: ['ignore', 'inherit', 'inherit'],
      env: {
        ...process.env,
        CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF: '0',
        CLIPULSE_STATE_DIR: stateDir,
      },
    },
  )

  child.on('exit', (code) => {
    if (code === 0) {
      resolve(undefined)
      return
    }
    reject(new Error(`OpenCode smoke run failed with exit code ${code ?? 'unknown'}.`))
  })
  child.on('error', reject)
})
