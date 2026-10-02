import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  aggregateLanguages,
  createEventId,
  createFileFingerprint,
  mergeFileDeltas,
  normalizeSessionId,
  prepareOutboundBatch,
  resolveStateDir,
  resolveProjectContext,
  guessLanguage,
  shouldSkipUnmarkedProject,
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

  it('recomputes outbound event ids after project scope normalization', () => {
    const rawEvent = {
      host: 'codex',
      host_version: '0.1.0',
      session_id: 'session-1',
      project_root: '/workspace/demo',
      project_name: 'demo',
      git_branch: 'main',
      event_name: 'stop',
      event_time: '2026-04-05T12:00:00Z',
      model_name: 'gpt-5.4',
      os_name: 'macos',
      editor_or_terminal: 'terminal',
      active_ms: 1000,
      wait_ms: 500,
      privacy_mode: 'hashed',
      language_stats: {},
      file_deltas: [],
    }
    const staleEventId = createEventId(rawEvent)

    const preparedBatch = prepareOutboundBatch({
      events: [{
        ...rawEvent,
        event_id: staleEventId,
      }],
    })
    const preparedEvent = preparedBatch.events[0]

    expect(preparedEvent?.project_root).toMatch(/^[0-9a-f]{12}$/)
    expect(preparedEvent?.event_id).toMatch(/^[0-9a-f]{64}$/)
    expect(preparedEvent?.event_id).not.toBe(staleEventId)
    expect(preparedEvent?.event_id).toBe(createEventId(preparedEvent!))
  })

  it('preserves optional usage metrics in outbound events', () => {
    const preparedBatch = prepareOutboundBatch({
      events: [{
        host: 'codex',
        host_version: '0.1.0',
        session_id: 'session-usage',
        project_root: '/workspace/demo',
        project_name: 'demo',
        git_branch: 'main',
        event_name: 'stop',
        event_time: '2026-04-05T12:00:00Z',
        model_name: 'gpt-5.4',
        os_name: 'macos',
        editor_or_terminal: 'terminal',
        active_ms: 1000,
        wait_ms: 500,
        privacy_mode: 'hashed',
        language_stats: {},
        file_deltas: [],
        provider: 'openai',
        source: 'codex',
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_tokens: 20,
        cache_read_tokens: 30,
        reasoning_tokens: 10,
        total_tokens: 210,
        cost_usd: 0.0123,
      }],
    })
    const preparedEvent = preparedBatch.events[0]

    expect(preparedEvent?.provider).toBe('openai')
    expect(preparedEvent?.source).toBe('codex')
    expect(preparedEvent?.input_tokens).toBe(100)
    expect(preparedEvent?.output_tokens).toBe(50)
    expect(preparedEvent?.cache_creation_tokens).toBe(20)
    expect(preparedEvent?.cache_read_tokens).toBe(30)
    expect(preparedEvent?.reasoning_tokens).toBe(10)
    expect(preparedEvent?.total_tokens).toBe(210)
    expect(preparedEvent?.cost_usd).toBe(0.0123)
  })

  it('normalizes equivalent UTC timestamps before hashing event ids', () => {
    const rawEvent = {
      host: 'codex',
      host_version: '0.1.0',
      session_id: 'session-utc',
      project_root: 'abc123abc123',
      project_name: 'demo',
      git_branch: 'main',
      event_name: 'stop',
      event_time: '2026-04-05T12:00:00+01:00',
      model_name: 'gpt-5.4',
      os_name: 'macos',
      editor_or_terminal: 'terminal',
      active_ms: 1000,
      wait_ms: 500,
      privacy_mode: 'hashed',
      language_stats: {},
      file_deltas: [],
    }

    expect(createEventId(rawEvent)).toBe(createEventId({
      ...rawEvent,
      event_time: '2026-04-05T11:00:00Z',
    }))
  })

  it('keeps non-zero timestamp milliseconds in event ids', () => {
    const rawEvent = {
      host: 'codex',
      host_version: '0.1.0',
      session_id: 'session-subsecond',
      project_root: 'abc123abc123',
      project_name: 'demo',
      git_branch: 'main',
      event_name: 'stop',
      event_time: '2026-04-05T12:00:00.123+01:00',
      model_name: 'gpt-5.4',
      os_name: 'macos',
      editor_or_terminal: 'terminal',
      active_ms: 1000,
      wait_ms: 500,
      privacy_mode: 'hashed',
      language_stats: {},
      file_deltas: [],
    }

    expect(createEventId(rawEvent)).toBe(createEventId({
      ...rawEvent,
      event_time: '2026-04-05T11:00:00.123Z',
    }))
    expect(createEventId(rawEvent)).not.toBe(createEventId({
      ...rawEvent,
      event_time: '2026-04-05T11:00:00.124Z',
    }))
    expect(createEventId(rawEvent)).not.toBe(createEventId({
      ...rawEvent,
      event_time: '2026-04-05T11:00:00Z',
    }))
  })

  it('matches the API event id fixture for offset timestamps with milliseconds', () => {
    const rawEvent = {
      host: 'codex',
      host_version: '0.1.0',
      session_id: 'session-cross-runtime',
      project_root: 'abc123abc123',
      project_name: 'demo',
      git_branch: 'main',
      event_name: 'stop',
      event_time: '2026-04-06T12:00:00.123+01:00',
      model_name: 'gpt-5.4',
      os_name: 'macos',
      editor_or_terminal: 'terminal',
      active_ms: 1000,
      wait_ms: 100,
      privacy_mode: 'hashed',
      language_stats: {},
      file_deltas: [],
    }

    expect(createEventId(rawEvent)).toBe(
      '743b0486ee0773c2c457c7bc66a074220bea93b2a25ff77afcd22d3a92d84db0',
    )
  })

  it('treats null optional usage fields as omitted when hashing event ids', () => {
    const rawEvent = {
      host: 'codex',
      host_version: '0.1.0',
      session_id: 'session-cross-runtime',
      project_root: 'abc123abc123',
      project_name: 'demo',
      git_branch: 'main',
      event_name: 'stop',
      event_time: '2026-04-06T12:00:00.123+01:00',
      model_name: 'gpt-5.4',
      os_name: 'macos',
      editor_or_terminal: 'terminal',
      active_ms: 1000,
      wait_ms: 100,
      privacy_mode: 'hashed',
      language_stats: {},
      file_deltas: [],
    }

    expect(createEventId({
      ...rawEvent,
      provider: null,
      source: null,
      total_tokens: null,
    })).toBe(createEventId(rawEvent))
    expect(createEventId({
      ...rawEvent,
      provider: null,
      source: null,
      total_tokens: null,
    })).toBe('743b0486ee0773c2c457c7bc66a074220bea93b2a25ff77afcd22d3a92d84db0')
  })

  it('treats naive timestamps as UTC when hashing event ids', () => {
    const rawEvent = {
      host: 'codex',
      host_version: '0.1.0',
      session_id: 'session-naive',
      project_root: 'abc123abc123',
      project_name: 'demo',
      git_branch: 'main',
      event_name: 'stop',
      event_time: '2026-04-05T11:00:00',
      model_name: 'gpt-5.4',
      os_name: 'macos',
      editor_or_terminal: 'terminal',
      active_ms: 1000,
      wait_ms: 500,
      privacy_mode: 'hashed',
      language_stats: {},
      file_deltas: [],
    }

    expect(createEventId(rawEvent)).toBe(createEventId({
      ...rawEvent,
      event_time: '2026-04-05T11:00:00Z',
    }))
  })

  it('canonicalizes session ids by trimming surrounding whitespace', () => {
    expect(normalizeSessionId('  session-1  ')).toBe('session-1')
    expect(() => normalizeSessionId('   ')).toThrow('session_id')
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

  it('keeps git scope when .clipulse-project uses an unknown keyed scope value', async () => {
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
        'project_name=workspace-app',
        'git_branch=release/app',
        'scope=unsupported',
        '',
      ].join('\n'),
      'utf-8',
    )
    const canonicalRepoRoot = await fs.realpath(repoRoot)

    const context = await resolveProjectContext(nestedCwd)

    expect(context).toEqual({
      projectRoot: canonicalRepoRoot,
      workspaceRoot,
      projectName: 'workspace-app',
      gitBranch: 'release/app',
    })
  })

  it('does not skip a marked workspace when CLIPULSE_REQUIRE_PROJECT_FILE is enabled', async () => {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-project-context-'))
    tempDirs.push(sandboxRoot)

    await fs.mkdir(sandboxRoot, { recursive: true })
    await fs.writeFile(path.join(sandboxRoot, '.clipulse-project'), 'project_name=demo\n', 'utf-8')

    await expect(shouldSkipUnmarkedProject(
      { workspaceRoot: sandboxRoot },
      { CLIPULSE_REQUIRE_PROJECT_FILE: '1' } as NodeJS.ProcessEnv,
    )).resolves.toBe(false)
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
