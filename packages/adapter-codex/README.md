# Clipulse Codex Adapter

Minimal `Codex` hooks-first adapter for Clipulse alpha+.

Canonical wiring:
- `examples/hooks.json` is the checked-in wiring source of truth.
- Replace `node packages/adapter-codex/dist/cli.js` with your local built adapter path when wiring outside this repo.

Cleanup boundaries:
- `PostToolUseFailure` can still finalize a pending tool wait.
- `StopFailure` and `SessionEnd` still matter for cleanup and local state teardown.
- If your Codex host exposes those failure-path hooks, keep them wired.

Zero-delta notes:
- Prompt-only activity can legitimately produce zero deltas.
- Read-only commands can legitimately produce zero deltas.
- The first snapshot baseline capture can also legitimately produce zero deltas before later changes appear.

Current scope:
- shared project-root / branch enrichment
- shared session timing
- snapshot-based local file-delta fallback
- worktree-aware project context resolution
