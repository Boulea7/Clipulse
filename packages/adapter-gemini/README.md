# Clipulse Gemini Adapter

Minimal `Gemini CLI` hooks-first adapter for Clipulse alpha+.
Tryable experimental adapter; not yet a first-class stable integration on the same level as `Claude Code` or `Codex`.

Current scope:
- normalize hook payloads into Clipulse events
- reuse shared project context and timing helpers
- cover official `SessionStart` / `SessionEnd`, `BeforeTool` / `AfterTool`, `BeforeAgent`, and `AfterAgent`
- treat `AfterAgent` as a distinct turn-complete signal instead of collapsing it into prompt submission
- emit minimal file deltas when official `write_file` / `replace` payloads include an explicit file path
- resolve relative Gemini file paths from the original hook `cwd` before scoping them to the resolved project root, including worktree-style project roots
- deliver batches directly or print them to stdout for local wiring
- keep `SessionEnd` as a best-effort stop/cleanup fallback that may finalize pending wait timing and clear local session state, not a guaranteed completion barrier
- reject malformed CLI stdin early unless it is a JSON object with non-empty `session_id`, `cwd`, and `hook_event_name`
- the direct CLI entrypoint keeps that validation strict at process level too: malformed JSON or missing required fields emit one stderr diagnostic line and exit non-zero instead of being silently ignored

Official wiring:
- `examples/.gemini/settings.json` is the canonical checked-in wiring example and source for the official Gemini CLI hook surface
- top-level operator docs should point to this README together with `examples/.gemini/settings.json` instead of restating the full Gemini hook contract elsewhere
- build the local CLI first with `npm run build --workspace @clipulse/adapter-gemini` before wiring that checked-in example to `dist/cli.js`
- prefer that checked-in example when wiring docs or local setup notes drift, instead of widening the documented hook surface here
- replace `/absolute/path/to/packages/adapter-gemini/dist/cli.js` with your local built adapter path before using it
- wire the official `BeforeAgent` / `AfterAgent` pair for the primary prompt-turn path; `BeforeAgent` and compatibility-only `UserPromptSubmit` should not both be wired for the same installation

Compatibility notes:
- the documented primary surface is still the official Gemini hooks contract
- the accepted hook-name allowlist is explicit: official `SessionStart`, `SessionEnd`, `BeforeTool`, `AfterTool`, `BeforeAgent`, `AfterAgent`, plus compatibility-only `AfterToolFailure` and `UserPromptSubmit`
- compatibility-only aliases stay limited to normalization / cleanup compatibility and do not widen the official wiring contract
- compatibility-only aliases do not imply file-delta equivalence with the official hook surface
- compatibility-only `UserPromptSubmit` exists for older environments that lack `BeforeAgent`; prefer `BeforeAgent` whenever the official hook is available
- if your environment emits `AfterToolFailure`, keep it wired because it can close failed-tool wait gaps earlier than `SessionEnd`
- undocumented hooks such as `AfterModel` / `BeforeModel` are ignored and do not produce sendable Clipulse events
- ignored hooks stay silent by default; set `CLIPULSE_GEMINI_DEBUG_HOOKS` if you want a local stderr diagnostic for unexpected hook names
- accepted values are `1` and `true`, after trim/lowercase normalization
- debug output stays limited to ignored non-allowlisted hook names; allowlisted official and compatibility hooks stay quiet
- minimal `file_deltas` stay limited to official `AfterTool` events whose `write_file` / `replace` payloads include an explicit `file_path`
- stdout mode only treats a non-throwing single-line `stdout.write(...)` as a successful handoff before it commits local timing state
- stdout mode is retry-safer than pre-commit printing, but it is still not an exactly-once transport if the consumer accepts a line and the process dies before the local state commit finishes
- if you wire stdout into another local collector, treat those lines as at-least-once experimental handoff data instead of a durable queue protocol

Current non-goals:
- `AfterModel` chunk-level event handling
- transcript parsing
- shell command parsing
- server-side Gemini integrations
- broad or transcript-derived file delta capture

## Smoke check

- build the package first with `npm run build --workspace @clipulse/adapter-gemini`; the smoke script runs the local `dist/cli.js` entrypoint, not the TypeScript source tree
- run `npm run smoke:gemini` from the repo root to execute `scripts/smoke-gemini.mjs`
- `scripts/smoke-gemini.mjs` now replays a small checked-in lifecycle sequence matrix and prints one normalized batch line per step to stdout
- the default smoke matrix covers an official prompt-only baseline, a legacy `UserPromptSubmit` prompt-only compatibility path, a read-only `SessionEnd` fallback, a failed-tool cleanup path, and a mixed multi-turn path with zero-delta, `write_file`, and `replace`-backed completion
- process-level invalid-stdin coverage is also pinned in the experimental self-hosted smoke suite so the built CLI keeps the same non-zero exit contract outside the in-process unit tests
- the checked-in smoke fixtures live under `examples/` so package tests, repo smoke, and operator docs stay aligned on the same minimal lifecycle contract
