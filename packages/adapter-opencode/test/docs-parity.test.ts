import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const OPENCODE_PACKAGE_README = new URL('../README.md', import.meta.url)
const OPENCODE_CANONICAL_WRAPPER_EXAMPLE = new URL('../examples/clipulse.ts', import.meta.url)
const OPENCODE_CANONICAL_HANDLED_SUBSET = [
  'session.created',
  'session.deleted',
  'session.idle',
  'session.error',
  'tool.execute.before',
  'tool.execute.after',
  'tool.execute.error',
  'file.edited',
] as const

function findRequiredLine(content: string, needle: string): string {
  const line = content.split('\n').find((candidate) => candidate.includes(needle))
  expect(line).toBeDefined()
  return line ?? ''
}

describe('opencode package docs parity', () => {
  it('keeps the checked-in wrapper example as the canonical handled-subset source', () => {
    const example = readFileSync(OPENCODE_CANONICAL_WRAPPER_EXAMPLE, 'utf8')
    const content = readFileSync(OPENCODE_PACKAGE_README, 'utf8')
    const handledSubsetLine = findRequiredLine(content, 'canonical handled-subset source')

    expect(content).toContain('`examples/clipulse.ts` is the canonical checked-in wrapper example and source for the current OpenCode handled subset.')

    for (const eventName of OPENCODE_CANONICAL_HANDLED_SUBSET) {
      expect(example).toContain(`'${eventName}'`)
      expect(handledSubsetLine).toContain(`\`${eventName}\``)
    }
  })

  it('keeps session.diff default-off and wrapper-only in the package README', () => {
    const example = readFileSync(OPENCODE_CANONICAL_WRAPPER_EXAMPLE, 'utf8')
    const content = readFileSync(OPENCODE_PACKAGE_README, 'utf8')

    expect(example).toContain('CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF')
    expect(example).toContain("type: 'session.diff'")
    expect(example).toContain('additions')
    expect(example).toContain('deletions')

    expect(content).toContain('keep `session.diff` out of the default ingestion path')
    expect(content).toContain('default-off unless you explicitly opt in with `CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF=1`')
    expect(content).toContain('allow an opt-in wrapper-only `CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF=1` path that strips `session.diff` down to `{ path, additions, deletions }`')
    expect(content).toContain('default server-driven, local-snapshot, or wrapper-external `session.diff` backfill outside the wrapper path')
  })

  it('documents the experimental smoke preflight assumptions in the package README', () => {
    const content = readFileSync(OPENCODE_PACKAGE_README, 'utf8')

    expect(content).toContain('`runClipulseSmokeScenario()` is a smoke-oriented helper for the checked-in wrapper path, now covering both the default `file.edited` path and a gated `session.diff` teardown path; it is still not a broader runtime contract for OpenCode integrations.')
    expect(content).toContain('`scripts/smoke-opencode.mjs` preflights both the local `dist/plugin.js` bridge build and Node support for `--experimental-strip-types` before it tries that checked-in TypeScript wrapper example.')
  })

  it('keeps alias normalization and single-live-session ownership fallback explicit in the package README', () => {
    const example = readFileSync(OPENCODE_CANONICAL_WRAPPER_EXAMPLE, 'utf8')
    const content = readFileSync(OPENCODE_PACKAGE_README, 'utf8')

    expect(example).toContain('liveSessionIds.size !== 1')
    expect(example).toContain('entry.additions')
    expect(example).toContain('entry.added')
    expect(example).toContain('entry.deletions')
    expect(example).toContain('entry.removed')

    expect(content).toContain('tolerate the current upstream `session.diff` shape aliases (`file`/`path`, `added`/`removed`, `additions`/`deletions`) before normalizing into that minimal forwarded form')
    expect(content).toContain('use the same single-live-session ownership fallback rule for both `file.edited` and gated `session.diff` backfill')
    expect(content).toContain('without an explicit `sessionID`, each path only forwards when exactly one live session is currently tracked by the wrapper')
  })
})
