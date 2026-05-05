import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const CLAUDE_PACKAGE_README = new URL('../README.md', import.meta.url)
const CLAUDE_PLUGIN_MANIFEST = new URL('../.claude-plugin/plugin.json', import.meta.url)
const CLAUDE_CANONICAL_HOOKS = new URL('../hooks/hooks.json', import.meta.url)
const CLAUDE_SMOKE_SCRIPT = new URL('../../../scripts/smoke-claude.mjs', import.meta.url)
const ROOT_PACKAGE_JSON_PATH = new URL('../../../package.json', import.meta.url)

function findRequiredLineContainingAll(content: string, needles: string[]): string {
  const line = content
    .split('\n')
    .find((candidate) => needles.every((needle) => candidate.includes(needle)))
  expect(line).toBeDefined()
  return line ?? ''
}

describe('claude package docs parity', () => {
  it('keeps the checked-in plugin manifest and hooks wiring on the canonical dist cli path', () => {
    const pluginManifest = JSON.parse(readFileSync(CLAUDE_PLUGIN_MANIFEST, 'utf8')) as {
      hooks?: string
    }
    const hooksConfig = JSON.parse(readFileSync(CLAUDE_CANONICAL_HOOKS, 'utf8')) as {
      hooks?: Record<string, Array<{
        hooks?: Array<{
          type?: string
          command?: string
          async?: boolean
        }>
      }>>
    }

    expect(pluginManifest.hooks).toBe('./hooks/hooks.json')
    expect(Object.keys(hooksConfig.hooks ?? {})).toEqual([
      'SessionStart',
      'UserPromptSubmit',
      'PreToolUse',
      'PostToolUse',
      'PostToolUseFailure',
      'SubagentStart',
      'SubagentStop',
      'Stop',
      'StopFailure',
      'SessionEnd',
      'PreCompact',
    ])

    for (const hookHandlers of Object.values(hooksConfig.hooks ?? {})) {
      expect(hookHandlers).toHaveLength(1)
      expect(hookHandlers[0]?.hooks).toEqual([
        {
          type: 'command',
          command: 'node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js"',
          async: true,
        },
      ])
    }
  })

  it('keeps the package README anchored to the plugin root, canonical hooks file, and dist cli wiring', () => {
    const content = readFileSync(CLAUDE_PACKAGE_README, 'utf8')
    const wiringLine = findRequiredLineContainingAll(content, [
      '`packages/adapter-claude/.claude-plugin/`',
      'plugin manifest root',
    ])

    expect(wiringLine).toContain('`packages/adapter-claude/.claude-plugin/`')
    expect(content).toContain('`packages/adapter-claude/hooks/hooks.json` is the checked-in canonical wiring source of truth.')
    expect(content).toContain('`.claude-plugin/plugin.json` points to `./hooks/hooks.json`.')
    expect(content).toContain('`${CLAUDE_PLUGIN_ROOT}/dist/cli.js`')
  })

  it('keeps the package README smoke section aligned with the checked-in Claude fixtures and smoke script', () => {
    const content = readFileSync(CLAUDE_PACKAGE_README, 'utf8')
    const smokeLine = findRequiredLineContainingAll(content, [
      '`scripts/smoke-claude.mjs`',
      '`test/fixtures/smoke.stdin.json`',
      '`test/fixtures/smoke.transcript.jsonl`',
    ])

    expect(content).toContain('## Smoke check')
    expect(content).toContain('`scripts/smoke-claude.mjs`')
    expect(smokeLine).toContain('stdout')
  })

  it('keeps the Claude smoke script pointed at the built dist cli, checked-in fixtures, and shared smoke validation', () => {
    const content = readFileSync(CLAUDE_SMOKE_SCRIPT, 'utf8')

    expect(content).toContain('packages/adapter-claude/dist/cli.js')
    expect(content).toContain('packages/adapter-claude/test/fixtures/smoke.stdin.json')
    expect(content).toContain('packages/adapter-claude/test/fixtures/smoke.transcript.jsonl')
    expect(content).toContain('parseExpectedBatchLinesOutput')
    expect(content).toContain('runSequencedSmokeSteps')
    expect(content).toContain('process.stdout.write(combinedStdout)')
  })

  it('keeps the root smoke:claude script pointed at scripts/smoke-claude.mjs', () => {
    const packageJson = JSON.parse(readFileSync(ROOT_PACKAGE_JSON_PATH, 'utf8')) as {
      scripts?: Record<string, string>
    }

    expect(packageJson.scripts?.['smoke:claude']).toBe('node scripts/smoke-claude.mjs')
  })
})
