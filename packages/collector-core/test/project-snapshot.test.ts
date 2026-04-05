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
})

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}
