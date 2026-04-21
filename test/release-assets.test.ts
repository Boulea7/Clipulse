import { mkdtempSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  buildStableReleaseAssetManifest,
  createStableReleaseChecksumFileName,
  createStableReleaseManifestFileName,
} from '../scripts/release-assets.mjs'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async (dir) => {
    await fs.rm(dir, { recursive: true, force: true })
  }))
})

describe('stable release asset manifest', () => {
  it('builds a single versioned manifest for Python, stable bundles, and Node tarballs', () => {
    const manifest = buildStableReleaseAssetManifest('/repo', '0.1.0')

    expect(manifest).toMatchObject({
      channel: 'stable',
      version: '0.1.0',
      assetCount: 7,
    })
    expect(manifest.assets).toEqual([
      expect.objectContaining({
        id: 'python-wheel',
        kind: 'python-wheel',
        relativePath: 'dist/clipulse_api-0.1.0-py3-none-any.whl',
      }),
      expect.objectContaining({
        id: 'python-sdist',
        kind: 'python-sdist',
        relativePath: 'dist/clipulse_api-0.1.0.tar.gz',
      }),
      expect.objectContaining({
        id: 'bundle-adapter-claude',
        kind: 'bundle',
        relativePath: 'dist/stable-bundles/clipulse-adapter-claude-0.1.0.tar.gz',
      }),
      expect.objectContaining({
        id: 'bundle-adapter-codex',
        kind: 'bundle',
        relativePath: 'dist/stable-bundles/clipulse-adapter-codex-0.1.0.tar.gz',
      }),
      expect.objectContaining({
        id: 'npm-collector-core',
        kind: 'npm-package',
        relativePath: 'dist/npm-packages/clipulse-collector-core-0.1.0.tgz',
      }),
      expect.objectContaining({
        id: 'npm-adapter-claude',
        kind: 'npm-package',
        relativePath: 'dist/npm-packages/clipulse-adapter-claude-0.1.0.tgz',
      }),
      expect.objectContaining({
        id: 'npm-adapter-codex',
        kind: 'npm-package',
        relativePath: 'dist/npm-packages/clipulse-adapter-codex-0.1.0.tgz',
      }),
    ])
    expect(JSON.stringify(manifest)).not.toContain('absolutePath')
  })

  it('uses versioned manifest and checksum artifact names', () => {
    expect(createStableReleaseManifestFileName('0.1.0')).toBe(
      'clipulse-stable-release-0.1.0.manifest.json',
    )
    expect(createStableReleaseChecksumFileName('0.1.0')).toBe(
      'clipulse-stable-release-0.1.0-sha256.txt',
    )
  })

  it('records sha256 and size metadata for assets that already exist on disk', async () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), 'clipulse-release-assets-'))
    tempDirs.push(repoRoot)

    const assetPath = path.join(repoRoot, 'dist', 'clipulse_api-0.1.0-py3-none-any.whl')
    await fs.mkdir(path.dirname(assetPath), { recursive: true })
    await fs.writeFile(assetPath, 'fixture-wheel\n', 'utf8')

    const manifest = buildStableReleaseAssetManifest(repoRoot, '0.1.0')
    const wheel = manifest.assets.find((asset) => asset.id === 'python-wheel')

    expect(wheel).toMatchObject({
      id: 'python-wheel',
      relativePath: 'dist/clipulse_api-0.1.0-py3-none-any.whl',
      sizeBytes: 14,
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
  })
})
