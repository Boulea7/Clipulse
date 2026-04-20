import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

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
  return 'npm pack --pack-destination dist/npm-packages --workspace @clipulse/collector-core --workspace @clipulse/adapter-claude --workspace @clipulse/adapter-codex'
}

export function createStableBundlePlan(repoRoot, distDir) {
  const bundleRoot = path.join(distDir, 'stable-bundles')

  return buildStableBundleDefinitions().map((bundle) => ({
    ...bundle,
    stageDir: path.join(bundleRoot, bundle.id),
    archivePath: path.join(bundleRoot, `clipulse-${bundle.id}.tar.gz`),
    copies: bundle.copies.map((entry) => ({
      source: path.join(repoRoot, entry.source),
      target: entry.target,
    })),
  }))
}

function getStableBundleArchivePaths(distDir) {
  return buildStableBundleDefinitions().map((bundle) => ({
    ...bundle,
    archivePath: path.join(distDir, 'stable-bundles', `clipulse-${bundle.id}.tar.gz`),
  }))
}

async function getStableNpmPackagePaths(distDir) {
  const repoRoot = path.resolve(distDir, '..')
  const collectorCorePackageJson = JSON.parse(
    await fs.readFile(path.join(repoRoot, 'packages', 'collector-core', 'package.json'), 'utf8'),
  )
  const packageVersion = collectorCorePackageJson.version
  return {
    collectorCorePackage: path.join(distDir, 'npm-packages', `clipulse-collector-core-${packageVersion}.tgz`),
    claudePackage: path.join(distDir, 'npm-packages', `clipulse-adapter-claude-${packageVersion}.tgz`),
    codexPackage: path.join(distDir, 'npm-packages', `clipulse-adapter-codex-${packageVersion}.tgz`),
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
  execFileSync(
    'tar',
    ['-czf', bundle.archivePath, '-C', bundleRoot, bundle.id],
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
    '--workspace',
    '@clipulse/collector-core',
    '--workspace',
    '@clipulse/adapter-claude',
    '--workspace',
    '@clipulse/adapter-codex',
  ], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      npm_config_cache: cacheDir,
    },
  })
}

async function runCliSmoke(cliPath, exportName, input, stateDir) {
  const module = await import(pathToFileURL(cliPath).href)
  const runCli = module[exportName]
  if (typeof runCli !== 'function') {
    throw new Error(`Missing ${exportName} export in ${cliPath}`)
  }
  let stdout = ''

  await runCli({
    env: {
      ...process.env,
      CLIPULSE_STATE_DIR: stateDir,
    },
    readStdin: async () => JSON.stringify(input),
    stdout: {
      write: (chunk) => {
        stdout += chunk
      },
    },
  })

  stdout = stdout.trim()
  const payload = JSON.parse(stdout)
  if (!Array.isArray(payload.events) || payload.events.length !== 1) {
    throw new Error(`Expected one event from ${cliPath}`)
  }
}

async function runBundleSmoke(distDir) {
  const bundleRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipulse-stable-bundle-'))
  const stateDir = path.join(bundleRoot, 'state')

  try {
    for (const bundle of getStableBundleArchivePaths(distDir)) {
      execFileSync('tar', ['-xzf', bundle.archivePath, '-C', bundleRoot], {
        stdio: 'inherit',
      })
    }

    await runCliSmoke(
      path.join(bundleRoot, 'adapter-claude', 'dist', 'cli.js'),
      'runClaudeCli',
      {
        session_id: 'claude-bundle-smoke',
        cwd: '/tmp/clipulse-bundle-claude',
        hook_event_name: 'UserPromptSubmit',
        event_time: '2026-04-20T14:00:00Z',
        model: 'claude-sonnet-4',
      },
      stateDir,
    )
    await runCliSmoke(
      path.join(bundleRoot, 'adapter-codex', 'dist', 'cli.js'),
      'runCodexCli',
      {
        session_id: 'codex-bundle-smoke',
        cwd: '/tmp/clipulse-bundle-codex',
        hook_event_name: 'SessionStart',
        event_time: '2026-04-20T14:00:00Z',
        model: 'gpt-5.4',
      },
      stateDir,
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

    await runCliSmoke(
      path.join(installRoot, 'node_modules', '@clipulse', 'adapter-claude', 'dist', 'cli.js'),
      'runClaudeCli',
      {
        session_id: 'claude-install-smoke',
        cwd: '/tmp/clipulse-install-claude',
        hook_event_name: 'UserPromptSubmit',
        event_time: '2026-04-20T14:00:00Z',
        model: 'claude-sonnet-4',
      },
      stateDir,
    )
    await runCliSmoke(
      path.join(installRoot, 'node_modules', '@clipulse', 'adapter-codex', 'dist', 'cli.js'),
      'runCodexCli',
      {
        session_id: 'codex-install-smoke',
        cwd: '/tmp/clipulse-install-codex',
        hook_event_name: 'SessionStart',
        event_time: '2026-04-20T14:00:00Z',
        model: 'gpt-5.4',
      },
      stateDir,
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
