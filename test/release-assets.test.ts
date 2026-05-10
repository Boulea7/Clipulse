import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  buildStableReleaseAssetManifest,
  createStableReleaseChecksumFileName,
  createStableReleaseManifestFileName,
  resolveStableReleaseAssetEntries,
  resolveStableReleaseChecksumPath,
  resolveStableReleaseManifestPath,
  verifyStableReleaseAssets,
  writeStableReleaseChecksums,
} from '../scripts/release-assets.mjs'

const tempDirs: string[] = []

function formatChecksumLine(asset: ReturnType<typeof resolveStableReleaseAssetEntries>[number]): string {
  return `${asset.sha256}  ${path.basename(asset.relativePath)}`
}

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

  it('validates present zero-byte size metadata instead of ignoring falsy values', async () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), 'clipulse-release-assets-'))
    tempDirs.push(repoRoot)
    const version = '0.1.0'

    for (const asset of resolveStableReleaseAssetEntries(repoRoot, version)) {
      await fs.mkdir(path.dirname(asset.absolutePath), { recursive: true })
      await fs.writeFile(asset.absolutePath, '', 'utf8')
    }

    const manifest = buildStableReleaseAssetManifest(repoRoot, version)
    const firstAsset = manifest.assets[0]
    if (!firstAsset) {
      throw new Error('Expected stable release manifest to include assets.')
    }
    firstAsset.sizeBytes = 1

    await fs.writeFile(resolveStableReleaseManifestPath(repoRoot, version), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    await fs.writeFile(
      resolveStableReleaseChecksumPath(repoRoot, version),
      resolveStableReleaseAssetEntries(repoRoot, version)
        .map(formatChecksumLine)
        .join('\n') + '\n',
      'utf8',
    )

    await expect(verifyStableReleaseAssets(repoRoot, version)).rejects.toThrow(
      'Stable release manifest size mismatch',
    )
  })

  it('writes checksum paths that validate after a flat GitHub release download', async () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), 'clipulse-release-assets-'))
    const downloadRoot = mkdtempSync(path.join(os.tmpdir(), 'clipulse-release-download-'))
    tempDirs.push(repoRoot, downloadRoot)
    const version = '0.1.0'

    for (const asset of resolveStableReleaseAssetEntries(repoRoot, version)) {
      await fs.mkdir(path.dirname(asset.absolutePath), { recursive: true })
      await fs.writeFile(asset.absolutePath, `${asset.id}\n`, 'utf8')
    }

    const checksumPath = await writeStableReleaseChecksums(repoRoot, version)
    await fs.copyFile(
      checksumPath,
      path.join(downloadRoot, createStableReleaseChecksumFileName(version)),
    )

    for (const asset of resolveStableReleaseAssetEntries(repoRoot, version)) {
      await fs.copyFile(asset.absolutePath, path.join(downloadRoot, path.basename(asset.relativePath)))
    }

    const checksumOutput = execFileSync(
      'shasum',
      ['-a', '256', '-c', createStableReleaseChecksumFileName(version)],
      {
        cwd: downloadRoot,
        encoding: 'utf8',
      },
    )

    expect(checksumOutput).toContain('clipulse_api-0.1.0-py3-none-any.whl: OK')
    expect(checksumOutput).toContain('clipulse-adapter-codex-0.1.0.tgz: OK')
  })

  it('rejects local cache or unpacked staging files in the release dist directory', async () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), 'clipulse-release-assets-'))
    tempDirs.push(repoRoot)
    const version = '0.1.0'

    for (const asset of resolveStableReleaseAssetEntries(repoRoot, version)) {
      await fs.mkdir(path.dirname(asset.absolutePath), { recursive: true })
      await fs.writeFile(asset.absolutePath, `${asset.id}\n`, 'utf8')
    }

    const manifest = buildStableReleaseAssetManifest(repoRoot, version)
    await fs.writeFile(resolveStableReleaseManifestPath(repoRoot, version), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    await fs.writeFile(
      resolveStableReleaseChecksumPath(repoRoot, version),
      resolveStableReleaseAssetEntries(repoRoot, version)
        .map(formatChecksumLine)
        .join('\n') + '\n',
      'utf8',
    )

    await fs.mkdir(path.join(repoRoot, 'dist', '.npm-cache', '_logs'), { recursive: true })
    await fs.writeFile(
      path.join(repoRoot, 'dist', '.npm-cache', '_logs', 'debug.log'),
      `verbose cwd ${repoRoot}\n`,
      'utf8',
    )

    await expect(verifyStableReleaseAssets(repoRoot, version)).rejects.toThrow(
      'Stable release dist contains unexpected files',
    )
  })

  it('rejects unexpected symlinks in the release dist directory', async () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), 'clipulse-release-assets-'))
    tempDirs.push(repoRoot)
    const version = '0.1.0'

    for (const asset of resolveStableReleaseAssetEntries(repoRoot, version)) {
      await fs.mkdir(path.dirname(asset.absolutePath), { recursive: true })
      await fs.writeFile(asset.absolutePath, `${asset.id}\n`, 'utf8')
    }

    const manifest = buildStableReleaseAssetManifest(repoRoot, version)
    await fs.writeFile(resolveStableReleaseManifestPath(repoRoot, version), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    await fs.writeFile(
      resolveStableReleaseChecksumPath(repoRoot, version),
      resolveStableReleaseAssetEntries(repoRoot, version)
        .map(formatChecksumLine)
        .join('\n') + '\n',
      'utf8',
    )

    await fs.symlink(resolveStableReleaseManifestPath(repoRoot, version), path.join(repoRoot, 'dist', 'latest-manifest.json'))

    await expect(verifyStableReleaseAssets(repoRoot, version)).rejects.toThrow(
      'Stable release dist contains unexpected files',
    )
  })

  it('rejects symlinks at expected release asset paths', async () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), 'clipulse-release-assets-'))
    const externalDir = mkdtempSync(path.join(os.tmpdir(), 'clipulse-release-external-'))
    tempDirs.push(repoRoot, externalDir)
    const version = '0.1.0'

    const assetEntries = resolveStableReleaseAssetEntries(repoRoot, version)
    for (const asset of assetEntries) {
      await fs.mkdir(path.dirname(asset.absolutePath), { recursive: true })
      await fs.writeFile(asset.absolutePath, `${asset.id}\n`, 'utf8')
    }

    const manifest = buildStableReleaseAssetManifest(repoRoot, version)
    await fs.writeFile(
      resolveStableReleaseManifestPath(repoRoot, version),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    )
    await writeStableReleaseChecksums(repoRoot, version)

    const wheelAsset = assetEntries.find((asset) => asset.id === 'python-wheel')
    if (!wheelAsset) {
      throw new Error('Expected the stable release asset set to include the Python wheel.')
    }
    const externalTarget = path.join(externalDir, 'external-wheel-bytes')
    await fs.writeFile(externalTarget, 'external-bytes\n', 'utf8')
    await fs.rm(wheelAsset.absolutePath)
    await fs.symlink(externalTarget, wheelAsset.absolutePath)

    await expect(() => buildStableReleaseAssetManifest(repoRoot, version)).toThrow(
      'Stable release asset must be a regular file',
    )
    await expect(verifyStableReleaseAssets(repoRoot, version)).rejects.toThrow(
      'Stable release asset must be a regular file',
    )
  })
})
