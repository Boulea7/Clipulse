import { describe, expect, it } from 'vitest'

import {
  buildStableReleaseAssetManifest,
  createStableReleaseChecksumFileName,
  createStableReleaseManifestFileName,
} from '../scripts/release-assets.mjs'

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
  })

  it('uses versioned manifest and checksum artifact names', () => {
    expect(createStableReleaseManifestFileName('0.1.0')).toBe(
      'clipulse-stable-release-0.1.0.manifest.json',
    )
    expect(createStableReleaseChecksumFileName('0.1.0')).toBe(
      'clipulse-stable-release-0.1.0-sha256.txt',
    )
  })
})
