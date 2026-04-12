# Clipulse Codex Adapter

Minimal `Codex` hooks-first adapter for Clipulse alpha+.

Canonical wiring:
- `examples/hooks.json` is the canonical wiring source for the stable Codex hook surface: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Stop`, `StopFailure`, `SessionEnd`.
- Replace `node packages/adapter-codex/dist/cli.js` with your local built adapter path when wiring outside this repo.
- Keep `UserPromptSubmit` wired if you want prompt-only turns to be recorded instead of disappearing behind zero-delta activity.

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
- project context resolution scoped to the resolved worktree root rather than a shared common Git directory

## Smoke check

- Run `npm run build --workspace @clipulse/adapter-codex` before `node scripts/smoke-codex.mjs`; this smoke driver intentionally exercises the built `packages/adapter-codex/dist/cli.js`.
- `scripts/smoke-codex.mjs` replays the checked-in `examples/smoke/session-start.json`, `examples/smoke/pre-tool-use.json`, and `examples/smoke/post-tool-use-failure.json` fixtures through the built `packages/adapter-codex/dist/cli.js`, drives a stateful `SessionStart -> PreToolUse -> file change -> PostToolUseFailure` flow, and prints each normalized batch to stdout.
