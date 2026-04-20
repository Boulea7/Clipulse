import { mkdtempSync, readFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  buildStableBundleDefinitions,
  createStableBundlePlan,
  createStablePackCommand,
} from '../scripts/stable-packaging.mjs'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async (dir) => {
    await fs.rm(dir, { recursive: true, force: true })
  }))
})

describe('stable packaging helpers', () => {
  it('builds stable bundle definitions for Claude and Codex only', () => {
    expect(buildStableBundleDefinitions()).toEqual([
      expect.objectContaining({
        id: 'adapter-claude',
        workspace: '@clipulse/adapter-claude',
        cliEntry: 'packages/adapter-claude/dist/cli.js',
      }),
      expect.objectContaining({
        id: 'adapter-codex',
        workspace: '@clipulse/adapter-codex',
        cliEntry: 'packages/adapter-codex/dist/cli.js',
      }),
    ])
  })

  it('creates a stable pack command that targets the release-ready stable workspaces', () => {
    expect(createStablePackCommand()).toBe(
      'npm pack --pack-destination dist/npm-packages --workspace @clipulse/collector-core --workspace @clipulse/adapter-claude --workspace @clipulse/adapter-codex',
    )
  })

  it('creates bundle plans with expected staged files and archive names', () => {
    const repoRoot = '/repo'
    const distDir = '/repo/dist'
    const plan = createStableBundlePlan(repoRoot, distDir)

    expect(plan).toEqual([
      expect.objectContaining({
        id: 'adapter-claude',
        archivePath: '/repo/dist/stable-bundles/clipulse-adapter-claude.tar.gz',
        stageDir: '/repo/dist/stable-bundles/adapter-claude',
      }),
      expect.objectContaining({
        id: 'adapter-codex',
        archivePath: '/repo/dist/stable-bundles/clipulse-adapter-codex.tar.gz',
        stageDir: '/repo/dist/stable-bundles/adapter-codex',
      }),
    ])
    expect(plan[0]?.copies).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: '/repo/packages/adapter-claude/dist',
        target: 'dist',
      }),
      expect.objectContaining({
        source: '/repo/packages/adapter-claude/package.json',
        target: 'package.json',
      }),
      expect.objectContaining({
        source: '/repo/packages/adapter-claude/README.md',
        target: 'README.md',
      }),
      expect.objectContaining({
        source: '/repo/packages/collector-core/package.json',
        target: 'node_modules/@clipulse/collector-core/package.json',
      }),
      expect.objectContaining({
        source: '/repo/packages/collector-core/dist',
        target: 'node_modules/@clipulse/collector-core/dist',
      }),
    ]))
  })

  it('keeps stable workspace packages ready for dist-only release tarballs', () => {
    const collectorPackageJson = JSON.parse(
      readFileSync(new URL('../packages/collector-core/package.json', import.meta.url), 'utf8'),
    ) as {
      bin?: Record<string, string>
      files?: string[]
    }
    const claudePackageJson = JSON.parse(
      readFileSync(new URL('../packages/adapter-claude/package.json', import.meta.url), 'utf8'),
    ) as {
      bin?: Record<string, string>
      files?: string[]
    }
    const codexPackageJson = JSON.parse(
      readFileSync(new URL('../packages/adapter-codex/package.json', import.meta.url), 'utf8'),
    ) as {
      bin?: Record<string, string>
      files?: string[]
    }

    expect(collectorPackageJson.files).toEqual(['dist'])
    expect(collectorPackageJson.bin).toEqual({
      'clipulse-collector-core': './dist/cli.js',
    })
    expect(claudePackageJson.files).toEqual([
      'dist',
      'README.md',
      'hooks',
      '.claude-plugin',
    ])
    expect(claudePackageJson.bin).toEqual({
      'clipulse-adapter-claude': './dist/cli.js',
    })
    expect(codexPackageJson.files).toEqual([
      'dist',
      'README.md',
      'examples',
    ])
    expect(codexPackageJson.bin).toEqual({
      'clipulse-adapter-codex': './dist/cli.js',
    })
  })

  it('keeps package scripts aligned with stable bootstrap and packaging helpers', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { scripts: Record<string, string> }

    expect(packageJson.scripts['bootstrap:self-hosted:stable']).toBe(
      'npm install && npm run build:release:stable && uv sync --group dev',
    )
    expect(packageJson.scripts['bundle:stable']).toBe('node scripts/stable-packaging.mjs bundle')
    expect(packageJson.scripts['check:package:stable']).toBe(
      'node scripts/stable-packaging.mjs check',
    )
  })

  it('validates stable bundle plans against an isolated fixture tree', async () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), 'clipulse-stable-packaging-'))
    tempDirs.push(repoRoot)

    for (const relativePath of [
      'packages/adapter-claude/dist/cli.js',
      'packages/adapter-claude/package.json',
      'packages/adapter-claude/README.md',
      'packages/adapter-claude/hooks/hooks.json',
      'packages/adapter-claude/.claude-plugin/plugin.json',
      'packages/adapter-codex/dist/cli.js',
      'packages/adapter-codex/package.json',
      'packages/adapter-codex/README.md',
      'packages/adapter-codex/examples/hooks.json',
      'packages/collector-core/package.json',
      'packages/collector-core/dist/cli.js',
      'packages/collector-core/dist/index.js',
    ]) {
      const filePath = path.join(repoRoot, relativePath)
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, '// fixture\n', 'utf8')
    }

    const distDir = path.join(repoRoot, 'dist')
    const plan = createStableBundlePlan(repoRoot, distDir)

    for (const bundle of plan) {
      for (const entry of bundle.copies) {
        await expect(fs.access(entry.source)).resolves.toBeUndefined()
      }
    }
  })
})
