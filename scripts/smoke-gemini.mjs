import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  assertLocalBuildExists,
  createOwnedSmokeTempDir,
  getRepoRoot,
  parseSingleJsonBatchOutput,
  resolveRepoPath,
  runSmokeCommand,
} from './smoke-shared.mjs'

const repoRoot = getRepoRoot(import.meta.url)
const fixtureRelativePath = 'packages/adapter-gemini/examples/after-tool.write-file.json'
const adapterCliRelativePath = 'packages/adapter-gemini/dist/cli.js'
const fixturePath = resolveRepoPath(import.meta.url, fixtureRelativePath)
const input = readFileSync(fixturePath)
const adapterCliPath = path.join(repoRoot, adapterCliRelativePath)
const stateDir = process.env.CLIPULSE_STATE_DIR ?? await createOwnedSmokeTempDir('clipulse-gemini-smoke-')

assertLocalBuildExists({
  buildCommand: 'npm run build --workspace @clipulse/adapter-gemini',
  label: 'Gemini smoke',
  modulePath: adapterCliPath,
})

const result = await runSmokeCommand({
  command: 'node',
  args: [adapterCliRelativePath],
  cwd: repoRoot,
  env: {
    CLIPULSE_STATE_DIR: stateDir,
  },
  input,
  stepLabel: 'gemini smoke',
})

const payload = parseSingleJsonBatchOutput(result.stdout, {
  contextLabel: 'Gemini smoke',
  expectedHost: 'gemini-cli',
  expectedSessionId: 'gemini-smoke-session',
  requiredEventNames: ['post_tool_use'],
})

if (!payload.events.some((event) => event.privacy_mode === 'hashed')) {
  throw new Error('Gemini smoke must include a hashed privacy_mode event.')
}

process.stdout.write(result.stdout)
