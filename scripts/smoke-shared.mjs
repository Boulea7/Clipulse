import { spawn } from 'node:child_process'

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

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

export function formatCommandFailureMessage(context) {
  const headline = context.reason === 'timeout' ? 'Command timed out' : 'Command failed'
  const lines = [
    context.stepLabel ? `${headline} at step "${context.stepLabel}".` : `${headline}.`,
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

export async function runCommand(
  command,
  args,
  {
    cwd = process.cwd(),
    env = process.env,
    input,
    stepLabel,
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
        stepLabel,
        stderr,
        stdout,
        timeoutMs,
      })))
    }, timeoutMs)

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })

    child.on('error', (error) => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timer)
      reject(new Error([
        stepLabel ? `Failed to start smoke step "${stepLabel}".` : 'Failed to start smoke command.',
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

  if (!options.allowStderr && result.stderr !== '') {
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

export async function runSmokeCommand({
  command,
  args,
  cwd = process.cwd(),
  env = {},
  input,
  stepLabel,
  timeoutMs,
  allowStderr = false,
}) {
  const result = await runCommand(command, args, {
    cwd,
    env: {
      ...process.env,
      ...env,
    },
    input,
    stepLabel,
    timeoutMs,
  })

  assertCommandSucceeded(result, {
    args,
    command,
    cwd,
    stepLabel,
  }, {
    allowStderr,
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
