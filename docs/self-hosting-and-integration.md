# Clipulse Self-Hosting And Integration Guide

## Summary

- Use the top-level `README.md`, `README.en.md`, `README.zh-TW.md`, and `README.ja.md` for concise Operator Quick Checks; use this guide for the longer-running self-hosted setup, detailed runtime payload notes, and troubleshooting steps.
- Self-hosted closure stays simple: `npm run build`, `uv sync --group dev`, then `npm run smoke:self-hosted` before you call the setup healthy.
- `Gemini CLI` and `OpenCode` stay tryable experimental integrations here as well; this guide keeps an operator summary and points package-specific contract detail back to the checked-in package docs.
- The checked-in OpenCode wrapper path at `packages/adapter-opencode/examples/clipulse.ts` assumes a Node runtime that can execute the TypeScript entrypoint via `--experimental-strip-types`, unless you vendor an explicitly equivalent transpiled wrapper.

## Self-Hosting Checklist

1. Build the JavaScript packages:

```bash
npm run build
```

2. Install Python dependencies:

```bash
uv sync --group dev
```

3. Pick stable local paths:

- SQLite database file, for example `/srv/clipulse/clipulse.sqlite3`
- Clipulse state directory, for example `/srv/clipulse/state`

4. Start the API with explicit environment:

```bash
export CLIPULSE_STATE_DIR="/srv/clipulse/state"
PYTHONPATH=apps/api uv run uvicorn clipulse_api.app:create_app \
  --factory \
  --host 0.0.0.0 \
  --port 8000
```

5. Put a reverse proxy in front if you want a stable public URL for badges and README snippets.

## API Probe Roles

- `GET /healthz` is the liveness/uptime probe. It returns `204 No Content` and only tells you that the API process answered.
- `GET /api/v1/status` is the canonical self-hosted runtime/troubleshooting surface. It returns the schema-backed `api` / `db` / `spool` status payload used by the dashboard.
- In practice: use `/healthz` for load balancers and simple uptime checks, and use `/api/v1/status` when you need to explain why the dashboard or backlog looks wrong.
- There is currently no separate readiness probe. If the API still answers, inspect `/api/v1/status` instead of treating `/healthz` as proof that the database and spool state are ready.

## State Directory Notes

Clipulse keeps local retry and snapshot state under `CLIPULSE_STATE_DIR`:

```text
<state>/
  sessions/
  snapshots/
  spool/
    tmp/
    ready/
      <batch>.json
      <batch>.meta.json
    processing/
      <batch>.json
      <batch>.meta.json
    quarantine/
      <batch>.json
      <batch>.meta.json
  claude-transcripts/
```

- `sessions/` stores local timing heuristics.
- `snapshots/` stores local text baselines for Codex file-delta fallback.
- `spool/ready/` is the first place to inspect when delivery is lagging.
- `spool/ready/` and `spool/processing/` can now also keep lightweight local `.meta.json` bookkeeping sidecars so `first_seen_at`, `attempt_count`, and `last_attempted_at` survive recovery.
- Same-name `.meta.json` sidecars may also appear across `ready/`, `processing/`, and `quarantine/` whenever local lineage or troubleshooting fields need to stay with a payload state.
- If a sidecar is only partially malformed, Clipulse now salvages still-valid lineage fields instead of resetting the whole batch identity.
- `spool/quarantine/` stores payloads that should not be retried automatically, plus same-name `.meta.json` files describing why they were isolated.
- old `ready/` and `processing/` backlog can also be quarantined locally when it exceeds the retention window or the spool size cap.
- `claude-transcripts/` stores Claude transcript cursor state.
- `.clipulse-private/` is local research space, is intentionally ignored by snapshots, and should never be committed.

Recommended operational defaults:

- keep the state directory on local disk, not in the repo
- back up the SQLite file, not the transient state directory
- make sure the same user can read and write both the database file and `CLIPULSE_STATE_DIR`
- tune local retention with `CLIPULSE_STATE_RETENTION_DAYS`, `CLIPULSE_STATE_MAX_FILES`, and `CLIPULSE_STATE_MAX_SPOOL_BYTES` only when backlog growth is a real operational problem

## Local Operator Commands

Clipulse now ships a tiny local operator CLI for self-hosted troubleshooting. The README variants intentionally keep only the short check list; the detailed behavior contract stays here:

```bash
node packages/collector-core/dist/cli.js doctor
node packages/collector-core/dist/cli.js pending
```

- `doctor` prints payload-only backlog counts, bytes, oldest ages, orphan metadata-sidecar warnings, quarantine-reason summaries, clearer processing-only / quarantine-only / orphan-only backlog hints, a `mixed backlog` hint when flushable payloads and quarantine coexist, and retention guidance when `stale_backlog` or `spool_size_cap` has already isolated payloads.
- `pending` lists the current `ready` / `processing` / `quarantine` payload entries together with lightweight lineage fields such as `first_seen_at`, `last_attempted_at`, and `attempt_count`.
- These two commands are the entire canonical local operator surface for now; both are read-only, inspect the current `CLIPULSE_STATE_DIR` without creating a missing state directory, and neither resends, deletes, or mutates backlog files.
- When the state directory does not exist yet, both commands now print an explicit “no local state directory yet” hint instead of leaving operators to infer that from all-zero counters alone.
- Unknown CLI commands intentionally fall back to `doctor` and now print an explicit fallback note before the doctor summary.
- Dashboard queue storage copy is intentionally payload-spool-only: it summarizes payload `.json` bytes, not total `CLIPULSE_STATE_DIR` disk usage.
- If the dashboard looks mixed-version, partly blank, or contract-incompatible, also compare the checked-in `/contracts/dashboard-compat.v1.json`; it is the first-party troubleshooting surface for the dashboard's minimum compatibility expectations.

Minimal smoke flow:

```bash
curl -i http://127.0.0.1:8000/healthz
curl http://127.0.0.1:8000/api/v1/status
node packages/collector-core/dist/cli.js doctor
node packages/collector-core/dist/cli.js pending
```

- Expect `/healthz` to return `204`.
- Expect `/api/v1/status` to return `api`, `db`, and `spool` fields.
- Expect `doctor` / `pending` to stay read-only and not create a missing state directory.

Quick operator reading guide:

| Signal | Next step |
| --- | --- |
| `/healthz` is not `204` | Check the API process first. |
| `/api/v1/status` returns zeroed spool counts and the state directory does not exist yet | Treat that as “no local state yet”, not proof that hooks already ran. |
| `ready > 0` | Inspect `CLIPULSE_STATE_DIR/spool/ready` or run `doctor` / `pending`. |
| `quarantine > 0` | Inspect the matching `.meta.json` sidecars and their `reason` fields first. |
| `/api/v1/status` and local `doctor` / `pending` disagree | Treat local spool inspection as the source of truth first, then re-check API reachability and status freshness. |

## Claude Code Integration

Treat `packages/adapter-claude/.claude-plugin/` as the plugin manifest root in the repository, and make sure the final installed plugin root also exposes `hooks/` and `dist/cli.js`.

Local build expectation:

```text
packages/adapter-claude/
  .claude-plugin/
    plugin.json
  hooks/
    hooks.json
  dist/
    cli.js
```

Example environment:

```bash
export CLIPULSE_API_URL="http://127.0.0.1:8000"
export CLIPULSE_STATE_DIR="$HOME/.local/state/clipulse"
```

Example plugin installation flow:

```bash
npm run build
claude --plugin-dir /absolute/path/to/packages/adapter-claude
```

- An empty `PreToolUse` can still implicitly open wait timing even if the adapter suppresses that hook as noise; the wait closes on a later matching boundary.
- `packages/adapter-claude/hooks/hooks.json` is the checked-in canonical wiring source for the Claude path; keep `PostToolUseFailure` / `StopFailure` / `SessionEnd` / `PreCompact` wired when the host exposes them because they are meaningful cleanup / wait boundaries, while `SubagentStop` is still not a transcript-state cleanup boundary by itself.
- `packages/adapter-claude/README.md` now documents the narrower public adapter boundary as well: prompt-only `UserPromptSubmit` stays visible, `Stop` / `StopFailure` / `SessionEnd` / `PreCompact` are cleanup boundaries, and only patch-backed transcript changes are part of the public file-delta contract.

## Codex Integration

Use `packages/adapter-codex/dist/cli.js` as the hook command target.

Use `packages/adapter-codex/examples/hooks.json` as the checked-in canonical wiring source and replace its command path with your local built adapter path.

Current wiring notes:
- The example keeps the common success-path hooks wired: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, and `Stop`.
- If your host also exposes failure-path hooks such as `PostToolUseFailure` or `StopFailure`, keep them wired too; the checked-in example includes them today as cleanup-oriented additions rather than a different minimum baseline.
- `SessionStart` establishes the local snapshot baseline.
- Keep `UserPromptSubmit` wired if you want prompt-only turns to stay visible instead of disappearing behind zero-delta activity.
- `PreToolUse` starts the pending tool wait, and `PostToolUse` / `PostToolUseFailure` close it.
- `Stop`, `StopFailure`, and `SessionEnd` clear local session state.
- `SessionEnd` is an extra best-effort teardown boundary, not the only cleanup barrier.
- Use the same `CLIPULSE_API_URL` and `CLIPULSE_STATE_DIR` environment variables for Codex as for Claude.
- A zero-delta Codex event can still be normal for prompt-only activity, read-only commands, or the first snapshot baseline capture.
- Codex project scoping follows the resolved worktree root rather than collapsing sibling worktrees into one shared common Git directory.
- Successful unscoped session detail lookups are expected to normalize back to project-scoped dashboard hashes.

## Tryable Experimental Integrations

`Gemini CLI` and `OpenCode` remain tryable experimental integrations. Treat the checked-in wiring examples as the canonical public sources for those setups; this guide stays aligned to them instead of redefining a second source of truth.

### Gemini CLI

`packages/adapter-gemini/dist/cli.js` is now tryable as a direct command-hook target. It is still experimental, but it already reuses shared project context and timing helpers, and it covers the highest-value lifecycle boundaries without assuming transcripts or shell parsing. The checked-in package example at `packages/adapter-gemini/examples/.gemini/settings.json` is the canonical wiring source, so this guide intentionally references that file instead of duplicating the full JSON again.

The detailed Gemini integration contract intentionally lives in `packages/adapter-gemini/README.md` together with `packages/adapter-gemini/examples/.gemini/settings.json`; top-level setup docs keep only the operator summary instead of maintaining a second hook-contract copy.

Recommended setup:

```bash
mkdir -p .gemini
cp /absolute/path/to/packages/adapter-gemini/examples/.gemini/settings.json .gemini/settings.json
```

Then replace the placeholder command path inside `.gemini/settings.json` with your local built adapter path:

```text
node /absolute/path/to/packages/adapter-gemini/dist/cli.js
```

Operator summary:
- `BeforeAgent` and the compatibility alias `UserPromptSubmit` should not both stay wired in the same installation; prefer the official `BeforeAgent` / `AfterAgent` pair whenever it is available
- the detailed hook allowlist, ignored-hook behavior, `SessionEnd` fallback semantics, and out-of-scope boundaries stay in `packages/adapter-gemini/README.md`

### OpenCode

`packages/adapter-opencode/dist/plugin.js` is currently a thin bridge entrypoint, not a full drop-in OpenCode plugin module. The recommended tryable path is still a tiny local wrapper plugin that forwards selected official plugin events and named hooks into this bridge.

Use `packages/adapter-opencode/examples/clipulse.ts` as the checked-in canonical wrapper source. Keep the full OpenCode adapter contract in `packages/adapter-opencode/README.md` together with that checked-in wrapper example, so top-level setup docs do not maintain a second prose-defined wrapper contract.

Operator summary:
- the checked-in TypeScript wrapper path assumes a Node runtime that supports `--experimental-strip-types`; if your local OpenCode plugin path cannot execute `.ts` entrypoints that way, transpile or vendor an explicitly equivalent wrapper first
- `file.edited` remains the default high-confidence delta source
- upstream `session.diff` stays default-off unless you explicitly set `CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF=1`
- even with that opt-in, the checked-in wrapper example only forwards minimal `{ path, additions, deletions }` data rather than raw diff text
- the detailed ownership, path-filtering, alias-normalization, and out-of-scope boundaries stay in `packages/adapter-opencode/README.md`

Both packages are now documented enough to try in self-hosted setups, but they remain experimental and should not yet be treated as first-class stable integrations comparable to `Claude Code` or `Codex`. Promotion stays gated on a stable official lifecycle contract, high-confidence file deltas on the default wiring path, and checked-in wiring examples plus fixture/contract coverage that consistently cover success and failure cleanup paths.

Current detail/list payloads also distinguish `host_model_primary` from explicit `last_*` host/model/branch fields, and expose `file_preview_truncated_count` when preview rows omit additional changed files.
For backward compatibility, `sessions/recent` and `projects/{project_ref}/sessions` still keep the full default `host_model_mix` array today even though first-party dashboard list views mainly use `host_model_primary` and `host_model_mix_count`. If that payload is slimmed later, it should happen through an explicit compatibility migration rather than a silent default change.
The current explicit opt-in slimming path is `compact=true` on those two list routes: it omits `host_model_mix` while keeping `host_model_primary` and `host_model_mix_count`.
The first-party dashboard prefers that `compact=true` path, then makes one fallback request to the default full route only when the compact response fails explicit compatibility checks such as route absence, invalid JSON, or invalid compact item shape.

## Reporting Endpoint Cheat Sheet

| Endpoint | Purpose | Notes |
| --- | --- | --- |
| `GET /healthz` | Liveness/uptime probe | Returns `204` only; no API/DB/spool/detail payloads |
| `GET /api/v1/badges/top-language.svg` | Public SVG badge | Direct image embed surface |
| `GET /api/v1/badges/today-time.svg` | Public SVG badge | Direct image embed surface |
| `GET /api/v1/badges/this-week-time.svg` | Public SVG badge | Direct image embed surface |
| `GET /api/v1/projects/top` | Compact project ranking | Summary-only list items |
| `GET /api/v1/sessions/recent` | Logical recent session list | Default route keeps the backward-compatible full contract; dashboard prefers `compact=true` and falls back once to full on explicit compatibility failures |
| `GET /api/v1/sessions/{session_id}` | Session detail | Summary-first, not a full timeline |
| `GET /api/v1/projects/{project_ref}` | Project detail | Separate from the session list endpoint |
| `GET /api/v1/projects/{project_ref}/sessions` | Project-scoped session list | Default route keeps the backward-compatible full contract; dashboard prefers `compact=true` and falls back once to full on explicit compatibility failures |
| `GET /api/v1/status` | Self-hosted runtime status | Schema-backed minimal `api` / `db` / `spool` view with queue bytes and oldest-age hints |
| `GET /api/v1/public/readme/top-language` | Public Markdown snippet | Canonical README snippet surface; embeds the corresponding badge URL |
| `GET /api/v1/public/readme/today-time` | Public Markdown snippet | Canonical README snippet surface; embeds the corresponding badge URL |
| `GET /api/v1/public/readme/this-week-time` | Public Markdown snippet | Canonical README snippet surface; embeds the corresponding badge URL |

For the three list endpoints above, non-positive `limit` values now clamp to an empty `items` array instead of slicing in a surprising way.

## Example Payloads

The examples below are intentionally abbreviated. Current list/detail responses also include fields such as `first_event_time`, `last_event_time`, `events`, `host_model_mix`, `host_model_primary`, `changed_files_count`, `changed_languages_count`, and `lines_*`; treat the API schema as the source of truth for the full response shape.

For project-facing labels, project and session detail now share one canonical `project_name` per `project_root`: the earliest recorded name for that project root wins, even if later events report a different project name.

Example batch request:

```json
{
  "events": [
    {
      "event_id": "demo-event-1",
      "host": "codex",
      "host_version": "0.1.0",
      "session_id": "demo-session",
      "project_root": "/workspace/demo",
      "project_name": "demo",
      "git_branch": "feat/example",
      "event_name": "post_tool_use",
      "event_time": "2026-04-06T12:00:00Z",
      "model_name": "gpt-5.4",
      "os_name": "macos",
      "editor_or_terminal": "terminal",
      "active_ms": 12000,
      "wait_ms": 3000,
      "privacy_mode": "hashed",
      "language_stats": {
        "TypeScript": { "added": 5, "removed": 1, "changed": 6 }
      },
      "file_deltas": [
        {
          "fingerprint": "example-fingerprint",
          "language": "TypeScript",
          "added": 5,
          "removed": 1
        }
      ]
    }
  ]
}
```

`ready` / `processing` / `quarantine` counts and byte totals are payload-only and only count payload `.json` files; local `.meta.json` bookkeeping sidecars and stray non-payload files are intentionally excluded from `/api/v1/status`.
Orphan bookkeeping sidecars also should not block the current batch from being sent; payload backlog decisions are payload-file-based.
If the state directory has not been created yet, `/api/v1/status` returns zeroed spool counts instead of failing.

Example ingest response with partial outcomes:

```json
{
  "accepted": 1,
  "duplicates": 1,
  "invalid": 1,
  "results": [
    { "event_id": "event-ok", "status": "accepted", "retryable": false },
    { "event_id": "event-dup", "status": "duplicate", "retryable": false },
    { "event_id": "event-bad", "status": "invalid", "retryable": false }
  ]
}
```

When the API has to generate a fallback `event_id`, it also canonicalizes equivalent UTC timestamp forms before hashing, so the same event is less likely to split only because one sender used `Z` and another used `+00:00`.

Example runtime status response:

```json
{
  "api": { "status": "ok", "version": "0.1.0" },
  "db": { "status": "ok", "events": 8, "projects": 2, "sessions": 3 },
  "spool": {
    "state_dir": "/srv/clipulse/state",
    "ready": 2,
    "processing": 1,
    "quarantine": 1,
    "ready_bytes": 2048,
    "processing_bytes": 512,
    "quarantine_bytes": 1024,
    "oldest_backlog_age_seconds": 3600,
    "oldest_quarantine_age_seconds": 7200
  }
}
```

First-boot empty state is also a valid `/api/v1/status` response shape:

```json
{
  "api": { "status": "ok", "version": "0.1.0" },
  "db": { "status": "ok", "events": 0, "projects": 0, "sessions": 0 },
  "spool": {
    "state_dir": "/home/demo/.local/state/clipulse",
    "ready": 0,
    "processing": 0,
    "quarantine": 0,
    "ready_bytes": 0,
    "processing_bytes": 0,
    "quarantine_bytes": 0,
    "oldest_backlog_age_seconds": 0,
    "oldest_quarantine_age_seconds": 0
  }
}
```

`/healthz` is intentionally not a substitute for this payload. A successful `204` from `/healthz` only means the process answered; it does not confirm database readability, spool visibility, or dashboard-ready status data.

Example recent-session item:

```json
{
  "session_id": "demo-session",
  "project_name": "demo",
  "project_ref": "abc123def456",
  "host": "codex",
  "model_name": "gpt-5.4",
  "git_branch": "feat/example",
  "event_count": 3,
  "events": 3,
  "active_ms": 18000,
  "wait_ms": 3000,
  "changed_files_count": 2,
  "changed_languages_count": 1,
  "lines_added": 8,
  "lines_removed": 1,
  "lines_changed": 9,
  "top_language": { "name": "TypeScript", "changed": 9 },
  "host_model_mix_count": 1
}
```

Example default full list item:

```json
{
  "session_id": "demo-session",
  "project_ref": "abc123def456",
  "host_model_mix": [
    { "host": "codex", "model_name": "gpt-5.4", "events": 3, "active_ms": 18000, "wait_ms": 3000 }
  ],
  "host_model_mix_count": 1,
  "host_model_primary": { "host": "codex", "model_name": "gpt-5.4", "events": 3, "active_ms": 18000, "wait_ms": 3000 }
}
```

Example `compact=true` list item:

```json
{
  "session_id": "demo-session",
  "project_ref": "abc123def456",
  "host_model_mix_count": 1,
  "host_model_primary": { "host": "codex", "model_name": "gpt-5.4", "events": 3, "active_ms": 18000, "wait_ms": 3000 }
}
```

Example session detail:

```json
{
  "session_id": "demo-session",
  "project_name": "demo",
  "project_ref": "abc123def456",
  "host": "codex",
  "model_name": "gpt-5.4",
  "git_branch": "feat/example",
  "event_count": 3,
  "active_ms": 18000,
  "wait_ms": 3000,
  "languages": [
    { "name": "TypeScript", "added": 8, "removed": 1, "changed": 9 }
  ],
  "file_preview": [
    { "fingerprint": "example-fingerprint", "language": "TypeScript", "added": 8, "removed": 1 }
  ],
  "top_language": { "name": "TypeScript", "changed": 9 }
}
```

Example project detail:

```json
{
  "project_name": "demo",
  "project_ref": "abc123def456",
  "active_ms": 24000,
  "wait_ms": 4000,
  "event_count": 5,
  "session_count": 2,
  "file_preview": [
    { "fingerprint": "example-fingerprint", "language": "TypeScript", "added": 8, "removed": 1 }
  ],
  "top_language": { "name": "TypeScript", "changed": 9 },
  "host_model_mix": []
}
```

Example project sessions list:

```json
{
  "project_name": "demo",
  "project_ref": "abc123def456",
  "items": [
    {
      "session_id": "demo-session",
      "project_name": "demo",
      "project_ref": "abc123def456",
      "host": "codex",
      "model_name": "gpt-5.4",
      "git_branch": "feat/example",
      "first_event_time": "2026-04-06T12:00:00Z",
      "last_event_time": "2026-04-06T12:03:00Z",
      "event_count": 3,
      "events": 3,
      "active_ms": 18000,
      "wait_ms": 3000,
      "changed_files_count": 2,
      "changed_languages_count": 1,
      "lines_added": 8,
      "lines_removed": 1,
      "lines_changed": 9,
      "top_language": { "name": "TypeScript", "changed": 9 },
      "host_model_mix_count": 1
    }
  ]
}
```

If `session_id` is ambiguous across multiple projects, retry session detail with `project_ref`:

```text
GET /api/v1/sessions/<session_id>?project_ref=<project_ref>
```

The API returns a machine-readable `409` with `code` and `hint` when that scope is missing.

```json
{
  "detail": {
    "code": "ambiguous_session",
    "message": "session_id matched multiple projects",
    "hint": "Retry with the matching project_ref from /api/v1/projects/top or /api/v1/sessions/recent."
  }
}
```

`file_preview` and `fingerprint` are privacy-safe summary fields:

- `file_preview` is intended to show direction and magnitude of change, not file contents.
- `fingerprint` is a stable identifier for grouping file activity; it is not a raw absolute path.

Example quarantine sidecar metadata:

```json
{
  "reason": "stale_backlog",
  "status": null,
  "event_count": 1,
  "first_seen_at": "2026-04-07T03:00:00.000Z",
  "last_attempted_at": "2026-04-07T03:00:00.000Z",
  "source_state": "ready",
  "approx_bytes": 512
}
```

## Troubleshooting

If data is not arriving:

- check `/healthz`
- check `/api/v1/status`
- inspect `CLIPULSE_API_URL`
- inspect `CLIPULSE_STATE_DIR/spool/ready`
- rebuild the adapter with `npm run build`

If backlog is not draining:

- inspect `spool/ready` and `spool/quarantine`
- look for non-retryable payloads in `quarantine`
- inspect the matching `.meta.json` files first to understand why a payload was isolated
- common `reason` values are `http_error`, `invalid_results`, `recovery_failed`, `invalid_spool_payload`, `stale_backlog`, and `spool_size_cap`
- use `/api/v1/status` to confirm `ready` / `processing` / `quarantine` counts match local disk state, then check `*_bytes` and `oldest_*_age_seconds` to see whether backlog is merely waiting, genuinely stuck, or already being quarantined by local caps
- use `node packages/collector-core/dist/cli.js doctor` or `pending` when you want the same local spool picture directly in the terminal without opening the dashboard; `doctor` now also calls out quarantine-only backlog and `mixed backlog` when flushable payloads still coexist with quarantine
- the dashboard home detail queue-backlog line now also mentions oldest quarantine age when quarantine is non-empty, but deeper queue diagnosis still stays local-first through `doctor` / `pending` and sidecar metadata
- remember that `404 project_not_found` and `404 session_not_found` are stable troubleshooting contracts alongside `409 ambiguous_session`
- dedicated project/session detail endpoints can still succeed even if `projects/top` or `sessions/recent` is temporarily degraded
- on project routes, the project detail and project sessions requests now degrade independently: a temporary project sessions failure should not hide a healthy project detail payload
- trigger another hook event after the API is healthy

If session detail looks empty:

- confirm you are querying the right `project_ref` for an ambiguous `session_id`
- remember that `projects/{project_ref}/sessions` keeps the default full list contract unless you explicitly opt into `compact=true`; project summary fields still live on `projects/{project_ref}`
- remember that Codex snapshot diff returns no deltas on the first baseline capture

If branch or project naming looks wrong:

- confirm the hook `cwd` is inside the intended Git root
- for worktrees, confirm the `.git` pointer and `commondir` files are valid

If Claude changes are missing after compact or transcript rotation:

- rebuild the Claude adapter
- remember that an empty `PreToolUse` can still open an implicit wait even if the adapter suppresses the noise event; the wait only closes on a later matching boundary
- inspect `CLIPULSE_STATE_DIR/claude-transcripts`
- confirm the latest hook run is using the same `session_id` and project root

If Codex file moves look larger than expected:

- remember that rename / move is currently summarized as remove-plus-add, not as a first-class rename event
- complex Bash commands intentionally fall back to broader snapshot comparison to avoid undercounting changes

If local backlog is being quarantined unexpectedly:

- inspect the quarantine sidecar `reason` and `source_state`
- compare `oldest_backlog_age_seconds` with your retention window
- compare `ready_bytes + processing_bytes` with your configured spool size cap
