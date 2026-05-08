#!/usr/bin/env node
import fs from 'node:fs'
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
    `state dir kind: ${summary.stateDirKind}`,
    `ready: ${summary.payloadCounts.ready} | processing: ${summary.payloadCounts.processing} | quarantine: ${summary.payloadCounts.quarantine}`,
    `payload bytes: ready=${summary.payloadBytes.ready} processing=${summary.payloadBytes.processing} quarantine=${summary.payloadBytes.quarantine}`,
    `oldest age seconds: ready=${summary.oldestAgeSeconds.ready} processing=${summary.oldestAgeSeconds.processing} quarantine=${summary.oldestAgeSeconds.quarantine}`,
    'payload counts and bytes exclude local .meta.json sidecars',
  )

  if (summary.terminalFinalizerMarkers > 0) {
    lines.push(`terminal finalizer markers: ${summary.terminalFinalizerMarkers}`)
  }

  if (summary.lastSuccessfulFlushAt) {
    lines.push(`last successful flush: ${summary.lastSuccessfulFlushAt}`)
  }

  if (!summary.stateDirExists) {
    lines.push('no local state directory yet: hooks may not have created local spool state on this machine')
  }

  if (summary.stateDirKind === 'file') {
    lines.push('local state path is a file: set CLIPULSE_STATE_DIR to a directory or remove the file before restarting hooks')
  } else if (summary.unreadableStateCount > 0) {
    lines.push(`local spool unavailable: ${summary.unreadableStateCount} spool state directories could not be read`)
  }

  if (
    summary.payloadCounts.quarantine > 0
    && (summary.payloadCounts.ready > 0 || summary.payloadCounts.processing > 0)
  ) {
    lines.push('mixed backlog: flushable payloads coexist with quarantine entries')
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
    && summary.payloadCounts.quarantine === 0
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

  const metadataErrorLine = renderMetadataErrorLine(summary)
  if (metadataErrorLine) {
    lines.push(metadataErrorLine)
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
    `state dir kind: ${summary.stateDirKind}`,
  ]

  if (summary.terminalFinalizerMarkers > 0) {
    lines.push(`terminal finalizer markers: ${summary.terminalFinalizerMarkers}`)
  }

  if (!summary.stateDirExists) {
    lines.push('no local state directory yet: hooks may not have created local spool state on this machine')
    lines.push('pending backlog unavailable without local state yet')
  } else if (summary.stateDirKind === 'file') {
    lines.push('local state path is a file: set CLIPULSE_STATE_DIR to a directory or remove the file before restarting hooks')
    lines.push('pending backlog unavailable until local state directory is usable')
  } else if (summary.unreadableStateCount > 0) {
    lines.push(`local spool unavailable: ${summary.unreadableStateCount} spool state directories could not be read`)
    lines.push('pending backlog unavailable until local state directory is readable')
  } else if (summary.entries.length === 0) {
    lines.push('no payload backlog entries')
  } else {
    lines.push('approx_bytes reports an approximate payload-size hint from the payload file or local quarantine metadata.')
    for (const entry of summary.entries) {
      const parts = [
        `[${entry.state}] ${entry.fileName}`,
        `events=${entry.eventCount}`,
        `approx_bytes=${entry.approxBytes}`,
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

  const metadataErrorLine = renderMetadataErrorLine(summary)
  if (metadataErrorLine) {
    lines.push(metadataErrorLine)
  }

  return `${lines.join('\n')}\n`
}

function renderMetadataErrorLine(summary: Awaited<ReturnType<typeof inspectLocalOperatorState>>): string | null {
  const states = ['ready', 'processing', 'quarantine'] as const
  const hasNonQuarantineErrors = states
    .filter((state) => state !== 'quarantine')
    .some((state) => (
      summary.metadataErrorCounts[state].readError > 0
      || summary.metadataErrorCounts[state].parseError > 0
    ))
  if (hasNonQuarantineErrors) {
    const stateParts = states.map((state) => {
      const counts = summary.metadataErrorCounts[state]
      return `${state}(read_error=${counts.readError} parse_error=${counts.parseError})`
    })
    return `metadata errors by state: ${stateParts.join(' ')}`
  }

  if (
    summary.quarantineMetadataErrorCounts.readError > 0
    || summary.quarantineMetadataErrorCounts.parseError > 0
  ) {
    return `quarantine metadata errors: read_error=${summary.quarantineMetadataErrorCounts.readError} parse_error=${summary.quarantineMetadataErrorCounts.parseError}`
  }

  return null
}

function isDirectExecution(): boolean {
  const entrypoint = process.argv[1]
  if (!entrypoint) {
    return false
  }

  return import.meta.url === pathToFileURL(fs.realpathSync(entrypoint)).href
}

if (isDirectExecution()) {
  void runCollectorCoreCli()
}
