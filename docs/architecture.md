# Clipulse Architecture Overview

## Summary

Clipulse is a self-hosted activity tracker for coding-agent CLIs. The repository is organized around one deployable Python runtime, one lightweight browser dashboard, and several host-specific adapters that normalize local events into a shared transport contract.

## Main Surfaces

- `apps/api`
  - FastAPI ingestion, reporting, auth, contracts, and packaged dashboard serving.
  - This is the deployable runtime behind `/`, `/api/v1/*`, `/static/*`, and `/contracts/*`.
- `apps/web`
  - Lightweight browser dashboard assets served by the API package.
  - Treated as a bundled frontend surface, not a separate hosted SPA.
- `packages/collector-core`
  - Shared event normalization, delivery, local state, spool, timing, and operator CLI helpers such as `doctor` and `pending`.
- `packages/adapter-claude`
  - Stable `Claude Code` hooks-first adapter.
- `packages/adapter-codex`
  - Stable `Codex` hooks-first adapter.
- `packages/adapter-gemini`
  - Experimental `Gemini CLI` hooks-first adapter.
- `packages/adapter-opencode`
  - Experimental `OpenCode` wrapper/bridge adapter.

## Delivery Model

- Adapters normalize host-local hook or wrapper events into the shared outbound batch contract.
- `collector-core` either delivers batches to `CLIPULSE_API_URL` or emits them to stdout for local wiring.
- The API stores bounded activity metadata in SQLite and serves summaries, badges, README snippets, and the dashboard shell.

## Support Tiers

- Stable today: `Claude Code`, `Codex`
- Experimental today: `Gemini CLI`, `OpenCode`
- Current deployable release artifact: Python self-hosted API/dashboard package

## Scope Boundaries

- Privacy defaults exclude raw source contents, raw prompts, raw transcripts, and raw local paths from the default transport contract.
- SQLite is currently a single-writer deployment boundary: one Clipulse API process per database file.
- Experimental adapters stay intentionally narrower than the stable surfaces and may require opt-in wiring or extra diagnostics.
