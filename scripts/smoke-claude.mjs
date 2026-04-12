import path from 'node:path'
import { readFileSync } from 'node:fs'

import {
  assertLocalBuildExists,
  createOwnedSmokeTempDir,
  getRepoRoot,
  parseSingleJsonBatchOutput,
  resolveRepoPath,
  runSmokeCommand,
} from './smoke-shared.mjs'

const repoRoot = getRepoRoot(import.meta.url)
const adapterCliRelativePath = 'packages/adapter-claude/dist/cli.js'
const stdinFixturePath = resolveRepoPath(
  import.meta.url,
  'packages/adapter-claude/test/fixtures/smoke.stdin.json',
)
const transcriptFixturePath = resolveRepoPath(
  import.meta.url,
  'packages/adapter-claude/test/fixtures/smoke.transcript.jsonl',
)
const rawFixture = JSON.parse(readFileSync(stdinFixturePath, 'utf8'))
const input = JSON.stringify({
  ...rawFixture,
  transcript_path: transcriptFixturePath,
})
const adapterCliPath = path.join(repoRoot, adapterCliRelativePath)
const stateDir = process.env.CLIPULSE_STATE_DIR ?? await createOwnedSmokeTempDir('clipulse-claude-smoke-')

assertLocalBuildExists({
  buildCommand: 'npm run build --workspace @clipulse/adapter-claude',
  label: 'Claude smoke',
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
  stepLabel: 'claude smoke',
})

const payload = parseSingleJsonBatchOutput(result.stdout, {
  contextLabel: 'Claude smoke',
  expectedHost: 'claude-code',
  expectedSessionId: 'claude-smoke-session',
  requiredEventNames: ['post_tool_use'],
})

const [event] = payload.events

if (event?.privacy_mode !== 'hashed') {
  throw new Error('Claude smoke must include a hashed privacy_mode event.')
}

if (!Array.isArray(event?.file_deltas) || event.file_deltas.length !== 1) {
  throw new Error('Claude smoke must include exactly one file delta.')
}

if (event.file_deltas[0]?.language !== 'TypeScript') {
  throw new Error('Claude smoke must report a TypeScript file delta.')
}

if (event.file_deltas[0]?.added !== 1 || event.file_deltas[0]?.removed !== 0) {
  throw new Error('Claude smoke must report a +1/-0 file delta.')
}

process.stdout.write(result.stdout)
