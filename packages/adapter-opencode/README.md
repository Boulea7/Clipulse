# Clipulse OpenCode Adapter

Minimal `OpenCode` plugin/event-first adapter for Clipulse alpha+.
Tryable experimental adapter; not yet a first-class stable integration on the same level as `Claude Code` or `Codex`.

## Status

- Support tier: experimental
- Host: `OpenCode`
- Canonical checked-in wiring: `packages/adapter-opencode/examples/clipulse.ts`
- Delivery modes: direct API delivery with `CLIPULSE_API_URL`, or stdout handoff when `CLIPULSE_API_URL` is unset

## Supported handled subset

- `session.created`
- `session.deleted`
- `session.idle`
- `session.error`
- `tool.execute.before`
- `tool.execute.after`
- `tool.execute.error`
- `file.edited`

## Required environment

- `CLIPULSE_API_URL` for direct delivery
- `CLIPULSE_API_BEARER_TOKEN` when the target API is protected
- `CLIPULSE_STATE_DIR` if you want a stable local state/spool location instead of the default
- `CLIPULSE_REQUIRE_PROJECT_FILE=1` only when you want to suppress events from directories that do not contain `.clipulse-project`
- `CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF=1` only when you intentionally opt into the wrapper-only `session.diff` path

## Install

- Run `npm run build --workspace @clipulse/adapter-opencode` from the repo root before wiring the example wrapper to `dist/plugin.js`.

## Wire

Official wiring:
- `examples/clipulse.ts` is the canonical checked-in wrapper example and source for the current OpenCode handled subset.
- Top-level operator docs should point to this README together with `examples/clipulse.ts` instead of maintaining a second prose-defined wrapper contract.
- If you vendor the example into your own OpenCode plugin path, update its `runOpenCodePlugin` import to point at your local built `dist/plugin.js`.
- The checked-in wrapper now forwards stdout to `process.stdout` by default, so local stdout-mode handoff works without adding a custom wrapper patch when `CLIPULSE_API_URL` is unset.
- `src/plugin.ts` only accepts a minimal JSON stdin envelope with `session_id`, `cwd`, and `event_name`, plus optional `event_time`, `model`, and `file_edits`; invalid or partial payloads are rejected instead of being guessed or backfilled.
- the direct CLI entrypoint reports invalid input or handoff failures as a single-line stderr error and exits non-zero, rather than silently dropping the event
- stdout and API handoff are retry-safe for local timing state: the bridge plans timing first and only commits session state after the stdout write or `deliverBatch()` call succeeds
- this is still not an end-to-end exactly-once contract: if the process dies after a successful stdout/API handoff but before the local post-handoff timing commit completes, a caller retry can still duplicate timing
- `runClipulseSmokeScenario()` is a smoke-oriented helper for the checked-in wrapper path, now covering both the default `file.edited` path and a gated `session.diff` teardown path; it is still not a broader runtime contract for OpenCode integrations.
- the smoke helper also accepts topology-aware inputs so package tests and focused smoke can exercise shared-project and split-project wrapper paths without changing the default repo smoke contract
- `scripts/smoke-opencode.mjs` preflights both the local `dist/plugin.js` bridge build and Node support for `--experimental-strip-types` before it tries that checked-in TypeScript wrapper example.
- `scripts/smoke-opencode.mjs` resolves its repo-local bridge/example paths from `import.meta.url`, so the focused split-project diagnostic still works when you launch it outside the repo root.
- `npm run smoke:opencode` keeps the default happy-path wrapper contract; use `node scripts/smoke-opencode.mjs --scenario gated-session-diff --topology split-project` when you need the focused split-project diagnostic for the opt-in `session.diff` guardrail path

## Verify

- Run `npm run smoke:opencode` for the default wrapper path.
- Run `node scripts/smoke-opencode.mjs --scenario gated-session-diff --topology split-project` for the focused `session.diff` diagnostic.

## Notes

Current scope:
- normalize a small, explicitly handled event-bus subset into Clipulse events
- reuse shared project context and timing helpers
- resolve the wrapper-side project root from the active `directory` / `worktree` pair conservatively: keep the broader containing root when one contains the other, and prefer the active `worktree` root when the two are disjoint so external worktrees are not swallowed
- keep file-delta capture `file.edited`-first: explicit `file.edited` payloads are the default source of truth, path-only payloads are still forwarded as path-only deltas after bridge-side project-root filtering, and session ownership only falls back without an explicit `sessionID` when exactly one live session is currently tracked
- act as a thin bridge entrypoint that is meant to be called from a local OpenCode plugin wrapper, with event-selection and diff-forwarding policy staying wrapper-local
- include a repository-local wrapper example at `examples/clipulse.ts` that acts as the canonical handled-subset source for `session.created`, `session.deleted`, `session.idle`, `session.error`, `tool.execute.before`, `tool.execute.after`, `tool.execute.error`, and `file.edited`
- keep `session.diff` out of the default ingestion path, even though it exists upstream; it stays default-off unless you explicitly opt in with `CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF=1`
- top-level operator docs should continue to describe `session.diff` as default-off unless you explicitly opt in with `CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF=1`
- allow an opt-in wrapper-only `CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF=1` path that strips `session.diff` down to `{ path, additions, deletions }`, drops paths that resolve outside the project root before bridge output, and drops paths already seen via `file.edited` in the same buffered phase
- when that gated wrapper path forwards a terminal lifecycle event on `session.idle`, a later `session.deleted` for the same still-idle phase is treated as a duplicate and suppressed; any new tool or file activity re-opens the session
- tolerate the current upstream `session.diff` shape aliases (`file`/`path`, `added`/`removed`, `additions`/`deletions`) before normalizing into that minimal forwarded form
- reject obvious repo-external paths in both the wrapper and bridge when `path.relative(projectRoot, absolutePath)` escapes with `..` or comes back as an absolute path, while keeping the bridge's final project scope tied to the `cwd`-resolved git root
- use the same single-live-session ownership fallback rule for both `file.edited` and gated `session.diff` backfill: without an explicit `sessionID`, each path only forwards when exactly one live session is currently tracked by the wrapper, including after a previously ambiguous multi-session state shrinks back to one live session

- the gated smoke path now drives `session.idle` followed by `session.deleted` and expects exactly one terminal Clipulse event, so the canonical wrapper keeps that duplicate-end regression pinned

Current non-goals:
- default `session.diff` ingestion without privacy stripping and dedupe policy
- persisting or forwarding raw `before` / `after` / `patch` / `raw` diff text
- transcript or log scraping
- server-side OpenCode integrations
- default server-driven, local-snapshot, or wrapper-external `session.diff` backfill outside the wrapper path
- full message/TUI event ingestion
