import { describe, expect, it } from 'vitest'

import {
  aggregateLanguages,
  createFileFingerprint,
  mergeFileDeltas,
} from '../src/index.js'

describe('collector core', () => {
  it('merges file deltas by file fingerprint', () => {
    const merged = mergeFileDeltas([
      { fingerprint: 'a', language: 'TypeScript', added: 10, removed: 2 },
      { fingerprint: 'a', language: 'TypeScript', added: 5, removed: 1 },
      { fingerprint: 'b', language: 'Python', added: 3, removed: 0 },
    ])

    expect(merged).toEqual([
      { fingerprint: 'a', language: 'TypeScript', added: 15, removed: 3 },
      { fingerprint: 'b', language: 'Python', added: 3, removed: 0 },
    ])
  })

  it('aggregates language totals from merged deltas', () => {
    const languages = aggregateLanguages([
      { fingerprint: 'a', language: 'TypeScript', added: 15, removed: 3 },
      { fingerprint: 'b', language: 'TypeScript', added: 2, removed: 1 },
      { fingerprint: 'c', language: 'Python', added: 3, removed: 0 },
    ])

    expect(languages).toEqual({
      TypeScript: { added: 17, removed: 4, changed: 21 },
      Python: { added: 3, removed: 0, changed: 3 },
    })
  })

  it('creates stable privacy-safe file fingerprints inside a project root', () => {
    const first = createFileFingerprint('/workspace/demo/src/app.ts', '/workspace/demo')
    const second = createFileFingerprint('/workspace/demo/src/app.ts', '/workspace/demo')

    expect(first).toBe(second)
    expect(first).not.toContain('/workspace/demo')
    expect(first.length).toBeGreaterThan(10)
  })
})

