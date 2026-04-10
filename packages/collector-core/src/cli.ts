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
  const requestedCommand = args[0] ?? 'doctor'
  const command = requestedCommand === 'pending' ? 'pending' : 'doctor'
  const stateDir = env.CLIPULSE_STATE_DIR ?? resolveStateDir()
  const summary = await inspectLocalOperatorState(stateDir)

  if (command === 'pending') {
    writeStdout(renderPending(summary))
    return
  }

  writeStdout(renderDoctor(summary, requestedCommand))
}

function renderDoctor(
  summary: Awaited<ReturnType<typeof inspectLocalOperatorState>>,
  requestedCommand = 'doctor',
): string {
  const lines = []

  if (requestedCommand !== 'doctor') {
    lines.push(`unknown command "${requestedCommand}"; falling back to doctor`)
  }

  lines.push(
    'Clipulse local operator doctor',
    `state dir: ${summary.stateDir}`,
    `ready: ${summary.payloadCounts.ready} | processing: ${summary.payloadCounts.processing} | quarantine: ${summary.payloadCounts.quarantine}`,
    `payload bytes: ready=${summary.payloadBytes.ready} processing=${summary.payloadBytes.processing} quarantine=${summary.payloadBytes.quarantine}`,
    `oldest age seconds: ready=${summary.oldestAgeSeconds.ready} processing=${summary.oldestAgeSeconds.processing} quarantine=${summary.oldestAgeSeconds.quarantine}`,
    'payload counts and bytes exclude local .meta.json sidecars',
  )

  if (!summary.stateDirExists) {
    lines.push('no local state directory yet: hooks may not have created local spool state on this machine')
  }

  const orphanTotal = summary.orphanMetadataCounts.ready
    + summary.orphanMetadataCounts.processing
    + summary.orphanMetadataCounts.quarantine
  if (orphanTotal > 0) {
    lines.push(
      `orphan metadata sidecars: ready=${summary.orphanMetadataCounts.ready} processing=${summary.orphanMetadataCounts.processing} quarantine=${summary.orphanMetadataCounts.quarantine}`,
    )
  }

  if (orphanTotal > 0 && Object.values(summary.payloadCounts).every((count) => count === 0)) {
    lines.push('orphan-only backlog: metadata sidecars remain without payload files; inspect local spool cleanup and last recovery path')
  }

  if (
    summary.payloadCounts.ready === 0
    && summary.payloadCounts.processing > 0
  ) {
    lines.push('processing-only backlog: a hook may still need to recover or flush this batch')
  }

  if (
    summary.payloadCounts.ready === 0
    && summary.payloadCounts.processing === 0
    && summary.payloadCounts.quarantine > 0
  ) {
    lines.push('quarantine-only backlog: no payload is waiting to auto-flush; inspect quarantine entries and reasons')
  }

  const reasons = Object.entries(summary.reasonCounts)
  if (reasons.length > 0) {
    lines.push(`quarantine reasons: ${reasons.map(([reason, count]) => `${reason}=${count}`).join(', ')}`)
  }

  if ((summary.reasonCounts.stale_backlog ?? 0) > 0) {
    lines.push('stale backlog retained in quarantine: inspect retention settings before replaying older payloads')
  }

  if ((summary.reasonCounts.spool_size_cap ?? 0) > 0) {
    lines.push('spool size cap quarantined older payloads: inspect backlog volume before increasing local spool limits')
  }

  return `${lines.join('\n')}\n`
}

function renderPending(summary: Awaited<ReturnType<typeof inspectLocalOperatorState>>): string {
  const lines = [
    'Clipulse local operator pending',
    `state dir: ${summary.stateDir}`,
  ]

  if (!summary.stateDirExists) {
    lines.push('no local state directory yet: hooks may not have created local spool state on this machine')
  }

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
