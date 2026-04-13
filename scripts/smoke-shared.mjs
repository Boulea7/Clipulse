import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

export function getSmokeRuntimeCommand() {
  return process.execPath || 'node'
}

function formatCommandText(command, args) {
  return [command, ...args]
    .map((token) => (/\s/.test(token) ? JSON.stringify(token) : token))
    .join(' ')
}

function formatOutputSection(label, value) {
  const trimmed = value.trimEnd()
  if (trimmed === '') {
    return `${label}: (empty)`
  }

  return `${label}:\n${trimmed}`
}

function normalizeStderrAllowlist(stderrAllowlist) {
  if (!stderrAllowlist) {
    return []
  }

  return Array.isArray(stderrAllowlist) ? stderrAllowlist : [stderrAllowlist]
}

function matchesAllowlistEntry(line, entry) {
  if (typeof entry === 'string') {
    return line.includes(entry)
  }

  if (entry instanceof RegExp) {
    return entry.test(line)
  }

  return false
}

function isAllowedStderr(stderr, stderrAllowlist) {
  const allowlist = normalizeStderrAllowlist(stderrAllowlist)
  if (!allowlist.length) {
    return false
  }

  const stderrLines = stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')

  if (!stderrLines.length) {
    return false
  }

  return stderrLines.every((line) => allowlist.some((entry) => matchesAllowlistEntry(line, entry)))
}

export function formatCommandFailureMessage(context) {
  const headline = context.reason === 'timeout' ? 'Command timed out' : 'Command failed'
  const sequenceContext = formatSequenceContext(context)
  const location = formatFailureLocation(context.stepLabel, sequenceContext)
  const lines = [
    location ? `${headline} at ${location}.` : `${headline}.`,
    `command: ${formatCommandText(context.command, context.args)}`,
    `cwd: ${context.cwd}`,
  ]

  if (context.reason === 'timeout') {
    lines.push(`timeout_ms: ${context.timeoutMs ?? 'unknown'}`)
  }

  lines.push(`exit code: ${context.exitCode === null ? 'null' : String(context.exitCode ?? 'unknown')}`)
  lines.push(formatOutputSection('stdout', context.stdout ?? ''))
  lines.push(formatOutputSection('stderr', context.stderr ?? ''))

  return lines.join('\n')
}

function formatFailureLocation(stepLabel, sequenceContext) {
  if (stepLabel && sequenceContext) {
    return `step "${stepLabel}" (${sequenceContext})`
  }

  if (stepLabel) {
    return `step "${stepLabel}"`
  }

  return sequenceContext
}

function formatSequenceContext(context) {
  const hasIndex = Number.isInteger(context.sequenceIndex) && Number.isInteger(context.sequenceTotal)
  const hasValidBounds = hasIndex && context.sequenceIndex >= 0 && context.sequenceTotal > 0
  const trimmedLabel = typeof context.sequenceLabel === 'string' ? context.sequenceLabel.trim() : ''
  const labelSuffix = trimmedLabel !== '' ? ` [${trimmedLabel}]` : ''

  if (hasValidBounds) {
    return `sequence ${context.sequenceIndex + 1}/${context.sequenceTotal}${labelSuffix}`
  }

  if (trimmedLabel !== '') {
    return `sequence${labelSuffix}`
  }

  return null
}

export async function runCommand(
  command,
  args,
  {
    cwd = process.cwd(),
    env = process.env,
    input,
    onStderrChunk,
    onStdoutChunk,
    stepLabel,
    sequenceIndex,
    sequenceLabel,
    sequenceTotal,
    timeoutMs = 20_000,
  } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      if (settled) {
        return
      }

      settled = true
      child.kill('SIGKILL')
      reject(new Error(formatCommandFailureMessage({
        args,
        command,
        cwd,
        exitCode: child.exitCode,
        reason: 'timeout',
        sequenceIndex,
        sequenceLabel,
        sequenceTotal,
        stepLabel,
        stderr,
        stdout,
        timeoutMs,
      })))
    }, timeoutMs)

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
      onStdoutChunk?.(chunk)
    })

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
      onStderrChunk?.(chunk)
    })

    child.on('error', (error) => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timer)
      reject(new Error([
        buildSmokeStartFailureHeadline({
          sequenceIndex,
          sequenceLabel,
          sequenceTotal,
          stepLabel,
        }),
        `command: ${formatCommandText(command, args)}`,
        `cwd: ${cwd}`,
        `error: ${error.message}`,
      ].join('\n')))
    })

    child.on('close', (code) => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })

    if (typeof input === 'string' || Buffer.isBuffer(input)) {
      child.stdin.end(input)
      return
    }

    child.stdin.end()
  })
}

function buildSmokeStartFailureHeadline(context) {
  const sequenceContext = formatSequenceContext(context)
  const location = formatFailureLocation(context.stepLabel, sequenceContext)

  if (location) {
    return `Failed to start smoke command at ${location}.`
  }

  return 'Failed to start smoke command.'
}

export function assertCommandSucceeded(result, context, options = {}) {
  if (result.code !== 0) {
    throw new Error(formatCommandFailureMessage({
      ...context,
      exitCode: result.code,
      reason: 'exit',
      stderr: result.stderr,
      stdout: result.stdout,
    }))
  }

  if (!options.allowStderr && result.stderr !== '' && !isAllowedStderr(result.stderr, options.stderrAllowlist)) {
    throw new Error(formatCommandFailureMessage({
      ...context,
      exitCode: result.code,
      reason: 'stderr',
      stderr: result.stderr,
      stdout: result.stdout,
    }))
  }
}

function parseJsonBatch(rawText, contextLabel) {
  const trimmed = rawText.trim()
  if (trimmed === '') {
    throw new Error(`${contextLabel} produced empty stdout.`)
  }

  let payload
  try {
    payload = JSON.parse(trimmed)
  } catch (error) {
    throw new Error(`${contextLabel} produced invalid JSON stdout: ${error.message}`)
  }

  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.events)) {
    throw new Error(`${contextLabel} must produce a JSON object with an events array.`)
  }

  return payload
}

function validateSmokeEvents(payloads, { expectedHost, expectedSessionId, requiredEventNames = [] }, contextLabel) {
  const events = payloads.flatMap((payload) => payload.events)

  if (!events.length) {
    throw new Error(`${contextLabel} must produce at least one event.`)
  }

  for (const event of events) {
    if (!event || typeof event !== 'object') {
      throw new Error(`${contextLabel} produced a non-object event.`)
    }

    if (expectedHost && event.host !== expectedHost) {
      throw new Error(`${contextLabel} produced unexpected host "${event.host ?? 'unknown'}".`)
    }

    if (expectedSessionId && event.session_id !== expectedSessionId) {
      throw new Error(`${contextLabel} produced inconsistent session_id "${event.session_id ?? 'unknown'}".`)
    }
  }

  const eventNames = new Set(events.map((event) => event.event_name))
  for (const requiredEventName of requiredEventNames) {
    if (!eventNames.has(requiredEventName)) {
      throw new Error(`${contextLabel} is missing required event "${requiredEventName}".`)
    }
  }

  return events
}

export function parseSingleJsonBatchOutput(stdout, options = {}) {
  const payload = parseJsonBatch(stdout, options.contextLabel ?? 'Smoke command')
  validateSmokeEvents([payload], options, options.contextLabel ?? 'Smoke command')
  return payload
}

export function parseJsonBatchLinesOutput(stdout, options = {}) {
  const nonEmptyLines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')

  if (!nonEmptyLines.length) {
    throw new Error(`${options.contextLabel ?? 'Smoke command'} produced empty stdout.`)
  }

  const payloads = nonEmptyLines.map((line) => parseJsonBatch(line, options.contextLabel ?? 'Smoke command'))
  validateSmokeEvents(payloads, options, options.contextLabel ?? 'Smoke command')
  return payloads
}

function formatEventSummaryLine(index, event) {
  const label = typeof event?.label === 'string' && event.label.trim() !== '' ? ` [${event.label}]` : ''
  return `${index + 1}.${label} host=${event?.host ?? 'unknown'} session_id=${event?.session_id ?? 'unknown'} event_name=${event?.event_name ?? 'unknown'}`
}

function formatActualSequenceSummary(payloads, actualSequenceLabels = []) {
  const events = payloads.flatMap((payload) => payload.events)
  if (!events.length) {
    return '(empty)'
  }

  return events
    .map((event, index) =>
      formatEventSummaryLine(index, {
        ...event,
        label: event?.label ?? actualSequenceLabels[index],
      }),
    )
    .join('\n')
}

function formatExpectedSequenceSummary(expectedSequence) {
  if (!expectedSequence.length) {
    return '(empty)'
  }

  return expectedSequence
    .map((expectedBatch, index) =>
      formatEventSummaryLine(index, {
        event_name: expectedBatch?.eventName,
        host: expectedBatch?.host,
        label: expectedBatch?.label,
        session_id: expectedBatch?.sessionId,
      }),
    )
    .join('\n')
}

export async function runSequencedSmokeSteps(steps, runner) {
  const outputs = []
  const sequenceTotal = steps.length

  for (const [sequenceIndex, step] of steps.entries()) {
    const sequencedStep = {
      ...step,
      sequenceIndex,
      sequenceTotal,
    }
    const result = await runner(sequencedStep)
    outputs.push({
      label: step.label ?? null,
      sequenceIndex,
      sequenceTotal,
      stdout: result.stdout ?? '',
    })
  }

  return {
    outputs,
    stdout: outputs
      .map((output) => output.stdout.trim())
      .filter((stdout) => stdout !== '')
      .join('\n'),
  }
}

export function parseExpectedBatchLinesOutput(stdout, options = {}) {
  const contextLabel = options.contextLabel ?? 'Smoke command'
  const payloads = parseJsonBatchLinesOutput(stdout, options)
  const expectedSequence = Array.isArray(options.expectedSequence) ? options.expectedSequence : []
  const actualSequenceLabels = Array.isArray(options.actualSequenceLabels) ? options.actualSequenceLabels : []
  const actualSequenceSummary = formatActualSequenceSummary(payloads, actualSequenceLabels)
  const expectedSequenceSummary = formatExpectedSequenceSummary(expectedSequence)

  if (!expectedSequence.length) {
    return payloads
  }

  if (payloads.length !== expectedSequence.length) {
    throw new Error(
      [
        `${contextLabel} produced ${payloads.length} batch lines, expected ${expectedSequence.length}.`,
        'expected sequence:',
        expectedSequenceSummary,
        'actual sequence:',
        actualSequenceSummary,
      ].join('\n'),
    )
  }

  payloads.forEach((payload, lineIndex) => {
    const expectedBatch = expectedSequence[lineIndex]
    if (payload.events.length !== 1) {
      throw new Error(
        [
          `${contextLabel} line ${lineIndex + 1} must contain exactly 1 event, received ${payload.events.length}.`,
          'expected sequence:',
          expectedSequenceSummary,
          'actual sequence:',
          actualSequenceSummary,
        ].join('\n'),
      )
    }

    const [event] = payload.events
    const mismatches = []

    if (expectedBatch?.host && event.host !== expectedBatch.host) {
      mismatches.push(`host=${event.host ?? 'unknown'} expected ${expectedBatch.host}`)
    }

    if (expectedBatch?.sessionId && event.session_id !== expectedBatch.sessionId) {
      mismatches.push(`session_id=${event.session_id ?? 'unknown'} expected ${expectedBatch.sessionId}`)
    }

    if (expectedBatch?.eventName && event.event_name !== expectedBatch.eventName) {
      mismatches.push(`event_name=${event.event_name ?? 'unknown'} expected ${expectedBatch.eventName}`)
    }

    if (mismatches.length > 0) {
      throw new Error(
        [
          `${contextLabel} line ${lineIndex + 1} event 1 mismatch: ${mismatches.join(', ')}.`,
          'expected sequence:',
          expectedSequenceSummary,
          'actual sequence:',
          actualSequenceSummary,
        ].join('\n'),
      )
    }
  })

  return payloads
}

export async function createOwnedSmokeTempDir(prefix) {
  return mkdtemp(path.join(tmpdir(), prefix))
}

export function assertLocalBuildExists({
  buildCommand,
  label,
  modulePath,
}) {
  if (fs.existsSync(modulePath)) {
    return
  }

  throw new Error([
    `${label} preflight failed: missing local build output.`,
    `expected: ${modulePath}`,
    `Build it first:`,
    `  ${buildCommand}`,
  ].join('\n'))
}

export async function runSmokeCommand({
  command,
  args,
  cwd = process.cwd(),
  env = {},
  input,
  onStderrChunk,
  onStdoutChunk,
  stepLabel,
  sequenceIndex,
  sequenceLabel,
  sequenceTotal,
  timeoutMs,
  allowStderr = false,
  stderrAllowlist,
}) {
  const result = await runCommand(command, args, {
    cwd,
    env: {
      ...process.env,
      ...env,
    },
    input,
    onStderrChunk,
    onStdoutChunk,
    stepLabel,
    sequenceIndex,
    sequenceLabel,
    sequenceTotal,
    timeoutMs,
  })

  assertCommandSucceeded(result, {
    args,
    command,
    cwd,
    sequenceIndex,
    sequenceLabel,
    sequenceTotal,
    stepLabel,
  }, {
    allowStderr,
    stderrAllowlist,
  })

  return result
}

export async function runNpmScript(name, options = {}) {
  return runSmokeCommand({
    command: npmCommand,
    args: ['run', name],
    stepLabel: `npm run ${name}`,
    ...options,
  })
}

export function getRepoRoot(importMetaUrl) {
  return path.resolve(path.dirname(fileURLToPath(importMetaUrl)), '..')
}

export function resolveRepoPath(importMetaUrl, relativePath) {
  return path.join(getRepoRoot(importMetaUrl), relativePath)
}

export async function runVitestSmokeFile({
  config = false,
  environment = 'node',
  root = process.cwd(),
  smokeTestPath,
}) {
  const { startVitest } = await import('vitest/node')
  const resolvedRoot = path.resolve(root)
  const resolvedSmokeTestPath = path.resolve(resolvedRoot, smokeTestPath)
  const testPathFromRoot = path.relative(resolvedRoot, resolvedSmokeTestPath)
  const previousCwd = process.cwd()

  process.chdir(resolvedRoot)

  try {
    const context = await startVitest('test', [testPathFromRoot], {
      config,
      environment,
      root: resolvedRoot,
    })
    const failed = context?.state.getCountOfFailedTests?.() ?? 0
    await context?.close()
    return failed
  } finally {
    process.chdir(previousCwd)
  }
}
