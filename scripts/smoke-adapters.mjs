import { runNpmScript } from './smoke-shared.mjs'

await runNpmScript('smoke:gemini')
await runNpmScript('smoke:opencode')
