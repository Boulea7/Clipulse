import path from 'node:path'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'

import {
  assertLocalBuildExists,
  createOwnedSmokeTempDir,
  getRepoRoot,
  getSmokeRuntimeCommand,
  isDirectRun,
  parseExpectedBatchLinesOutput,
  resolveRepoPath,
  runSequencedSmokeSteps,
  runSmokeCommand,
} from './smoke-shared.mjs'

const adapterCliRelativePath = 'packages/adapter-claude/dist/cli.js'
export const smokeRuntimeCommand = getSmokeRuntimeCommand()

function readClaudeSmokeFixture(importMetaUrl) {
  const stdinFixturePath = resolveRepoPath(
    importMetaUrl,
    'packages/adapter-claude/test/fixtures/smoke.stdin.json',
  )
  return JSON.parse(readFileSync(stdinFixturePath, 'utf8'))
}

function readClaudeSmokeTranscript(importMetaUrl) {
  const transcriptFixturePath = resolveRepoPath(
    importMetaUrl,
    'packages/adapter-claude/test/fixtures/smoke.transcript.jsonl',
  )
  return readFileSync(transcriptFixturePath, 'utf8')
}

function createClaudeSmokeSteps(importMetaUrl, transcriptPath) {
  const rawFixture = readClaudeSmokeFixture(importMetaUrl)

  return [
    {
      label: 'session start',
      eventName: 'SessionStart',
      eventTime: '2026-04-12T03:00:00Z',
      transcriptBody: '',
    },
    {
      label: 'pre tool use',
      eventName: 'PreToolUse',
      eventTime: '2026-04-12T03:00:02Z',
      transcriptBody: '',
    },
    {
      label: 'post tool use',
      eventName: 'PostToolUse',
      eventTime: '2026-04-12T03:00:07Z',
      transcriptBody: readClaudeSmokeTranscript(importMetaUrl),
    },
    {
      label: 'session end',
      eventName: 'SessionEnd',
      eventTime: '2026-04-12T03:00:08Z',
      transcriptBody: readClaudeSmokeTranscript(importMetaUrl),
    },
  ].map((step) => ({
    ...step,
    input: JSON.stringify({
      ...rawFixture,
      hook_event_name: step.eventName,
      event_time: step.eventTime,
      transcript_path: transcriptPath,
    }),
  }))
}

async function assertDirectoryEmpty(stateDir, relativePath) {
  try {
    const entries = await readdir(path.join(stateDir, relativePath))
    if (entries.length !== 0) {
      throw new Error(`Claude smoke must leave ${relativePath} empty after cleanup.`)
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return
    }
    throw error
  }
}

export async function main({
  importMetaUrl = import.meta.url,
  stateDir,
} = {}) {
  const repoRoot = getRepoRoot(importMetaUrl)
  const adapterCliPath = path.join(repoRoot, adapterCliRelativePath)
  const resolvedStateDir = stateDir
    ?? process.env.CLIPULSE_STATE_DIR
    ?? await createOwnedSmokeTempDir('clipulse-claude-smoke-')
  const ownStateDir = !stateDir && !process.env.CLIPULSE_STATE_DIR
  const transcriptPath = path.join(resolvedStateDir, 'claude-smoke.transcript.jsonl')

  assertLocalBuildExists({
    buildCommand: 'npm run build --workspace @clipulse/adapter-claude',
    label: 'Claude smoke',
    modulePath: adapterCliPath,
  })

  await mkdir(path.dirname(transcriptPath), { recursive: true })

  try {
    const sequenced = await runSequencedSmokeSteps(
      createClaudeSmokeSteps(importMetaUrl, transcriptPath),
      async (step) => {
        await writeFile(transcriptPath, step.transcriptBody, 'utf8')
        return runSmokeCommand({
          command: smokeRuntimeCommand,
          args: [adapterCliRelativePath],
          cwd: repoRoot,
          env: {
            CLIPULSE_STATE_DIR: resolvedStateDir,
          },
          input: step.input,
          sequenceIndex: step.sequenceIndex,
          sequenceLabel: step.label,
          sequenceTotal: step.sequenceTotal,
          stepLabel: `claude smoke: ${step.eventName}`,
        })
      },
    )

    const combinedStdout = sequenced.stdout === '' ? '' : `${sequenced.stdout}\n`
    const payloads = parseExpectedBatchLinesOutput(combinedStdout, {
      actualSequenceLabels: sequenced.outputs
        .filter((output) => output.stdout.trim() !== '')
        .map((output) => output.label),
      contextLabel: 'Claude smoke',
      expectedHost: 'claude-code',
      expectedSessionId: 'claude-smoke-session',
      requiredEventNames: ['session_start', 'pre_tool_use', 'post_tool_use', 'session_end'],
      expectedSequence: [
        { host: 'claude-code', sessionId: 'claude-smoke-session', eventName: 'session_start' },
        { host: 'claude-code', sessionId: 'claude-smoke-session', eventName: 'pre_tool_use' },
        { host: 'claude-code', sessionId: 'claude-smoke-session', eventName: 'post_tool_use' },
        { host: 'claude-code', sessionId: 'claude-smoke-session', eventName: 'session_end' },
      ],
    })

    const events = payloads.map((payload) => payload.events?.[0])
    const postToolUseEvent = events.find((event) => event?.event_name === 'post_tool_use')
    const sessionEndEvent = events.find((event) => event?.event_name === 'session_end')

    for (const event of events) {
      if (event?.privacy_mode !== 'hashed') {
        throw new Error('Claude smoke must include hashed privacy_mode events throughout the sequence.')
      }
    }

    if (postToolUseEvent?.wait_ms !== 5_000) {
      throw new Error('Claude smoke must finalize a 5000ms wait on the post_tool_use step.')
    }

    if (!Array.isArray(postToolUseEvent?.file_deltas) || postToolUseEvent.file_deltas.length !== 1) {
      throw new Error('Claude smoke must include exactly one file delta on the post_tool_use step.')
    }

    if (postToolUseEvent.file_deltas[0]?.language !== 'TypeScript') {
      throw new Error('Claude smoke must report a TypeScript file delta.')
    }

    if (postToolUseEvent.file_deltas[0]?.added !== 1 || postToolUseEvent.file_deltas[0]?.removed !== 0) {
      throw new Error('Claude smoke must report a +1/-0 file delta.')
    }

    if (!Array.isArray(sessionEndEvent?.file_deltas) || sessionEndEvent.file_deltas.length !== 0) {
      throw new Error('Claude smoke cleanup must not emit residual file deltas on session_end.')
    }

    await assertDirectoryEmpty(resolvedStateDir, 'claude-transcripts')
    process.stdout.write(combinedStdout)
  } finally {
    if (ownStateDir) {
      await rm(transcriptPath, { force: true })
    }
  }
}

if (isDirectRun(import.meta.url)) {
  await main()
}
