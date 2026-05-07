import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const STABLE_RELEASE_ASSET_SPECS = [
  {
    id: 'python-wheel',
    kind: 'python-wheel',
    relativePath: (version) => `dist/clipulse_api-${version}-py3-none-any.whl`,
  },
  {
    id: 'python-sdist',
    kind: 'python-sdist',
    relativePath: (version) => `dist/clipulse_api-${version}.tar.gz`,
  },
  {
    id: 'bundle-adapter-claude',
    kind: 'bundle',
    relativePath: (version) => `dist/stable-bundles/clipulse-adapter-claude-${version}.tar.gz`,
  },
  {
    id: 'bundle-adapter-codex',
    kind: 'bundle',
    relativePath: (version) => `dist/stable-bundles/clipulse-adapter-codex-${version}.tar.gz`,
  },
  {
    id: 'npm-collector-core',
    kind: 'npm-package',
    relativePath: (version) => `dist/npm-packages/clipulse-collector-core-${version}.tgz`,
  },
  {
    id: 'npm-adapter-claude',
    kind: 'npm-package',
    relativePath: (version) => `dist/npm-packages/clipulse-adapter-claude-${version}.tgz`,
  },
  {
    id: 'npm-adapter-codex',
    kind: 'npm-package',
    relativePath: (version) => `dist/npm-packages/clipulse-adapter-codex-${version}.tgz`,
  },
]

export const STABLE_RELEASE_WORKSPACES = [
  '@clipulse/collector-core',
  '@clipulse/adapter-claude',
  '@clipulse/adapter-codex',
]

export function resolveRepoRoot() {
  return fileURLToPath(new URL('..', import.meta.url))
}

export function readStableReleaseVersion(repoRoot = resolveRepoRoot()) {
  const pyprojectPath = path.join(repoRoot, 'pyproject.toml')
  const pyprojectBody = readFileSync(pyprojectPath, 'utf8')
  const match = pyprojectBody.match(/^version = "([^"]+)"$/m)
  if (!match?.[1]) {
    throw new Error(`Could not determine the stable release version from ${pyprojectPath}`)
  }

  return match[1]
}

export function createStableReleaseManifestFileName(version) {
  return `clipulse-stable-release-${version}.manifest.json`
}

export function createStableReleaseChecksumFileName(version) {
  return `clipulse-stable-release-${version}-sha256.txt`
}

export function resolveStableReleaseManifestPath(
  repoRoot = resolveRepoRoot(),
  version = readStableReleaseVersion(repoRoot),
) {
  return path.join(repoRoot, 'dist', createStableReleaseManifestFileName(version))
}

export function resolveStableReleaseChecksumPath(
  repoRoot = resolveRepoRoot(),
  version = readStableReleaseVersion(repoRoot),
) {
  return path.join(repoRoot, 'dist', createStableReleaseChecksumFileName(version))
}

function sha256Buffer(fileBuffer) {
  return createHash('sha256').update(fileBuffer).digest('hex')
}

export function resolveStableReleaseAssetEntries(
  repoRoot = resolveRepoRoot(),
  version = readStableReleaseVersion(repoRoot),
) {
  return STABLE_RELEASE_ASSET_SPECS.map((spec) => {
    const relativePath = spec.relativePath(version)
    const absolutePath = path.join(repoRoot, relativePath)
    const metadata = existsSync(absolutePath)
      ? (() => {
          const fileBuffer = readFileSync(absolutePath)
          return {
            sha256: sha256Buffer(fileBuffer),
            sizeBytes: fileBuffer.byteLength,
          }
        })()
      : {}

    return {
      id: spec.id,
      kind: spec.kind,
      relativePath,
      absolutePath,
      ...metadata,
    }
  })
}

export function buildStableReleaseAssetManifest(
  repoRoot = resolveRepoRoot(),
  version = readStableReleaseVersion(repoRoot),
) {
  const assets = resolveStableReleaseAssetEntries(repoRoot, version).map((asset) => ({
    id: asset.id,
    kind: asset.kind,
    relativePath: asset.relativePath,
    ...('sha256' in asset ? { sha256: asset.sha256 } : {}),
    ...('sizeBytes' in asset ? { sizeBytes: asset.sizeBytes } : {}),
  }))

  return {
    channel: 'stable',
    version,
    assetCount: assets.length,
    generatedBy: 'scripts/release-assets.mjs',
    assets,
  }
}

export function resolveStableReleaseAssetPaths(
  repoRoot = resolveRepoRoot(),
  version = readStableReleaseVersion(repoRoot),
) {
  return resolveStableReleaseAssetEntries(repoRoot, version).map((asset) => asset.absolutePath)
}

export function resolveExistingStableReleaseAssetPaths(
  repoRoot = resolveRepoRoot(),
  version = readStableReleaseVersion(repoRoot),
) {
  return resolveStableReleaseAssetPaths(repoRoot, version).filter((assetPath) => existsSync(assetPath))
}

function toPortableRelativePath(repoRoot, absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join('/')
}

async function collectDistFiles(distDir) {
  const entries = await fs.readdir(distDir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const absolutePath = path.join(distDir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await collectDistFiles(absolutePath))
      continue
    }
    files.push(absolutePath)
  }

  return files
}

export async function writeStableReleaseAssetManifest(
  repoRoot = resolveRepoRoot(),
  version = readStableReleaseVersion(repoRoot),
) {
  const manifestPath = resolveStableReleaseManifestPath(repoRoot, version)
  const manifest = buildStableReleaseAssetManifest(repoRoot, version)
  const tempPath = `${manifestPath}.tmp`

  await fs.mkdir(path.dirname(manifestPath), { recursive: true })
  await fs.writeFile(tempPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  await fs.rename(tempPath, manifestPath)

  return manifestPath
}

export async function writeStableReleaseChecksums(
  repoRoot = resolveRepoRoot(),
  version = readStableReleaseVersion(repoRoot),
) {
  const checksumPath = resolveStableReleaseChecksumPath(repoRoot, version)
  const assetEntries = resolveStableReleaseAssetEntries(repoRoot, version)
  const missingAssets = assetEntries.filter((asset) => !existsSync(asset.absolutePath))

  if (missingAssets.length > 0) {
    throw new Error(
      `Stable release assets missing: ${missingAssets.map((asset) => asset.relativePath).join(', ')}`,
    )
  }

  const lines = []
  for (const asset of assetEntries) {
    const digest = asset.sha256 ?? sha256Buffer(await fs.readFile(asset.absolutePath))
    lines.push(`${digest}  ${asset.relativePath}`)
  }

  await fs.mkdir(path.dirname(checksumPath), { recursive: true })
  await fs.writeFile(checksumPath, `${lines.join('\n')}\n`, 'utf8')

  return checksumPath
}

export async function verifyStableReleaseAssets(
  repoRoot = resolveRepoRoot(),
  version = readStableReleaseVersion(repoRoot),
) {
  const manifestPath = resolveStableReleaseManifestPath(repoRoot, version)
  const checksumPath = resolveStableReleaseChecksumPath(repoRoot, version)
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  const checksumLines = (await fs.readFile(checksumPath, 'utf8'))
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const assetEntries = resolveStableReleaseAssetEntries(repoRoot, version)
  const assetEntryByPath = new Map(assetEntries.map((asset) => [asset.relativePath, asset]))
  const allowedDistFiles = new Set([
    ...assetEntries.map((asset) => asset.relativePath),
    toPortableRelativePath(repoRoot, manifestPath),
    toPortableRelativePath(repoRoot, checksumPath),
  ])

  if (JSON.stringify(manifest).includes('absolutePath')) {
    throw new Error(`Stable release manifest must not publish build-machine absolute paths: ${manifestPath}`)
  }

  if (!Array.isArray(manifest.assets) || manifest.assets.length !== assetEntries.length) {
    throw new Error(`Stable release manifest asset count does not match expected assets: ${manifestPath}`)
  }

  if (checksumLines.length !== assetEntries.length) {
    throw new Error(`Stable release checksum file does not match expected asset count: ${checksumPath}`)
  }

  for (const manifestAsset of manifest.assets) {
    const assetEntry = assetEntryByPath.get(manifestAsset.relativePath)
    if (!assetEntry) {
      throw new Error(`Stable release manifest references an unknown asset: ${manifestAsset.relativePath}`)
    }

    if (manifestAsset.id !== assetEntry.id || manifestAsset.kind !== assetEntry.kind) {
      throw new Error(`Stable release manifest metadata drifted for ${manifestAsset.relativePath}`)
    }

    if (
      Object.prototype.hasOwnProperty.call(manifestAsset, 'sha256')
      && manifestAsset.sha256 !== assetEntry.sha256
    ) {
      throw new Error(`Stable release manifest sha256 mismatch for ${manifestAsset.relativePath}`)
    }

    if (
      Object.prototype.hasOwnProperty.call(manifestAsset, 'sizeBytes')
      && manifestAsset.sizeBytes !== assetEntry.sizeBytes
    ) {
      throw new Error(`Stable release manifest size mismatch for ${manifestAsset.relativePath}`)
    }
  }

  for (const line of checksumLines) {
    const match = line.match(/^([0-9a-f]{64})  (.+)$/)
    if (!match?.[1] || !match?.[2]) {
      throw new Error(`Stable release checksum line is malformed: ${line}`)
    }

    const assetEntry = assetEntryByPath.get(match[2])
    if (!assetEntry) {
      throw new Error(`Stable release checksum references an unknown asset: ${match[2]}`)
    }

    if (assetEntry.sha256 !== match[1]) {
      throw new Error(`Stable release checksum drifted for ${match[2]}`)
    }
  }

  const distFiles = await collectDistFiles(path.join(repoRoot, 'dist'))
  const unexpectedDistFiles = distFiles
    .map((distFile) => toPortableRelativePath(repoRoot, distFile))
    .filter((relativePath) => !allowedDistFiles.has(relativePath))

  if (unexpectedDistFiles.length > 0) {
    throw new Error(
      `Stable release dist contains unexpected files: ${unexpectedDistFiles.join(', ')}`,
    )
  }
}

function formatGitHubOutput(repoRoot = resolveRepoRoot(), version = readStableReleaseVersion(repoRoot)) {
  const manifestPath = resolveStableReleaseManifestPath(repoRoot, version)
  const checksumPath = resolveStableReleaseChecksumPath(repoRoot, version)
  const releasePaths = resolveExistingStableReleaseAssetPaths(repoRoot, version)
  const assetPaths = [...releasePaths, manifestPath, checksumPath]

  return [
    `version=${version}`,
    `manifest_path=${manifestPath}`,
    `checksum_path=${checksumPath}`,
    'release_paths<<EOF',
    releasePaths.join('\n'),
    'EOF',
    'asset_paths<<EOF',
    assetPaths.join('\n'),
    'EOF',
  ].join('\n')
}

async function main(argv = process.argv.slice(2)) {
  const [command = 'manifest'] = argv
  const repoRoot = resolveRepoRoot()
  const version = readStableReleaseVersion(repoRoot)

  if (command === 'manifest') {
    const manifestPath = await writeStableReleaseAssetManifest(repoRoot, version)
    console.log(manifestPath)
    return
  }

  if (command === 'checksums') {
    const checksumPath = await writeStableReleaseChecksums(repoRoot, version)
    console.log(checksumPath)
    return
  }

  if (command === 'verify') {
    await verifyStableReleaseAssets(repoRoot, version)
    console.log('stable release assets verified')
    return
  }

  if (command === 'github-output') {
    process.stdout.write(`${formatGitHubOutput(repoRoot, version)}\n`)
    return
  }

  throw new Error(`Unknown release assets command "${command}".`)
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main()
}
