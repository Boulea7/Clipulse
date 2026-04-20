import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  aggregateLanguages,
  createFileFingerprint,
  mergeFileDeltas,
  resolveStateDir,
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
    const canonicalRepoRoot = await fs.realpath(repoRoot)

    const context = await resolveProjectContext(worktreeRoot)

    expect(context).toEqual({
      projectRoot: canonicalRepoRoot,
      workspaceRoot: worktreeRoot,
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
    const canonicalProjectRoot = await fs.realpath(projectRoot)

    const context = await resolveProjectContext(projectRoot)

    expect(context).toEqual({
      projectRoot: canonicalProjectRoot,
      workspaceRoot: projectRoot,
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
    const canonicalRepoRoot = await fs.realpath(repoRoot)

    const context = await resolveProjectContext(nestedCwd)

    expect(context).toEqual({
      projectRoot: canonicalRepoRoot,
      workspaceRoot: repoRoot,
      projectName: 'demo',
      gitBranch: 'main',
    })
  })

  it('prefers a .clipulse-project override for project name and branch', async () => {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-project-context-'))
    tempDirs.push(sandboxRoot)

    const repoRoot = path.join(sandboxRoot, 'demo')

    await fs.mkdir(path.join(repoRoot, '.git'), { recursive: true })
    await fs.writeFile(path.join(repoRoot, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf-8')
    await fs.writeFile(
      path.join(repoRoot, '.clipulse-project'),
      'custom-project\nrelease/train\n',
      'utf-8',
    )
    const canonicalRepoRoot = await fs.realpath(repoRoot)

    const context = await resolveProjectContext(repoRoot)

    expect(context).toEqual({
      projectRoot: canonicalRepoRoot,
      workspaceRoot: repoRoot,
      projectName: 'custom-project',
      gitBranch: 'release/train',
    })
  })

  it('keeps the detected branch when .clipulse-project only overrides the project name', async () => {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-project-context-'))
    tempDirs.push(sandboxRoot)

    const repoRoot = path.join(sandboxRoot, 'demo')

    await fs.mkdir(path.join(repoRoot, '.git'), { recursive: true })
    await fs.writeFile(path.join(repoRoot, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf-8')
    await fs.writeFile(
      path.join(repoRoot, '.clipulse-project'),
      'custom-project\n',
      'utf-8',
    )
    const canonicalRepoRoot = await fs.realpath(repoRoot)

    const context = await resolveProjectContext(path.join(repoRoot, 'nested', 'cwd'))

    expect(context).toEqual({
      projectRoot: canonicalRepoRoot,
      workspaceRoot: repoRoot,
      projectName: 'custom-project',
      gitBranch: 'main',
    })
  })

  it('supports keyed .clipulse-project overrides with comments and workspace scope', async () => {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-project-context-'))
    tempDirs.push(sandboxRoot)

    const repoRoot = path.join(sandboxRoot, 'demo')
    const workspaceRoot = path.join(repoRoot, 'packages', 'app')
    const nestedCwd = path.join(workspaceRoot, 'src')

    await fs.mkdir(path.join(repoRoot, '.git'), { recursive: true })
    await fs.mkdir(nestedCwd, { recursive: true })
    await fs.writeFile(path.join(repoRoot, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf-8')
    await fs.writeFile(
      path.join(workspaceRoot, '.clipulse-project'),
      [
        '# scoped workspace marker',
        'project_name=workspace-app',
        'git_branch=release/app',
        'scope=workspace',
        '',
      ].join('\n'),
      'utf-8',
    )
    const canonicalWorkspaceRoot = await fs.realpath(workspaceRoot)

    const context = await resolveProjectContext(nestedCwd)

    expect(context).toEqual({
      projectRoot: canonicalWorkspaceRoot,
      workspaceRoot,
      projectName: 'workspace-app',
      gitBranch: 'release/app',
    })
  })

  it('uses the nearest .clipulse-project marker as the workspace boundary while keeping git scope by default', async () => {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-project-context-'))
    tempDirs.push(sandboxRoot)

    const repoRoot = path.join(sandboxRoot, 'demo')
    const workspaceRoot = path.join(repoRoot, 'packages', 'app')
    const nestedCwd = path.join(workspaceRoot, 'src')

    await fs.mkdir(path.join(repoRoot, '.git'), { recursive: true })
    await fs.mkdir(nestedCwd, { recursive: true })
    await fs.writeFile(path.join(repoRoot, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf-8')
    await fs.writeFile(
      path.join(workspaceRoot, '.clipulse-project'),
      'project_name=workspace-app\n',
      'utf-8',
    )
    const canonicalRepoRoot = await fs.realpath(repoRoot)
    const canonicalWorkspaceRoot = await fs.realpath(workspaceRoot)

    const context = await resolveProjectContext(nestedCwd)

    expect(context).toEqual({
      projectRoot: canonicalRepoRoot,
      workspaceRoot,
      projectName: 'workspace-app',
      gitBranch: 'main',
    })
  })

  it('resolves the state dir from explicit env, then XDG, then HOME fallback', () => {
    const originalEnv = {
      CLIPULSE_STATE_DIR: process.env.CLIPULSE_STATE_DIR,
      XDG_STATE_HOME: process.env.XDG_STATE_HOME,
      HOME: process.env.HOME,
    }

    try {
      process.env.CLIPULSE_STATE_DIR = '/tmp/clipulse-explicit'
      process.env.XDG_STATE_HOME = '/tmp/xdg-state'
      process.env.HOME = '/tmp/home-state'
      expect(resolveStateDir()).toBe('/tmp/clipulse-explicit')

      delete process.env.CLIPULSE_STATE_DIR
      expect(resolveStateDir()).toBe('/tmp/xdg-state/clipulse')

      delete process.env.XDG_STATE_HOME
      expect(resolveStateDir()).toBe('/tmp/home-state/.local/state/clipulse')
    } finally {
      if (originalEnv.CLIPULSE_STATE_DIR === undefined) {
        delete process.env.CLIPULSE_STATE_DIR
      } else {
        process.env.CLIPULSE_STATE_DIR = originalEnv.CLIPULSE_STATE_DIR
      }
      if (originalEnv.XDG_STATE_HOME === undefined) {
        delete process.env.XDG_STATE_HOME
      } else {
        process.env.XDG_STATE_HOME = originalEnv.XDG_STATE_HOME
      }
      if (originalEnv.HOME === undefined) {
        delete process.env.HOME
      } else {
        process.env.HOME = originalEnv.HOME
      }
    }
  })
})
