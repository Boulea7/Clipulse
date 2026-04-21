import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import {
  STABLE_RELEASE_WORKSPACES,
  readStableReleaseVersion,
  resolveStableReleaseAssetEntries,
} from './release-assets.mjs'

export function buildStableBundleDefinitions() {
  return [
    {
      id: 'adapter-claude',
      workspace: '@clipulse/adapter-claude',
      cliEntry: 'packages/adapter-claude/dist/cli.js',
      copies: [
        { source: 'packages/adapter-claude/package.json', target: 'package.json' },
        { source: 'packages/adapter-claude/dist', target: 'dist' },
        { source: 'packages/adapter-claude/README.md', target: 'README.md' },
        { source: 'packages/adapter-claude/hooks/hooks.json', target: 'hooks/hooks.json' },
        { source: 'packages/adapter-claude/.claude-plugin/plugin.json', target: '.claude-plugin/plugin.json' },
        {
          source: 'packages/collector-core/package.json',
          target: 'node_modules/@clipulse/collector-core/package.json',
        },
        {
          source: 'packages/collector-core/dist',
          target: 'node_modules/@clipulse/collector-core/dist',
        },
      ],
    },
    {
      id: 'adapter-codex',
      workspace: '@clipulse/adapter-codex',
      cliEntry: 'packages/adapter-codex/dist/cli.js',
      copies: [
        { source: 'packages/adapter-codex/package.json', target: 'package.json' },
        { source: 'packages/adapter-codex/dist', target: 'dist' },
        { source: 'packages/adapter-codex/README.md', target: 'README.md' },
        { source: 'packages/adapter-codex/examples/hooks.json', target: 'examples/hooks.json' },
        {
          source: 'packages/collector-core/package.json',
          target: 'node_modules/@clipulse/collector-core/package.json',
        },
        {
          source: 'packages/collector-core/dist',
          target: 'node_modules/@clipulse/collector-core/dist',
        },
      ],
    },
  ]
}

export function createStablePackCommand() {
  return `npm pack --pack-destination dist/npm-packages ${STABLE_RELEASE_WORKSPACES.map((workspace) => `--workspace ${workspace}`).join(' ')}`
}

export function createStableBundlePlan(repoRoot, distDir, version = readStableReleaseVersion(repoRoot)) {
  const bundleRoot = path.join(distDir, 'stable-bundles')
  const assetEntries = resolveStableReleaseAssetEntries(repoRoot, version)
  const bundleAssetPathById = new Map(
    assetEntries
      .filter((asset) => asset.kind === 'bundle')
      .map((asset) => [asset.id.replace('bundle-', ''), asset.absolutePath]),
  )

  return buildStableBundleDefinitions().map((bundle) => ({
    ...bundle,
    stageDir: path.join(bundleRoot, `clipulse-${bundle.id}-${version}`),
    archivePath: bundleAssetPathById.get(bundle.id),
    copies: bundle.copies.map((entry) => ({
      source: path.join(repoRoot, entry.source),
      target: entry.target,
    })),
  }))
}

function getStableBundleArchivePaths(distDir) {
  const repoRoot = path.resolve(distDir, '..')
  const assetEntries = resolveStableReleaseAssetEntries(repoRoot)
  const bundleAssets = new Map(
    assetEntries
      .filter((asset) => asset.kind === 'bundle')
      .map((asset) => [asset.id.replace('bundle-', ''), asset.absolutePath]),
  )

  return buildStableBundleDefinitions().map((bundle) => ({
    ...bundle,
    archivePath: bundleAssets.get(bundle.id),
  }))
}

async function getStableNpmPackagePaths(distDir) {
  const repoRoot = path.resolve(distDir, '..')
  const assetEntries = resolveStableReleaseAssetEntries(repoRoot)
  const npmAssets = new Map(
    assetEntries
      .filter((asset) => asset.kind === 'npm-package')
      .map((asset) => [asset.id, asset.absolutePath]),
  )

  return {
    collectorCorePackage: npmAssets.get('npm-collector-core'),
    claudePackage: npmAssets.get('npm-adapter-claude'),
    codexPackage: npmAssets.get('npm-adapter-codex'),
  }
}

async function ensurePathExists(targetPath) {
  await fs.access(targetPath)
}

async function ensureBundleInputs(plan) {
  for (const bundle of plan) {
    for (const entry of bundle.copies) {
      await ensurePathExists(entry.source)
    }
  }
}

async function stageBundle(bundle) {
  await fs.rm(bundle.stageDir, { recursive: true, force: true })
  await fs.mkdir(bundle.stageDir, { recursive: true })

  for (const entry of bundle.copies) {
    const targetPath = path.join(bundle.stageDir, entry.target)
    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    await fs.cp(entry.source, targetPath, { recursive: true })
  }
}

async function createBundleArchive(bundleRoot, bundle) {
  await fs.mkdir(bundleRoot, { recursive: true })
  await fs.rm(bundle.archivePath, { force: true })
  const stageDirName = path.basename(bundle.stageDir)
  execFileSync(
    'tar',
    ['-czf', bundle.archivePath, '-C', bundleRoot, stageDirName],
    { stdio: 'inherit' },
  )
}

async function runBundle(repoRoot) {
  const distDir = path.join(repoRoot, 'dist')
  const bundleRoot = path.join(distDir, 'stable-bundles')
  const plan = createStableBundlePlan(repoRoot, distDir)

  await ensureBundleInputs(plan)
  await fs.mkdir(bundleRoot, { recursive: true })

  for (const bundle of plan) {
    await stageBundle(bundle)
    await createBundleArchive(bundleRoot, bundle)
  }
}

async function runPack(repoRoot) {
  const distDir = path.join(repoRoot, 'dist')
  const cacheDir = path.join(distDir, '.npm-cache')
  const plan = createStableBundlePlan(repoRoot, distDir)
  await ensureBundleInputs(plan)
  await fs.mkdir(path.join(distDir, 'npm-packages'), { recursive: true })
  await fs.mkdir(cacheDir, { recursive: true })
  execFileSync('npm', [
    'pack',
    '--pack-destination',
    'dist/npm-packages',
    ...STABLE_RELEASE_WORKSPACES.flatMap((workspace) => ['--workspace', workspace]),
  ], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      npm_config_cache: cacheDir,
    },
  })
}

async function runCliSmoke(command, args, input, stateDir, cwd = process.cwd()) {
  const stdoutChunks = []
  const stderrChunks = []

  await new Promise((resolve, reject) => {
    const childProcess = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        CLIPULSE_STATE_DIR: stateDir,
      },
      stdio: 'pipe',
    })

    childProcess.stdout.on('data', (chunk) => {
      stdoutChunks.push(chunk)
    })
    childProcess.stderr.on('data', (chunk) => {
      stderrChunks.push(chunk)
    })
    childProcess.on('error', reject)
    childProcess.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `Expected ${command} ${args.join(' ')} to exit 0, got ${code}: ${Buffer.concat(stderrChunks).toString('utf8')}`,
          ),
        )
        return
      }
      resolve(undefined)
    })
    childProcess.stdin.end(JSON.stringify(input))
  })

  const payload = JSON.parse(Buffer.concat(stdoutChunks).toString('utf8').trim())
  if (!Array.isArray(payload.events) || payload.events.length !== 1) {
    throw new Error(`Expected one event from ${command} ${args.join(' ')}`)
  }
}

async function runBundleSmoke(distDir) {
  const bundleRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-stable-bundle-'))
  const stateDir = path.join(bundleRoot, 'state')
  const version = readStableReleaseVersion(path.resolve(distDir, '..'))

  try {
    await fs.mkdir(stateDir, { recursive: true })
    for (const bundle of getStableBundleArchivePaths(distDir)) {
      execFileSync('tar', ['-xzf', bundle.archivePath, '-C', bundleRoot], {
        stdio: 'inherit',
      })
    }
    const claudeBundleDir = path.join(bundleRoot, `clipulse-adapter-claude-${version}`)
    const codexBundleDir = path.join(bundleRoot, `clipulse-adapter-codex-${version}`)

    await ensurePathExists(path.join(claudeBundleDir, '.claude-plugin', 'plugin.json'))
    await ensurePathExists(path.join(claudeBundleDir, 'hooks', 'hooks.json'))

    await runCliSmoke(
      'node',
      ['dist/cli.js'],
      {
        session_id: 'claude-bundle-smoke',
        cwd: '/tmp/clipulse-bundle-claude',
        hook_event_name: 'UserPromptSubmit',
        event_time: '2026-04-20T14:00:00Z',
        model: 'claude-sonnet-4',
      },
      stateDir,
      claudeBundleDir,
    )
    await runCliSmoke(
      'node',
      ['dist/cli.js'],
      {
        session_id: 'codex-bundle-smoke',
        cwd: '/tmp/clipulse-bundle-codex',
        hook_event_name: 'SessionStart',
        event_time: '2026-04-20T14:00:00Z',
        model: 'gpt-5.4',
      },
      stateDir,
      codexBundleDir,
    )
  } finally {
    await fs.rm(bundleRoot, { recursive: true, force: true })
  }
}

async function runNpmInstallSmoke(distDir) {
  const installRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-stable-install-'))
  const cacheDir = path.join(installRoot, '.npm-cache')
  const stateDir = path.join(installRoot, 'state')
  const { collectorCorePackage, claudePackage, codexPackage } = await getStableNpmPackagePaths(distDir)

  try {
    await fs.mkdir(cacheDir, { recursive: true })
    await fs.mkdir(stateDir, { recursive: true })
    await fs.writeFile(
      path.join(installRoot, 'package.json'),
      JSON.stringify({
        name: 'clipulse-stable-install-smoke',
        private: true,
        type: 'module',
      }, null, 2),
      'utf8',
    )

    execFileSync('npm', [
      'install',
      '--no-package-lock',
      collectorCorePackage,
      claudePackage,
      codexPackage,
    ], {
      cwd: installRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        npm_config_cache: cacheDir,
      },
    })
    const claudeBinPath = await fs.realpath(
      path.join(installRoot, 'node_modules', '.bin', 'clipulse-adapter-claude'),
    )
    const collectorCoreBinPath = await fs.realpath(
      path.join(installRoot, 'node_modules', '.bin', 'clipulse-collector-core'),
    )
    const codexBinPath = await fs.realpath(
      path.join(installRoot, 'node_modules', '.bin', 'clipulse-adapter-codex'),
    )

    const collectorCoreDoctor = execFileSync('node', [collectorCoreBinPath, 'doctor'], {
      cwd: installRoot,
      env: {
        ...process.env,
        CLIPULSE_STATE_DIR: stateDir,
      },
      encoding: 'utf8',
    })
    if (!collectorCoreDoctor.includes('Clipulse local operator doctor')) {
      throw new Error('Expected clipulse-collector-core doctor output after npm install smoke')
    }

    await runCliSmoke(
      'node',
      [claudeBinPath],
      {
        session_id: 'claude-install-smoke',
        cwd: '/tmp/clipulse-install-claude',
        hook_event_name: 'UserPromptSubmit',
        event_time: '2026-04-20T14:00:00Z',
        model: 'claude-sonnet-4',
      },
      stateDir,
      installRoot,
    )
    await runCliSmoke(
      'node',
      [codexBinPath],
      {
        session_id: 'codex-install-smoke',
        cwd: '/tmp/clipulse-install-codex',
        hook_event_name: 'SessionStart',
        event_time: '2026-04-20T14:00:00Z',
        model: 'gpt-5.4',
      },
      stateDir,
      installRoot,
    )
  } finally {
    await fs.rm(installRoot, { recursive: true, force: true })
  }
}

async function runCheck(repoRoot) {
  const distDir = path.join(repoRoot, 'dist')

  await runBundle(repoRoot)
  await runPack(repoRoot)
  await runBundleSmoke(distDir)
  await runNpmInstallSmoke(distDir)
}

async function main(argv = process.argv.slice(2)) {
  const [command = 'check'] = argv
  const repoRoot = path.resolve(new URL('..', import.meta.url).pathname)

  if (command === 'bundle') {
    await runBundle(repoRoot)
    return
  }

  if (command === 'check') {
    await runCheck(repoRoot)
    return
  }

  throw new Error(`Unknown stable packaging command "${command}".`)
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main()
}
