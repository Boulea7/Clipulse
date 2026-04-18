# Clipulse Architecture Overview

## Summary

Clipulse is a self-hosted activity tracker for coding-agent CLIs. Its architecture is organized around one local event boundary, one private API/dashboard boundary, and an optional narrow public-read boundary for badges and README snippets.

## Data Flow At A Glance

1. A host-specific adapter observes local lifecycle events from `Claude Code`, `Codex`, `Gemini CLI`, or `OpenCode`.
2. The adapter normalizes those events through `packages/collector-core` into the shared batch contract.
3. The batch is delivered to the FastAPI runtime in `apps/api`, usually through `CLIPULSE_API_URL`.
4. The API stores bounded activity metadata in SQLite and serves summaries, dashboard views, badges, and README snippets.
5. The bundled dashboard from `apps/web` reads private reporting routes, while optional public routes can expose badge or README markdown only.

## Trust Boundaries

### Boundary 1: Local host process

- Adapters run next to the coding-agent CLI.
- Local state, spool, and retry helpers live under `CLIPULSE_STATE_DIR`.
- `doctor` and `pending` are local diagnostic commands, not remote control channels.

### Boundary 2: Transport contract

- `packages/collector-core` is the narrow gate between host-local events and the server.
- The default wire format is intentionally bounded.
- By default, it keeps hashed `project_root` scope keys, host/model identifiers, timestamps, aggregate language stats, and file-delta counts.
- By default, it excludes raw local paths, source contents, raw prompts, and raw transcripts.

### Boundary 3: Private API and dashboard

- `apps/api` is the deployable runtime for `/`, `/api/v1/*`, `/static/*`, and `/contracts/*`.
- Protected mode uses `CLIPULSE_DASHBOARD_TOKEN`, `CLIPULSE_API_BEARER_TOKEN`, and `CLIPULSE_SESSION_SECRET` to separate dashboard reads from write-capable API access.
- SQLite is currently a single-writer boundary: one Clipulse API process per database file.

### Boundary 4: Optional public read surface

- Public access is intentionally narrower than the private dashboard/API.
- The expected public routes are `/api/v1/badges/*` and `/api/v1/public/readme/*`.
- `CLIPULSE_ENABLE_PUBLIC_READS=1` enables those routes, and `CLIPULSE_PUBLIC_BASE_URL` defines the canonical origin used in README snippets.
- This surface is meant for publication-ready rollups, not for the private dashboard.

## Main Components

- `packages/collector-core`
  - Shared normalization, timing, local spool, delivery, and operator CLI helpers.
- `packages/adapter-claude`
  - Stable `Claude Code` hooks-first adapter.
- `packages/adapter-codex`
  - Stable `Codex` hooks-first adapter.
- `packages/adapter-gemini`
  - Experimental `Gemini CLI` hooks-first adapter.
- `packages/adapter-opencode`
  - Experimental `OpenCode` wrapper adapter.
- `apps/api`
  - FastAPI ingestion, auth, reporting, public badge/README routes, and packaged dashboard serving.
- `apps/web`
  - Bundled dashboard assets served by the API package instead of a separate hosted SPA.

## Runtime Surfaces

- `GET /healthz`
  - Liveness only.
- `GET /api/v1/status`
  - Runtime status snapshot for API, database, spool, and compatibility metadata.
- `/contracts/dashboard-compat.v1.json`
  - First-party compatibility artifact for dashboard troubleshooting and packaging verification.
- `/api/v1/badges/*`
  - Optional public SVG rollups.
- `/api/v1/public/readme/*`
  - Optional public README markdown snippets built from those badge routes.

## Packaging View

- A source checkout is the shortest contributor and operator path.
- Built Python artifacts package the FastAPI runtime, bundled dashboard assets, and `/contracts/*`.
- `README.package.md` explains artifact installation.
- `docs/release-and-packaging.md` explains how those artifacts fit into the public deployment story.

## Support Tiers

- Stable today: `Claude Code`, `Codex`
- Experimental today: `Gemini CLI`, `OpenCode`

Experimental adapters stay intentionally narrower than the stable path. For example, Gemini wiring starts from `packages/adapter-gemini/dist/cli.js` and the checked examples, and `OpenCode` keeps `session.diff` behind `CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF=1`.

## What Clipulse Tries Not To Collect

Clipulse is designed to avoid uploading:

- source file contents
- raw prompt contents
- raw transcript contents
- raw local project paths in the default public transport contract

That privacy baseline is part of the architecture, not just a docs promise. Any future change that weakens it should stay explicit, configurable, and easy to audit.
