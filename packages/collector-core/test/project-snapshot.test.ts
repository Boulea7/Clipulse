import fs from 'node:fs/promises'
import os from 'node:os'
import { createHash } from 'node:crypto'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { captureProjectSnapshotDeltas } from '../src/index.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true })
    }),
  )
})

describe('captureProjectSnapshotDeltas', () => {
  it('returns incremental file deltas after a project file changes', async () => {
    const projectRoot = await makeTempDir('clipulse-project-')
    const stateDir = await makeTempDir('clipulse-state-')
    const sourceFile = path.join(projectRoot, 'src', 'app.ts')

    await fs.mkdir(path.dirname(sourceFile), { recursive: true })
    await fs.writeFile(sourceFile, 'export const a = 1;\n', 'utf-8')

    const first = await captureProjectSnapshotDeltas({
      stateDir,
      host: 'codex',
      sessionId: 'session-1',
      projectRoot,
    })

    await fs.writeFile(
      sourceFile,
      'export const a = 1;\nexport const b = 2;\n',
      'utf-8',
    )

    const second = await captureProjectSnapshotDeltas({
      stateDir,
      host: 'codex',
      sessionId: 'session-1',
      projectRoot,
    })

    expect(first).toEqual([])
    expect(second).toHaveLength(1)
    expect(second[0]?.language).toBe('TypeScript')
    expect(second[0]?.added).toBe(1)
    expect(second[0]?.removed).toBe(0)
  })

  it('stores hashed snapshot state without persisting source contents', async () => {
    const projectRoot = await makeTempDir('clipulse-project-')
    const stateDir = await makeTempDir('clipulse-state-')
    const sourceFile = path.join(projectRoot, 'src', 'app.ts')
    const originalSource = 'export const a = 1;\nconst secret = "never-store-me";\n'

    await fs.mkdir(path.dirname(sourceFile), { recursive: true })
    await fs.writeFile(sourceFile, originalSource, 'utf-8')

    const first = await captureProjectSnapshotDeltas({
      stateDir,
      host: 'codex',
      sessionId: 'session-privacy',
      projectRoot,
    })

    const snapshotPath = getSnapshotStatePath(stateDir, 'codex', 'session-privacy', projectRoot)
    const rawState = await fs.readFile(snapshotPath, 'utf-8')
    const snapshotState = JSON.parse(rawState) as {
      version: number
      files: Record<string, { contentHash: string, lineHashes: string[] }>
    }

    await fs.writeFile(
      sourceFile,
      `${originalSource}export const b = 2;\n`,
      'utf-8',
    )

    const second = await captureProjectSnapshotDeltas({
      stateDir,
      host: 'codex',
      sessionId: 'session-privacy',
      projectRoot,
    })

    expect(first).toEqual([])
    expect(rawState).not.toContain('never-store-me')
    expect(rawState).not.toContain('export const a = 1;')
    expect(snapshotState).toEqual({
      version: 3,
      salt: expect.any(String),
      files: {
        'src/app.ts': {
          contentHash: expect.any(String),
          lineHashes: [expect.any(String), expect.any(String)],
        },
      },
    })
    expect(second).toEqual([
      expect.objectContaining({
        language: 'TypeScript',
        added: 1,
        removed: 0,
      }),
    ])
  })

  it('supports candidate path narrowing, deletions, and ignored directories', async () => {
    const projectRoot = await makeTempDir('clipulse-project-')
    const stateDir = await makeTempDir('clipulse-state-')
    const trackedFile = path.join(projectRoot, 'src', 'tracked.ts')
    const ignoredFile = path.join(projectRoot, 'node_modules', 'pkg', 'index.js')

    await fs.mkdir(path.dirname(trackedFile), { recursive: true })
    await fs.mkdir(path.dirname(ignoredFile), { recursive: true })
    await fs.writeFile(trackedFile, 'export const before = 1;\n', 'utf-8')
    await fs.writeFile(ignoredFile, 'module.exports = 1;\n', 'utf-8')

    await captureProjectSnapshotDeltas({
      stateDir,
      host: 'codex',
      sessionId: 'session-2',
      projectRoot,
    })

    await fs.writeFile(
      trackedFile,
      'export const before = 1;\nexport const after = 2;\n',
      'utf-8',
    )
    await fs.rm(trackedFile)

    const deltas = await captureProjectSnapshotDeltas({
      stateDir,
      host: 'codex',
      sessionId: 'session-2',
      projectRoot,
      candidatePaths: ['src/tracked.ts', 'node_modules/pkg/index.js'],
    })

    expect(deltas).toHaveLength(1)
    expect(deltas[0]?.removed).toBe(1)
    expect(deltas[0]?.language).toBe('TypeScript')
  })

  it('ignores candidate paths that escape the project root', async () => {
    const workspaceRoot = await makeTempDir('clipulse-workspace-')
    const projectRoot = path.join(workspaceRoot, 'project')
    const stateDir = await makeTempDir('clipulse-state-')
    const sourceFile = path.join(projectRoot, 'src', 'app.ts')
    const externalFile = path.join(workspaceRoot, 'secret.txt')

    await fs.mkdir(path.dirname(sourceFile), { recursive: true })
    await fs.writeFile(sourceFile, 'export const inside = true;\n', 'utf-8')
    await fs.writeFile(externalFile, 'TOP_SECRET=1\n', 'utf-8')

    await captureProjectSnapshotDeltas({
      stateDir,
      host: 'codex',
      sessionId: 'session-outside',
      projectRoot,
    })

    await fs.writeFile(externalFile, 'TOP_SECRET=2\n', 'utf-8')

    const deltas = await captureProjectSnapshotDeltas({
      stateDir,
      host: 'codex',
      sessionId: 'session-outside',
      projectRoot,
      candidatePaths: ['../secret.txt'],
    })

    expect(deltas).toEqual([])

    const snapshotState = await fs.readFile(
      getSnapshotStatePath(stateDir, 'codex', 'session-outside', projectRoot),
      'utf-8',
    )
    expect(snapshotState).not.toContain('../secret.txt')
    expect(snapshotState).not.toContain('secret.txt')
  })

  it('treats aliased candidate paths as the same tracked file', async () => {
    const projectRoot = await makeTempDir('clipulse-project-')
    const stateDir = await makeTempDir('clipulse-state-')
    const sourceFile = path.join(projectRoot, 'src', 'app.ts')

    await fs.mkdir(path.dirname(sourceFile), { recursive: true })
    await fs.writeFile(sourceFile, 'export const stable = true;\n', 'utf-8')

    await captureProjectSnapshotDeltas({
      stateDir,
      host: 'codex',
      sessionId: 'session-alias',
      projectRoot,
      candidatePaths: ['src/app.ts'],
    })

    const deltas = await captureProjectSnapshotDeltas({
      stateDir,
      host: 'codex',
      sessionId: 'session-alias',
      projectRoot,
      candidatePaths: ['src/../src/app.ts'],
    })

    expect(deltas).toEqual([])
  })

  it('treats targeted directory moves as remove plus add deltas', async () => {
    const projectRoot = await makeTempDir('clipulse-project-')
    const stateDir = await makeTempDir('clipulse-state-')
    const sourceFile = path.join(projectRoot, 'src', 'app.ts')

    await fs.mkdir(path.dirname(sourceFile), { recursive: true })
    await fs.writeFile(sourceFile, 'export const moved = true;\n', 'utf-8')

    await captureProjectSnapshotDeltas({
      stateDir,
      host: 'codex',
      sessionId: 'session-dir-move',
      projectRoot,
    })

    await fs.mkdir(path.join(projectRoot, 'lib'), { recursive: true })
    await fs.rename(path.join(projectRoot, 'src'), path.join(projectRoot, 'lib', 'src'))

    const deltas = await captureProjectSnapshotDeltas({
      stateDir,
      host: 'codex',
      sessionId: 'session-dir-move',
      projectRoot,
      candidatePaths: ['src', 'lib/src'],
    })

    expect(deltas).toHaveLength(2)
    expect(deltas).toEqual(expect.arrayContaining([
      expect.objectContaining({ language: 'TypeScript', added: 0, removed: 1 }),
      expect.objectContaining({ language: 'TypeScript', added: 1, removed: 0 }),
    ]))
  })

  it('removes the snapshot baseline when clearAfterCapture is set', async () => {
    const projectRoot = await makeTempDir('clipulse-project-')
    const stateDir = await makeTempDir('clipulse-state-')
    const sourceFile = path.join(projectRoot, 'src', 'app.ts')

    await fs.mkdir(path.dirname(sourceFile), { recursive: true })
    await fs.writeFile(sourceFile, 'export const a = 1;\n', 'utf-8')

    await captureProjectSnapshotDeltas({
      stateDir,
      host: 'codex',
      sessionId: 'session-clear',
      projectRoot,
    })

    await fs.writeFile(sourceFile, 'export const a = 1;\nexport const b = 2;\n', 'utf-8')

    const deltas = await captureProjectSnapshotDeltas({
      stateDir,
      host: 'codex',
      sessionId: 'session-clear',
      projectRoot,
      clearAfterCapture: true,
    })

    expect(deltas).toHaveLength(1)
    await expect(fs.readdir(path.join(stateDir, 'snapshots'))).resolves.toEqual([])
  })

  it('skips unreadable project roots without wiping the previous snapshot baseline', async () => {
    const projectRoot = await makeTempDir('clipulse-project-')
    const stateDir = await makeTempDir('clipulse-state-')
    const sourceFile = path.join(projectRoot, 'src', 'app.ts')

    await fs.mkdir(path.dirname(sourceFile), { recursive: true })
    await fs.writeFile(sourceFile, 'export const a = 1;\n', 'utf-8')

    await captureProjectSnapshotDeltas({
      stateDir,
      host: 'codex',
      sessionId: 'session-3',
      projectRoot,
    })

    const missingRoot = path.join(projectRoot, 'missing-root')
    const missing = await captureProjectSnapshotDeltas({
      stateDir,
      host: 'codex',
      sessionId: 'session-3',
      projectRoot: missingRoot,
    })

    await fs.writeFile(sourceFile, 'export const a = 1;\nexport const b = 2;\n', 'utf-8')

    const recovered = await captureProjectSnapshotDeltas({
      stateDir,
      host: 'codex',
      sessionId: 'session-3',
      projectRoot,
      candidatePaths: ['src/app.ts'],
    })

    expect(missing).toEqual([])
    expect(recovered).toHaveLength(1)
    expect(recovered[0]?.added).toBe(1)
    expect(recovered[0]?.removed).toBe(0)
  })

  it('skips large files even when explicitly targeted', async () => {
    const projectRoot = await makeTempDir('clipulse-project-')
    const stateDir = await makeTempDir('clipulse-state-')
    const largeFile = path.join(projectRoot, 'src', 'huge.ts')

    await fs.mkdir(path.dirname(largeFile), { recursive: true })
    await fs.writeFile(largeFile, 'a'.repeat(262_145), 'utf-8')

    await captureProjectSnapshotDeltas({
      stateDir,
      host: 'codex',
      sessionId: 'session-4',
      projectRoot,
    })

    await fs.writeFile(largeFile, 'b'.repeat(262_145), 'utf-8')

    const deltas = await captureProjectSnapshotDeltas({
      stateDir,
      host: 'codex',
      sessionId: 'session-4',
      projectRoot,
      candidatePaths: ['src/huge.ts'],
    })

    expect(deltas).toEqual([])
  })

  it('rebuilds legacy content-based snapshot state instead of diffing against it', async () => {
    const projectRoot = await makeTempDir('clipulse-project-')
    const stateDir = await makeTempDir('clipulse-state-')
    const sourceFile = path.join(projectRoot, 'src', 'app.ts')

    await fs.mkdir(path.dirname(sourceFile), { recursive: true })
    await fs.writeFile(sourceFile, 'export const current = 2;\n', 'utf-8')

    const snapshotPath = getSnapshotStatePath(stateDir, 'codex', 'session-legacy', projectRoot)
    await fs.mkdir(path.dirname(snapshotPath), { recursive: true })
    await fs.writeFile(
      snapshotPath,
      JSON.stringify({
        'src/app.ts': 'export const legacy = 1;\n',
      }),
      'utf-8',
    )

    const deltas = await captureProjectSnapshotDeltas({
      stateDir,
      host: 'codex',
      sessionId: 'session-legacy',
      projectRoot,
    })

    const rawState = await fs.readFile(snapshotPath, 'utf-8')

    expect(deltas).toEqual([])
    expect(rawState).not.toContain('export const current = 2;')
    expect(JSON.parse(rawState)).toEqual({
      version: 3,
      salt: expect.any(String),
      files: {
        'src/app.ts': {
          contentHash: expect.any(String),
          lineHashes: [expect.any(String)],
        },
      },
    })
  })

  it('ignores private local agent directories during snapshot capture', async () => {
    const projectRoot = await makeTempDir('clipulse-project-')
    const stateDir = await makeTempDir('clipulse-state-')
    const sourceFile = path.join(projectRoot, 'src', 'app.ts')
    const agentFile = path.join(projectRoot, '.codex', 'history', 'session.json')

    await fs.mkdir(path.dirname(sourceFile), { recursive: true })
    await fs.mkdir(path.dirname(agentFile), { recursive: true })
    await fs.writeFile(sourceFile, 'export const a = 1;\n', 'utf-8')
    await fs.writeFile(agentFile, '{"token":"before"}\n', 'utf-8')

    await captureProjectSnapshotDeltas({
      stateDir,
      host: 'codex',
      sessionId: 'session-private-dirs',
      projectRoot,
    })

    await fs.writeFile(sourceFile, 'export const a = 1;\nexport const b = 2;\n', 'utf-8')
    await fs.writeFile(agentFile, '{"token":"after"}\n', 'utf-8')

    const deltas = await captureProjectSnapshotDeltas({
      stateDir,
      host: 'codex',
      sessionId: 'session-private-dirs',
      projectRoot,
    })

    expect(deltas).toEqual([
      expect.objectContaining({
        language: 'TypeScript',
        added: 1,
        removed: 0,
      }),
    ])
  })

  it('ignores sensitive env-style files during snapshot capture', async () => {
    const projectRoot = await makeTempDir('clipulse-project-')
    const stateDir = await makeTempDir('clipulse-state-')
    const sourceFile = path.join(projectRoot, 'src', 'app.ts')
    const envFile = path.join(projectRoot, '.env')

    await fs.mkdir(path.dirname(sourceFile), { recursive: true })
    await fs.writeFile(sourceFile, 'export const a = 1;\n', 'utf-8')
    await fs.writeFile(envFile, 'SECRET=before\n', 'utf-8')

    await captureProjectSnapshotDeltas({
      stateDir,
      host: 'codex',
      sessionId: 'session-5',
      projectRoot,
    })

    await fs.writeFile(sourceFile, 'export const a = 1;\nexport const b = 2;\n', 'utf-8')
    await fs.writeFile(envFile, 'SECRET=after\n', 'utf-8')

    const deltas = await captureProjectSnapshotDeltas({
      stateDir,
      host: 'codex',
      sessionId: 'session-5',
      projectRoot,
    })

    expect(deltas).toEqual([
      expect.objectContaining({
        language: 'TypeScript',
        added: 1,
        removed: 0,
      }),
    ])
  })
})

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function getSnapshotStatePath(
  stateDir: string,
  host: string,
  sessionId: string,
  projectRoot: string,
): string {
  const stateKey = [host, sessionId, projectRoot].join(':')
  return path.join(
    stateDir,
    'snapshots',
    `${host}-${createHash('sha1').update(stateKey).digest('hex')}.json`,
  )
}
