import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

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
  return path.resolve(new URL('..', import.meta.url).pathname)
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

export function buildStableReleaseAssetManifest(
  repoRoot = resolveRepoRoot(),
  version = readStableReleaseVersion(repoRoot),
) {
  const assets = STABLE_RELEASE_ASSET_SPECS.map((spec) => {
    const relativePath = spec.relativePath(version)
    return {
      id: spec.id,
      kind: spec.kind,
      relativePath,
      absolutePath: path.join(repoRoot, relativePath),
    }
  })

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
  return buildStableReleaseAssetManifest(repoRoot, version).assets.map((asset) => asset.absolutePath)
}

export function resolveExistingStableReleaseAssetPaths(
  repoRoot = resolveRepoRoot(),
  version = readStableReleaseVersion(repoRoot),
) {
  return resolveStableReleaseAssetPaths(repoRoot, version).filter((assetPath) => existsSync(assetPath))
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

async function sha256File(filePath) {
  const fileBuffer = await fs.readFile(filePath)
  return createHash('sha256').update(fileBuffer).digest('hex')
}

export async function writeStableReleaseChecksums(
  repoRoot = resolveRepoRoot(),
  version = readStableReleaseVersion(repoRoot),
) {
  const checksumPath = resolveStableReleaseChecksumPath(repoRoot, version)
  const manifest = buildStableReleaseAssetManifest(repoRoot, version)
  const missingAssets = manifest.assets.filter((asset) => !existsSync(asset.absolutePath))

  if (missingAssets.length > 0) {
    throw new Error(
      `Stable release assets missing: ${missingAssets.map((asset) => asset.relativePath).join(', ')}`,
    )
  }

  const lines = []
  for (const asset of manifest.assets) {
    const digest = await sha256File(asset.absolutePath)
    lines.push(`${digest}  ${asset.relativePath}`)
  }

  await fs.mkdir(path.dirname(checksumPath), { recursive: true })
  await fs.writeFile(checksumPath, `${lines.join('\n')}\n`, 'utf8')

  return checksumPath
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

  if (command === 'github-output') {
    process.stdout.write(`${formatGitHubOutput(repoRoot, version)}\n`)
    return
  }

  throw new Error(`Unknown release assets command "${command}".`)
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main()
}
