import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  aggregateLanguages,
  createFileFingerprint,
  mergeFileDeltas,
  resolveProjectContext,
  guessLanguage,
} from '../src/index.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true })
    }),
  )
})

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

  it('recognizes more common project file types by extension', () => {
    expect(guessLanguage('/workspace/demo/package.json')).toBe('JSON')
    expect(guessLanguage('/workspace/demo/docker-compose.yml')).toBe('YAML')
    expect(guessLanguage('/workspace/demo/script.sh')).toBe('Shell')
    expect(guessLanguage('/workspace/demo/go.mod')).toBe('Go')
    expect(guessLanguage('/workspace/demo/README')).toBe('Markdown')
    expect(guessLanguage('/workspace/demo/src/main.rs')).toBe('Rust')
    expect(guessLanguage('/workspace/demo/src/App.vue')).toBe('Vue')
  })

  it('resolves project name and branch from a worktree-style git layout', async () => {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-project-context-'))
    tempDirs.push(sandboxRoot)

    const repoRoot = path.join(sandboxRoot, 'Clipulse')
    const worktreeRoot = path.join(repoRoot, '.worktrees', 'v1-alpha')
    const worktreeGitDir = path.join(repoRoot, '.git', 'worktrees', 'v1-alpha')

    await fs.mkdir(worktreeRoot, { recursive: true })
    await fs.mkdir(worktreeGitDir, { recursive: true })
    await fs.writeFile(path.join(worktreeRoot, '.git'), `gitdir: ${worktreeGitDir}\n`, 'utf-8')
    await fs.writeFile(path.join(worktreeGitDir, 'HEAD'), 'ref: refs/heads/feat/v1-alpha\n', 'utf-8')
    await fs.writeFile(path.join(worktreeGitDir, 'commondir'), '../..\n', 'utf-8')

    const context = await resolveProjectContext(worktreeRoot)

    expect(context).toEqual({
      projectRoot: worktreeRoot,
      projectName: 'Clipulse',
      gitBranch: 'feat/v1-alpha',
    })
  })

  it('falls back to the current directory name when a gitdir file has no commondir', async () => {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-project-context-'))
    tempDirs.push(sandboxRoot)

    const projectRoot = path.join(sandboxRoot, 'demo-submodule')
    const gitDir = path.join(sandboxRoot, '.git', 'modules', 'demo-submodule')

    await fs.mkdir(projectRoot, { recursive: true })
    await fs.mkdir(gitDir, { recursive: true })
    await fs.writeFile(path.join(projectRoot, '.git'), `gitdir: ${gitDir}\n`, 'utf-8')
    await fs.writeFile(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n', 'utf-8')

    const context = await resolveProjectContext(projectRoot)

    expect(context).toEqual({
      projectRoot: projectRoot,
      projectName: 'demo-submodule',
      gitBranch: 'main',
    })
  })

  it('walks up from a nested cwd to the nearest git-backed project root', async () => {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-project-context-'))
    tempDirs.push(sandboxRoot)

    const repoRoot = path.join(sandboxRoot, 'demo')
    const nestedCwd = path.join(repoRoot, 'src', 'features')

    await fs.mkdir(path.join(repoRoot, '.git'), { recursive: true })
    await fs.mkdir(nestedCwd, { recursive: true })
    await fs.writeFile(path.join(repoRoot, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf-8')

    const context = await resolveProjectContext(nestedCwd)

    expect(context).toEqual({
      projectRoot: repoRoot,
      projectName: 'demo',
      gitBranch: 'main',
    })
  })
})
