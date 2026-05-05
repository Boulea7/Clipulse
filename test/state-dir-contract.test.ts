import { spawnSync } from 'node:child_process'

import { afterEach, describe, expect, it } from 'vitest'

import { resolveStateDir } from '../packages/collector-core/src/index.js'

const ORIGINAL_ENV = {
  CLIPULSE_STATE_DIR: process.env.CLIPULSE_STATE_DIR,
  XDG_STATE_HOME: process.env.XDG_STATE_HOME,
  HOME: process.env.HOME,
}

afterEach(() => {
  restoreEnv('CLIPULSE_STATE_DIR', ORIGINAL_ENV.CLIPULSE_STATE_DIR)
  restoreEnv('XDG_STATE_HOME', ORIGINAL_ENV.XDG_STATE_HOME)
  restoreEnv('HOME', ORIGINAL_ENV.HOME)
})

describe('state dir contract', () => {
  it('keeps Node and Python state-dir resolution aligned', () => {
    const cases = [
      {
        label: 'explicit env',
        env: {
          CLIPULSE_STATE_DIR: '/tmp/clipulse-explicit',
          XDG_STATE_HOME: '/tmp/xdg-state',
          HOME: '/tmp/home-state',
        },
        expected: '/tmp/clipulse-explicit',
      },
      {
        label: 'xdg fallback',
        env: {
          XDG_STATE_HOME: '/tmp/xdg-state',
          HOME: '/tmp/home-state',
        },
        expected: '/tmp/xdg-state/clipulse',
      },
      {
        label: 'home fallback',
        env: {
          HOME: '/tmp/home-state',
        },
        expected: '/tmp/home-state/.local/state/clipulse',
      },
    ]

    for (const testCase of cases) {
      applyCaseEnv(testCase.env)

      expect(resolveStateDir(), testCase.label).toBe(testCase.expected)
      expect(resolvePythonStateDir(testCase.env), testCase.label).toBe(testCase.expected)
    }
  })
})

function resolvePythonStateDir(env: Record<string, string>) {
  const python = process.env.PYTHON ?? 'python3'
  const result = spawnSync(
    python,
    [
      '-c',
      [
        'import importlib.util',
        'import pathlib',
        "module_path = pathlib.Path('apps/api/clipulse_api/runtime_status.py')",
        "spec = importlib.util.spec_from_file_location('clipulse_runtime_status', module_path)",
        'module = importlib.util.module_from_spec(spec)',
        'assert spec.loader is not None',
        'spec.loader.exec_module(module)',
        'resolve_state_dir = module.resolve_state_dir',
        'print(resolve_state_dir())',
      ].join('\n'),
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        ...env,
      },
    },
  )

  if (result.status !== 0) {
    throw new Error(result.stderr || 'python resolve_state_dir contract probe failed')
  }

  return result.stdout.trim()
}

function applyCaseEnv(env: Record<string, string>) {
  restoreEnv('CLIPULSE_STATE_DIR', env.CLIPULSE_STATE_DIR)
  restoreEnv('XDG_STATE_HOME', env.XDG_STATE_HOME)
  restoreEnv('HOME', env.HOME)
}

function restoreEnv(name: 'CLIPULSE_STATE_DIR' | 'XDG_STATE_HOME' | 'HOME', value: string | undefined) {
  if (value === undefined) {
    delete process.env[name]
    return
  }

  process.env[name] = value
}
