import { spawn } from 'node:child_process'

const stateDir = process.env.CLIPULSE_STATE_DIR ?? `${process.env.TMPDIR ?? '/tmp'}/clipulse-opencode-smoke`

const payloads = [
  {
    session_id: 'opencode-smoke-session',
    cwd: '/workspace/demo',
    event_name: 'session.created',
    event_time: '2026-04-10T03:10:00Z',
    model: 'gpt-5.4',
  },
  {
    session_id: 'opencode-smoke-session',
    cwd: '/workspace/demo',
    event_name: 'file.edited',
    event_time: '2026-04-10T03:10:02Z',
    model: 'gpt-5.4',
    file_edits: [
      {
        path: '/workspace/demo/src/smoke.ts',
        additions: 2,
        deletions: 1,
      },
    ],
  },
]

for (const payload of payloads) {
  await new Promise((resolve, reject) => {
    const child = spawn(
      'node',
      ['packages/adapter-opencode/dist/plugin.js'],
      {
        stdio: ['pipe', 'pipe', 'inherit'],
        env: {
          ...process.env,
          CLIPULSE_STATE_DIR: stateDir,
        },
      },
    )

    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk)
    })

    child.stdin.end(JSON.stringify(payload))
    child.on('exit', (code) => {
      if (code === 0) {
        resolve(undefined)
        return
      }
      reject(new Error(`OpenCode smoke payload failed with exit code ${code ?? 'unknown'}.`))
    })
    child.on('error', reject)
  })
}
