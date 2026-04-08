import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { inspectLocalOperatorState, resolveStateDir } from './index.js'

interface CollectorCoreCliDependencies {
  args?: string[]
  env?: NodeJS.ProcessEnv
  stdout?: {
    write: (chunk: string) => void
  }
}

export async function runCollectorCoreCli(
  dependencies: CollectorCoreCliDependencies = {},
): Promise<void> {
  const args = dependencies.args ?? process.argv.slice(2)
  const env = dependencies.env ?? process.env
  const writeStdout = dependencies.stdout?.write ?? process.stdout.write.bind(process.stdout)
  const command = args[0] ?? 'doctor'
  const stateDir = env.CLIPULSE_STATE_DIR ?? resolveStateDir()
  const summary = await inspectLocalOperatorState(stateDir)

  if (command === 'pending') {
    writeStdout(renderPending(summary))
    return
  }

  writeStdout(renderDoctor(summary))
}

function renderDoctor(summary: Awaited<ReturnType<typeof inspectLocalOperatorState>>): string {
  const lines = [
    'Clipulse local operator doctor',
    `state dir: ${summary.stateDir}`,
    `ready: ${summary.payloadCounts.ready} | processing: ${summary.payloadCounts.processing} | quarantine: ${summary.payloadCounts.quarantine}`,
    `payload bytes: ready=${summary.payloadBytes.ready} processing=${summary.payloadBytes.processing} quarantine=${summary.payloadBytes.quarantine}`,
    `oldest age seconds: ready=${summary.oldestAgeSeconds.ready} processing=${summary.oldestAgeSeconds.processing} quarantine=${summary.oldestAgeSeconds.quarantine}`,
    'payload counts and bytes exclude local .meta.json sidecars',
  ]

  const orphanTotal = summary.orphanMetadataCounts.ready
    + summary.orphanMetadataCounts.processing
    + summary.orphanMetadataCounts.quarantine
  if (orphanTotal > 0) {
    lines.push(
      `orphan metadata sidecars: ready=${summary.orphanMetadataCounts.ready} processing=${summary.orphanMetadataCounts.processing} quarantine=${summary.orphanMetadataCounts.quarantine}`,
    )
  }

  if (
    summary.payloadCounts.ready === 0
    && summary.payloadCounts.processing > 0
  ) {
    lines.push('processing-only backlog: a hook may still need to recover or flush this batch')
  }

  const reasons = Object.entries(summary.reasonCounts)
  if (reasons.length > 0) {
    lines.push(`quarantine reasons: ${reasons.map(([reason, count]) => `${reason}=${count}`).join(', ')}`)
  }

  return `${lines.join('\n')}\n`
}

function renderPending(summary: Awaited<ReturnType<typeof inspectLocalOperatorState>>): string {
  const lines = [
    'Clipulse local operator pending',
    `state dir: ${summary.stateDir}`,
  ]

  if (summary.entries.length === 0) {
    lines.push('no payload backlog entries')
  } else {
    for (const entry of summary.entries) {
      const parts = [
        `[${entry.state}] ${entry.fileName}`,
        `events=${entry.eventCount}`,
        `bytes=${entry.approxBytes}`,
      ]
      if (entry.attemptCount !== null) {
        parts.push(`attempts=${entry.attemptCount}`)
      }
      if (entry.firstSeenAt) {
        parts.push(`first_seen_at=${entry.firstSeenAt}`)
      }
      if (entry.lastAttemptedAt) {
        parts.push(`last_attempted_at=${entry.lastAttemptedAt}`)
      }
      if (entry.reason) {
        parts.push(`reason=${entry.reason}`)
      }
      if (entry.sourceState) {
        parts.push(`source_state=${entry.sourceState}`)
      }
      lines.push(parts.join(' | '))
    }
  }

  const orphanTotal = summary.orphanMetadataCounts.ready
    + summary.orphanMetadataCounts.processing
    + summary.orphanMetadataCounts.quarantine
  if (orphanTotal > 0) {
    lines.push(
      `orphan metadata sidecars: ready=${summary.orphanMetadataCounts.ready} processing=${summary.orphanMetadataCounts.processing} quarantine=${summary.orphanMetadataCounts.quarantine}`,
    )
  }

  return `${lines.join('\n')}\n`
}

function isDirectExecution(): boolean {
  const entrypoint = process.argv[1]
  if (!entrypoint) {
    return false
  }

  return import.meta.url === pathToFileURL(entrypoint).href
}

if (isDirectExecution()) {
  void runCollectorCoreCli()
}
