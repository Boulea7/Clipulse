import { readFileSync } from 'node:fs'

const manifestFiles = [
  'pyproject.toml',
  'packages/collector-core/package.json',
  'packages/adapter-claude/package.json',
  'packages/adapter-codex/package.json',
  'packages/adapter-gemini/package.json',
  'packages/adapter-opencode/package.json',
]

function readJsonVersion(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8')).version
}

function readTomlVersion(filePath) {
  const match = readFileSync(filePath, 'utf8').match(/^version = "([^"]+)"$/m)
  if (!match) {
    throw new Error(`Missing version in ${filePath}`)
  }
  return match[1]
}

function readAppVersion(filePath) {
  const match = readFileSync(filePath, 'utf8').match(/^APP_VERSION = "([^"]+)"$/m)
  if (!match) {
    throw new Error(`Missing APP_VERSION in ${filePath}`)
  }
  return match[1]
}

function readVersion(filePath) {
  if (filePath.endsWith('.json')) {
    return readJsonVersion(filePath)
  }
  return readTomlVersion(filePath)
}

function main() {
  const versions = manifestFiles.map((filePath) => readVersion(filePath))
  const expectedVersion = versions[0]
  const mismatches = manifestFiles.filter((filePath, index) => versions[index] !== expectedVersion)
  const appVersion = readAppVersion('apps/api/clipulse_api/app.py')
  const changelog = readFileSync('CHANGELOG.md', 'utf8')
  const requestedReleaseVersion = (process.env.RELEASE_VERSION ?? '').trim()

  if (mismatches.length > 0) {
    throw new Error(
      `Version mismatch: ${manifestFiles.map((filePath, index) => `${filePath}=${versions[index]}`).join(', ')}`,
    )
  }

  if (appVersion !== expectedVersion) {
    throw new Error(`APP_VERSION mismatch: apps/api/clipulse_api/app.py=${appVersion}, expected=${expectedVersion}`)
  }

  if (!changelog.includes('## [Unreleased]')) {
    throw new Error('CHANGELOG.md missing ## [Unreleased]')
  }

  if (requestedReleaseVersion) {
    if (requestedReleaseVersion !== expectedVersion) {
      throw new Error(`Release version ${requestedReleaseVersion} does not match checked-in version ${expectedVersion}`)
    }
    if (!changelog.includes(`## [${requestedReleaseVersion}]`)) {
      throw new Error(`CHANGELOG.md missing ## [${requestedReleaseVersion}]`)
    }
  }

  console.log(`release metadata OK: ${expectedVersion}`)
}

main()
