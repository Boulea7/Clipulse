import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const CODEX_PACKAGE_README = new URL('../README.md', import.meta.url)
const CODEX_CANONICAL_HOOKS_PATH = new URL('../examples/hooks.json', import.meta.url)
const CODEX_SMOKE_FIXTURE_DIR = new URL('../examples/smoke/', import.meta.url)
const CODEX_CANONICAL_SMOKE_FIXTURES = [
  'session-start.json',
  'pre-tool-use.json',
  'post-tool-use-failure.json',
] as const

function findRequiredLineContainingAll(content: string, needles: string[]): string {
  const line = content
    .split('\n')
    .find((candidate) => needles.every((needle) => candidate.includes(needle)))
  expect(line).toBeDefined()
  return line ?? ''
}

describe('codex package docs parity', () => {
  it('keeps examples/hooks.json as the canonical wiring source for the stable Codex hook surface', () => {
    const example = JSON.parse(readFileSync(CODEX_CANONICAL_HOOKS_PATH, 'utf8')) as {
      hooks: Record<string, unknown>
    }
    const content = readFileSync(CODEX_PACKAGE_README, 'utf8')
    const canonicalLine = findRequiredLineContainingAll(content, [
      '`examples/hooks.json`',
      'canonical wiring source',
      '`SessionStart`',
      '`UserPromptSubmit`',
      '`PreToolUse`',
      '`PostToolUse`',
      '`PostToolUseFailure`',
      '`Stop`',
      '`StopFailure`',
      '`SessionEnd`',
    ])

    expect(canonicalLine).toContain('stable Codex hook surface')
    expect(Object.keys(example.hooks)).toEqual([
      'SessionStart',
      'UserPromptSubmit',
      'PreToolUse',
      'PostToolUse',
      'PostToolUseFailure',
      'Stop',
      'StopFailure',
      'SessionEnd',
    ])
  })

  it('keeps the package README smoke anchor pointed at the checked-in Codex fixtures and smoke driver', () => {
    const content = readFileSync(CODEX_PACKAGE_README, 'utf8')
    const smokeLine = findRequiredLineContainingAll(content, [
      '`scripts/smoke-codex.mjs`',
      '`packages/adapter-codex/dist/cli.js`',
      '`examples/smoke/session-start.json`',
      '`examples/smoke/pre-tool-use.json`',
      '`examples/smoke/post-tool-use-failure.json`',
    ])

    expect(content).toContain('## Smoke check')
    expect(content).toContain('stateful `SessionStart -> PreToolUse -> file change -> PostToolUseFailure` flow')
    expect(smokeLine).toContain('stdout')

    for (const fixtureName of CODEX_CANONICAL_SMOKE_FIXTURES) {
      const fixtureContent = readFileSync(new URL(fixtureName, CODEX_SMOKE_FIXTURE_DIR), 'utf8')
      expect(fixtureContent).toContain('"session_id": "codex-smoke-session"')
    }
  })
})
