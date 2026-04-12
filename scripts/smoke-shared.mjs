import { spawn } from 'node:child_process'

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

export async function runSmokeCommand({
  command,
  args,
  cwd = process.cwd(),
  env = {},
  input,
  stdio = ['pipe', 'inherit', 'inherit'],
}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        ...env,
      },
      stdio,
    })

    child.on('exit', (code) => {
      if (code === 0) {
        resolve(undefined)
        return
      }

      reject(new Error(`Smoke command failed with exit code ${code ?? 'unknown'}: ${command} ${args.join(' ')}`))
    })
    child.on('error', reject)

    if (Array.isArray(child.stdio) && child.stdio[0]) {
      child.stdio[0].end(input)
    }
  })
}

export async function runNpmScript(name) {
  await runSmokeCommand({
    command: npmCommand,
    args: ['run', name],
    stdio: 'inherit',
  })
}
