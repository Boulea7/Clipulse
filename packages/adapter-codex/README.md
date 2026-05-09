# Clipulse Codex Adapter

Minimal `Codex` hooks-first adapter for Clipulse self-hosted deployments.

## Status

- Support tier: stable
- Host: `Codex`
- Canonical checked-in wiring: `packages/adapter-codex/examples/hooks.json`
- Delivery modes: direct API delivery with `CLIPULSE_API_URL`, or stdout handoff when `CLIPULSE_API_URL` is unset

## Required environment

- `CLIPULSE_API_URL` for direct delivery
- `CLIPULSE_API_BEARER_TOKEN` when the target API is protected
- `CLIPULSE_STATE_DIR` if you want a stable local state/snapshot location instead of the default
- `CLIPULSE_REQUIRE_PROJECT_FILE=1` only when you want to suppress events from directories that do not contain `.clipulse-project`

## Canonical example

- `examples/hooks.json` is the canonical wiring source for the stable Codex hook surface: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Stop`, `StopFailure`, `SessionEnd`.

## Install

- Run `npm run build --workspace @clipulse/adapter-codex` from the repo root before wiring the adapter.
- For release assets outside this repo, either:
  - extract `clipulse-adapter-codex-<version>.tar.gz` and point Codex hooks at the extracted `dist/cli.js`
  - or install `clipulse-collector-core-<version>.tgz` plus `clipulse-adapter-codex-<version>.tgz` together in your local integration project
- After `npm install`, wire `clipulse-adapter-codex` as the hook command. If you must wire the generated bin path directly, use the platform-specific npm shim (`node_modules/.bin/clipulse-adapter-codex` on POSIX shells, `node_modules/.bin/clipulse-adapter-codex.cmd` on Windows).

Minimal local wiring environment:

```bash
export CLIPULSE_API_URL="http://127.0.0.1:8000"
export CLIPULSE_API_BEARER_TOKEN="replace-with-your-api-token"
export CLIPULSE_STATE_DIR="$HOME/.local/state/clipulse"
```

Optional explicit project override:

```text
# .clipulse-project
project_name=my-project-name
git_branch=feature/branch-name
# optional: scope=workspace
```

## Wire

- `examples/hooks.json` is the canonical wiring source for the stable Codex hook surface: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Stop`, `StopFailure`, `SessionEnd`.
- Replace `node packages/adapter-codex/dist/cli.js` with your local built adapter path when wiring outside this repo.
- Keep `UserPromptSubmit` wired if you want prompt-only turns to be recorded instead of disappearing behind zero-delta activity.

Minimal repo-external wiring shape:

```bash
export CLIPULSE_API_URL="http://127.0.0.1:8000"
export CLIPULSE_API_BEARER_TOKEN="replace-with-your-api-token"
export CLIPULSE_STATE_DIR="$HOME/.local/state/clipulse"
node /absolute/path/to/adapter-codex/dist/cli.js
```

## Smoke check

- Run `npm run smoke:codex` from the repo root (`scripts/smoke-codex.mjs`).
- The smoke flow exercises the built `packages/adapter-codex/dist/cli.js` entrypoint and checks stateful lifecycle cleanup.

## Notes

Cleanup boundaries:
- `PostToolUseFailure` can still finalize a pending tool wait.
- `StopFailure` and `SessionEnd` still matter for cleanup and local state teardown.
- `SessionEnd` is an extra best-effort teardown boundary, not the only cleanup barrier, and it is safe to wire alongside `Stop` / `StopFailure`.
- If your Codex host exposes those failure-path hooks, keep them wired.

Zero-delta notes:
- Prompt-only activity can legitimately produce zero deltas.
- Clearly read-only tool events and read-only Bash commands refresh the local snapshot baseline without attributing repo-wide deltas.
- Read-only commands can legitimately produce zero deltas.
- The first snapshot baseline capture can also legitimately produce zero deltas before later changes appear.

CLI input contract:
- stdin must be a single JSON object with non-empty `session_id`, `cwd`, and `hook_event_name`.
- Invalid JSON or missing required fields fail fast with a non-zero exit instead of falling through to unstable runtime errors.

Current scope:
- shared project-root / branch enrichment
- shared session timing
- snapshot-based local file-delta fallback
- relative Bash write-target narrowing resolves from the original tool `cwd` before Clipulse scopes the result to the resolved project root
- project context keeps snapshot/file filtering scoped to the active worktree, while the event-level project root resolves to the canonical shared git root when the worktree belongs to a common Git directory

- `scripts/smoke-codex.mjs` replays the checked-in `examples/smoke/session-start.json`, `examples/smoke/pre-tool-use.json`, `examples/smoke/post-tool-use-failure.json`, `examples/smoke/stop-failure.json`, and `examples/smoke/session-end.json` fixtures through the built `packages/adapter-codex/dist/cli.js`, drives a stateful `SessionStart -> PreToolUse -> file change -> PostToolUseFailure -> StopFailure -> SessionEnd` flow, prints each normalized batch to stdout, and finishes with local teardown state cleared.
