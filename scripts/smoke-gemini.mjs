import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  assertLocalBuildExists,
  createOwnedSmokeTempDir,
  parseExpectedBatchLinesOutput,
  getRepoRoot,
  resolveRepoPath,
  runSmokeCommand,
} from './smoke-shared.mjs'

const repoRoot = getRepoRoot(import.meta.url)
const adapterCliRelativePath = 'packages/adapter-gemini/dist/cli.js'
const fixtureRelativePaths = [
  'packages/adapter-gemini/examples/before-tool.read-file.json',
  'packages/adapter-gemini/examples/after-tool-failure.read-file.json',
  'packages/adapter-gemini/examples/after-tool.write-file.json',
  'packages/adapter-gemini/examples/session-end.json',
]
const inputs = fixtureRelativePaths.map((fixtureRelativePath) => readFileSync(
  resolveRepoPath(import.meta.url, fixtureRelativePath),
))
const adapterCliPath = path.join(repoRoot, adapterCliRelativePath)
const stateDir = process.env.CLIPULSE_STATE_DIR ?? await createOwnedSmokeTempDir('clipulse-gemini-smoke-')

assertLocalBuildExists({
  buildCommand: 'npm run build --workspace @clipulse/adapter-gemini',
  label: 'Gemini smoke',
  modulePath: adapterCliPath,
})

const outputs = []

for (const [index, input] of inputs.entries()) {
  const result = await runSmokeCommand({
    command: 'node',
    args: [adapterCliRelativePath],
    cwd: repoRoot,
    env: {
      CLIPULSE_STATE_DIR: stateDir,
    },
    input,
    stepLabel: `gemini smoke ${index + 1}`,
  })
  outputs.push(result.stdout.trim())
}

const stdout = outputs.filter((output) => output.length > 0).join('\n')
const payloads = parseExpectedBatchLinesOutput(stdout, {
  contextLabel: 'Gemini smoke',
  expectedHost: 'gemini-cli',
  expectedSessionId: 'gemini-smoke-session',
  requiredEventNames: ['pre_tool_use', 'post_tool_use_failure', 'post_tool_use', 'session_end'],
  expectedSequence: [
    { host: 'gemini-cli', sessionId: 'gemini-smoke-session', eventName: 'pre_tool_use' },
    { host: 'gemini-cli', sessionId: 'gemini-smoke-session', eventName: 'post_tool_use_failure' },
    { host: 'gemini-cli', sessionId: 'gemini-smoke-session', eventName: 'post_tool_use' },
    { host: 'gemini-cli', sessionId: 'gemini-smoke-session', eventName: 'session_end' },
  ],
})

if (!payloads.flatMap((payload) => payload.events).some((event) => event.privacy_mode === 'hashed')) {
  throw new Error('Gemini smoke must include a hashed privacy_mode event.')
}

process.stdout.write(`${stdout}\n`)
