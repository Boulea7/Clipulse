# Clipulse Gemini Adapter

Minimal `Gemini CLI` hooks-first adapter for Clipulse self-hosted deployments.
Tryable experimental adapter; not yet a first-class stable integration on the same level as `Claude Code` or `Codex`.

## Status

- Support tier: experimental
- Host: `Gemini CLI`
- Canonical checked-in wiring: `packages/adapter-gemini/examples/.gemini/settings.json`
- Delivery modes: direct API delivery with `CLIPULSE_API_URL`, or stdout handoff when `CLIPULSE_API_URL` is unset

## Supported official surface

- `SessionStart`
- `BeforeTool`
- `AfterTool`
- `BeforeAgent`
- `AfterAgent`
- `SessionEnd`

## Required environment

- `CLIPULSE_API_URL` for direct delivery
- `CLIPULSE_API_BEARER_TOKEN` when the target API is protected
- `CLIPULSE_STATE_DIR` if you want a stable local state/spool location instead of the default
- `CLIPULSE_REQUIRE_PROJECT_FILE=1` only when you want to suppress events from directories that do not contain `.clipulse-project`
- `CLIPULSE_GEMINI_DEBUG_HOOKS=1` only when you want local diagnostics for ignored non-allowlisted hooks

## Install

- Run `npm run build --workspace @clipulse/adapter-gemini` from the repo root before wiring the checked-in example to `dist/cli.js`.

## Wire

Official wiring:
- `examples/.gemini/settings.json` is the canonical checked-in wiring example and source for the official Gemini CLI hook surface
- `examples/.gemini/settings.json` is a synthetic lifecycle fixture for repo docs and smoke coverage, not real user workspace settings
- top-level operator docs should point to this README together with `examples/.gemini/settings.json` instead of restating the full Gemini hook contract elsewhere
- prefer that checked-in example when wiring docs or local setup notes drift, instead of widening the documented hook surface here
- replace `/absolute/path/to/packages/adapter-gemini/dist/cli.js` with your local built adapter path before using it
- wire the official `BeforeAgent` / `AfterAgent` pair for the primary prompt-turn path; `BeforeAgent` and compatibility-only `UserPromptSubmit` should not both be wired for the same installation

## Smoke check

- Run `npm run smoke:gemini` from the repo root.
- The smoke matrix exercises the built `dist/cli.js` entrypoint, invalid-stdin handling, and the checked-in synthetic lifecycle fixtures.
- `scripts/smoke-gemini.mjs` replays a checked-in lifecycle sequence to stdout through the built `dist/cli.js`.

## Notes

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

- `scripts/smoke-gemini.mjs` replays a checked-in lifecycle matrix through the built CLI and prints one normalized batch line per step.
- The matrix includes the legacy `UserPromptSubmit` prompt-only compatibility path and a `replace`-backed completion path.
- The checked-in smoke fixtures live under `examples/` so package tests, repo smoke, and operator docs stay aligned on the same lifecycle contract.
