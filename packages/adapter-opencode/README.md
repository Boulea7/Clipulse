# Clipulse OpenCode Adapter

Minimal `OpenCode` plugin/event-first adapter for Clipulse alpha+.
Tryable experimental adapter; not yet a first-class stable integration on the same level as `Claude Code` or `Codex`.

Current scope:
- normalize a small, explicitly handled event-bus subset into Clipulse events
- reuse shared project context and timing helpers
- resolve the wrapper-side project root from the active `directory` / `worktree` pair conservatively: keep the broader containing root when one contains the other, and prefer the active `worktree` root when the two are disjoint so external worktrees are not swallowed
- keep file-delta capture `file.edited`-first: explicit `file.edited` payloads are the default source of truth, path-only payloads are still forwarded as path-only deltas after bridge-side project-root filtering, and session ownership only falls back without an explicit `sessionID` when exactly one live session is currently tracked
- act as a thin bridge entrypoint that is meant to be called from a local OpenCode plugin wrapper, with event-selection and diff-forwarding policy staying wrapper-local
- include a repository-local wrapper example at `examples/clipulse.ts` that acts as the canonical handled-subset source for `session.created`, `session.deleted`, `session.idle`, `session.error`, `tool.execute.before`, `tool.execute.after`, `tool.execute.error`, and `file.edited`
- keep `session.diff` out of the default ingestion path, even though it exists upstream
- allow an opt-in wrapper-only `CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF=1` path that strips `session.diff` down to `{ path, additions, deletions }`, drops paths that resolve outside the project root before bridge output, and drops paths already seen via `file.edited` in the same buffered phase
- tolerate the current upstream `session.diff` shape aliases (`file`/`path`, `added`/`removed`, `additions`/`deletions`) before normalizing into that minimal forwarded form
- reject obvious repo-external paths in both the wrapper and bridge when `path.relative(projectRoot, absolutePath)` escapes with `..` or comes back as an absolute path, while keeping the bridge's final project scope tied to the `cwd`-resolved git root
- use the same single-live-session ownership fallback rule for both `file.edited` and gated `session.diff` backfill: without an explicit `sessionID`, each path only forwards when exactly one live session is currently tracked by the wrapper, including after a previously ambiguous multi-session state shrinks back to one live session

Current non-goals:
- default `session.diff` ingestion without privacy stripping and dedupe policy
- persisting or forwarding raw `before` / `after` / `patch` / `raw` diff text
- transcript or log scraping
- server-side OpenCode integrations
- default server-driven, local-snapshot, or wrapper-external `session.diff` backfill outside the wrapper path
- full message/TUI event ingestion
