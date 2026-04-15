import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

import { smokeRuntimeCommand as codexSmokeRuntimeCommand } from '../scripts/smoke-codex.mjs'
import { smokeRuntimeCommand as geminiSmokeRuntimeCommand } from '../scripts/smoke-gemini.mjs'
import {
  launcherDescriptors,
  smokeRuntimeCommand as adaptersSmokeRuntimeCommand,
  smokeSuites,
} from '../scripts/smoke-adapters.mjs'
import { smokeRuntimeCommand as openCodeSmokeRuntimeCommand } from '../scripts/smoke-opencode.mjs'
import {
  formatCommandFailureMessage,
  getSmokeRuntimeCommand,
  isDirectRun,
  parseExpectedBatchLinesOutput,
  runCommand,
} from '../scripts/smoke-shared.mjs'

async function assertFileExists(filePath: string) {
  await expect(access(filePath)).resolves.toBeUndefined()
}

async function assertFileContains(filePath: URL, text: string) {
  await expect(readFile(filePath, 'utf8')).resolves.toContain(text)
}

async function loadLauncherContract(scriptPath: string) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const scriptUrl = pathToFileURL(path.join(repoRoot, scriptPath)).href
  const contractScript = [
    `const launcher = await import(${JSON.stringify(scriptUrl)});`,
    'process.stdout.write(JSON.stringify({',
    "  hasMain: typeof launcher.main === 'function',",
    '  smokeRuntimeCommand: launcher.smokeRuntimeCommand ?? null,',
    '}));',
  ].join('\n')
  const result = await runCommand(process.execPath, [
    '--input-type=module',
    '--eval',
    contractScript,
  ], {
    cwd: repoRoot,
    stepLabel: `import contract: ${scriptPath}`,
    timeoutMs: 10_000,
  })

  expect({
    code: result.code,
    stderr: result.stderr,
    stdout: result.stdout,
  }).toEqual({
    code: 0,
    stderr: '',
    stdout: expect.any(String),
  })

  return JSON.parse(result.stdout) as {
    hasMain: boolean
    smokeRuntimeCommand: string | null
  }
}

describe('self-hosted smoke launchers', () => {
  it('keeps adapter smoke suite membership pinned to stable and experimental hosts', async () => {
    expect(smokeSuites.stable).toEqual([
      {
        scriptPath: 'scripts/smoke-claude.mjs',
        stepLabel: 'adapter smoke: claude',
      },
      {
        scriptPath: 'scripts/smoke-codex.mjs',
        stepLabel: 'adapter smoke: codex',
      },
    ])
    expect(smokeSuites.experimental).toEqual([
      {
        scriptPath: 'scripts/smoke-gemini.mjs',
        stepLabel: 'adapter smoke: gemini',
      },
      {
        scriptPath: 'scripts/smoke-opencode.mjs',
        stepLabel: 'adapter smoke: opencode',
      },
    ])
  })

  it('keeps the stable self-hosted launcher on the canonical wiring suite', async () => {
    const stableScriptPath = new URL('../scripts/smoke-self-hosted.mjs', import.meta.url)

    await assertFileExists(stableScriptPath)
    await assertFileContains(stableScriptPath, "export const smokeTestPath = 'smoke/self-hosted-wiring.test.ts'")
  })

  it('ships a dedicated experimental self-hosted launcher and suite', async () => {
    const experimentalScriptPath = new URL('../scripts/smoke-self-hosted-experimental.mjs', import.meta.url)
    const experimentalSuitePath = new URL('./self-hosted-experimental.test.ts', import.meta.url)

    await assertFileExists(experimentalScriptPath)
    await assertFileExists(experimentalSuitePath)
    await assertFileContains(
      experimentalScriptPath,
      "export const launcherSmokeTestPath = 'smoke/self-hosted-launchers.test.ts'",
    )
    await assertFileContains(
      experimentalScriptPath,
      "export const smokeTestPath = 'smoke/self-hosted-experimental.test.ts'",
    )
  })

  it('keeps smoke launcher modules import-safe and exporting main()', async () => {
    await expect(loadLauncherContract('scripts/smoke-self-hosted.mjs')).resolves.toMatchObject({ hasMain: true })
    await expect(loadLauncherContract('scripts/smoke-self-hosted-experimental.mjs')).resolves.toMatchObject({
      hasMain: true,
    })
    await expect(loadLauncherContract('scripts/smoke-claude.mjs')).resolves.toMatchObject({ hasMain: true })
    await expect(loadLauncherContract('scripts/smoke-codex.mjs')).resolves.toMatchObject({ hasMain: true })
    await expect(loadLauncherContract('scripts/smoke-gemini.mjs')).resolves.toMatchObject({ hasMain: true })
    await expect(loadLauncherContract('scripts/smoke-opencode.mjs')).resolves.toMatchObject({ hasMain: true })
  })

  it('keeps smoke launchers on the shared runtime command export', async () => {
    await expect(loadLauncherContract('scripts/smoke-claude.mjs')).resolves.toMatchObject({
      hasMain: true,
      smokeRuntimeCommand: process.execPath,
    })
    await expect(loadLauncherContract('scripts/smoke-codex.mjs')).resolves.toMatchObject({
      hasMain: true,
      smokeRuntimeCommand: process.execPath,
    })
    await expect(loadLauncherContract('scripts/smoke-gemini.mjs')).resolves.toMatchObject({
      hasMain: true,
      smokeRuntimeCommand: process.execPath,
    })
    await expect(loadLauncherContract('scripts/smoke-opencode.mjs')).resolves.toMatchObject({
      hasMain: true,
      smokeRuntimeCommand: process.execPath,
    })
  })

  it('exposes structured launcher descriptors for adapter and self-hosted smoke ownership', () => {
    expect(launcherDescriptors).toEqual([
      { kind: 'adapter', mode: 'stable', path: 'scripts/smoke-claude.mjs' },
      { kind: 'adapter', mode: 'stable', path: 'scripts/smoke-codex.mjs' },
      { kind: 'adapter', mode: 'experimental', path: 'scripts/smoke-gemini.mjs' },
      { kind: 'adapter', mode: 'experimental', path: 'scripts/smoke-opencode.mjs' },
      { kind: 'self-hosted', mode: 'stable', path: 'smoke/self-hosted-wiring.test.ts' },
      { kind: 'self-hosted', mode: 'experimental', path: 'smoke/self-hosted-experimental.test.ts' },
    ])
  })

  it('pins smoke launchers to the current Node executable in this scope', () => {
    expect(getSmokeRuntimeCommand()).toBe(process.execPath)
    expect(codexSmokeRuntimeCommand).toBe(process.execPath)
    expect(geminiSmokeRuntimeCommand).toBe(process.execPath)
    expect(openCodeSmokeRuntimeCommand).toBe(process.execPath)
    expect(adaptersSmokeRuntimeCommand).toBe(process.execPath)
  })

  it('uses a shared direct-run helper for launcher entry guards', () => {
    expect(isDirectRun('file:///tmp/clipulse-smoke.mjs', [
      process.execPath,
      '/tmp/clipulse-smoke.mjs',
    ])).toBe(true)
    expect(isDirectRun('file:///tmp/clipulse-smoke.mjs', [
      process.execPath,
      '/tmp/another-script.mjs',
    ])).toBe(false)
    expect(isDirectRun('file:///tmp/clipulse-smoke.mjs', [process.execPath])).toBe(false)
  })

  it('keeps launcher descriptor paths unique and checked in', async () => {
    const uniquePaths = new Set(launcherDescriptors.map((descriptor) => descriptor.path))

    expect(uniquePaths.size).toBe(launcherDescriptors.length)

    await Promise.all(
      launcherDescriptors.map(async (descriptor) => {
        expect(descriptor.path).toMatch(/^(scripts|smoke)\//)
        expect(descriptor.path).toMatch(/\.(mjs|test\.ts)$/)
        await assertFileExists(new URL(`../${descriptor.path}`, import.meta.url))
      }),
    )
  })

  it('includes sequenced step labels in shared smoke failure output', () => {
    const message = formatCommandFailureMessage({
      args: ['scripts/smoke-codex.mjs'],
      command: process.execPath,
      cwd: '/tmp/clipulse-smoke',
      exitCode: 1,
      reason: 'exit',
      sequenceIndex: 1,
      sequenceLabel: 'fixture beta',
      sequenceTotal: 3,
      stepLabel: 'codex smoke',
      stderr: 'boom\n',
      stdout: '',
    })

    expect(message).toContain('step "codex smoke"')
    expect(message).toContain('sequence 2/3')
    expect(message).toContain('fixture beta')
  })

  it('echoes actual sequence labels when sequenced stdout does not match expectations', () => {
    expect(() => parseExpectedBatchLinesOutput([
      JSON.stringify({
        events: [{ host: 'codex', session_id: 'codex-smoke-session', event_name: 'session_start' }],
      }),
      JSON.stringify({
        events: [{ host: 'codex', session_id: 'codex-smoke-session', event_name: 'stop_failure' }],
      }),
    ].join('\n'), {
      actualSequenceLabels: ['fixture session-start', 'fixture stop-failure'],
      contextLabel: 'Codex smoke',
      expectedSequence: [
        { label: 'fixture session-start', host: 'codex', sessionId: 'codex-smoke-session', eventName: 'session_start' },
        { label: 'fixture pre-tool-use', host: 'codex', sessionId: 'codex-smoke-session', eventName: 'pre_tool_use' },
      ],
    })).toThrowError(/fixture stop-failure/i)
  })
})
