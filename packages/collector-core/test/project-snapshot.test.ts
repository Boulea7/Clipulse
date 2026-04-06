import fs from 'node:fs/promises'
import os from 'node:os'
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
