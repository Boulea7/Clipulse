# Clipulse OpenCode Adapter

Minimal `OpenCode` plugin/event-first adapter for Clipulse alpha+.

Current scope:
- normalize a small event-bus subset into Clipulse events
- reuse shared project context and timing helpers
- keep file-delta capture limited to explicit `file.edited` payloads
- act as a thin bridge entrypoint that is meant to be called from a local OpenCode plugin wrapper
- include a repository-local wrapper example at `examples/clipulse.ts` that forwards official `session.*`, named `tool.execute.*`, and `file.edited` payloads
- keep `session.diff` out of the default ingestion path for now, even though it exists upstream
- allow an opt-in wrapper-only `CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF=1` path that strips `session.diff` down to `{ path, additions, deletions }` and drops paths already seen via `file.edited` in the same buffered phase

Current non-goals:
- default `session.diff` ingestion without privacy stripping and dedupe policy
- persisting or forwarding raw `before` / `after` / `patch` diff text
- transcript or log scraping
- server-side OpenCode integrations
- server-driven or local-snapshot `session.diff` backfill outside the wrapper path
- full message/TUI event ingestion
