# Clipulse Self-Hosting And Integration Guide

## Scope

This guide covers:

- long-running self-hosted API setup
- local state directory expectations
- Claude Code and Codex integration examples
- example request and response payloads
- a practical troubleshooting checklist

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

## State Directory Notes

Clipulse keeps local retry and snapshot state under `CLIPULSE_STATE_DIR`:

```text
<state>/
  sessions/
  snapshots/
  spool/
    tmp/
    ready/
    processing/
    quarantine/
  claude-transcripts/
```

- `sessions/` stores local timing heuristics.
- `snapshots/` stores local text baselines for Codex file-delta fallback.
- `spool/ready/` is the first place to inspect when delivery is lagging.
- `spool/quarantine/` stores payloads that should not be retried automatically, plus same-name `.meta.json` files describing why they were isolated.
- `claude-transcripts/` stores Claude transcript cursor state.

Recommended operational defaults:

- keep the state directory on local disk, not in the repo
- back up the SQLite file, not the transient state directory
- make sure the same user can read and write both the database file and `CLIPULSE_STATE_DIR`

## Claude Code Integration

Treat `packages/adapter-claude/.claude-plugin/` as the plugin root directory.

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

## Codex Integration

Use `packages/adapter-codex/dist/cli.js` as the hook command target.

Example `hooks.json` snippet:

```json
{
  "hooks": {
    "SessionStart": {
      "command": "node /absolute/path/to/packages/adapter-codex/dist/cli.js"
    },
    "PostToolUse": {
      "command": "node /absolute/path/to/packages/adapter-codex/dist/cli.js"
    },
    "Stop": {
      "command": "node /absolute/path/to/packages/adapter-codex/dist/cli.js"
    }
  }
}
```

Use the same `CLIPULSE_API_URL` and `CLIPULSE_STATE_DIR` environment variables for Codex as for Claude.

## Reporting Endpoint Cheat Sheet

| Endpoint | Purpose | Notes |
| --- | --- | --- |
| `GET /api/v1/projects/top` | Compact project ranking | Summary-only list items |
| `GET /api/v1/sessions/recent` | Compact logical session list | Summary-only list items |
| `GET /api/v1/sessions/{session_id}` | Session detail | Summary-first, not a full timeline |
| `GET /api/v1/projects/{project_ref}` | Project detail | Separate from the session list endpoint |
| `GET /api/v1/projects/{project_ref}/sessions` | Project-scoped session list | Returns `items`, not project detail rollup |

## Example Payloads

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

`file_preview` and `fingerprint` are privacy-safe summary fields:

- `file_preview` is intended to show direction and magnitude of change, not file contents.
- `fingerprint` is a stable identifier for grouping file activity; it is not a raw absolute path.

## Troubleshooting

If data is not arriving:

- check `/healthz`
- inspect `CLIPULSE_API_URL`
- inspect `CLIPULSE_STATE_DIR/spool/ready`
- rebuild the adapter with `npm run build`

If backlog is not draining:

- inspect `spool/ready` and `spool/quarantine`
- look for non-retryable payloads in `quarantine`
- inspect the matching `.meta.json` files first to understand why a payload was isolated
- trigger another hook event after the API is healthy

If session detail looks empty:

- confirm you are querying the right `project_ref` for an ambiguous `session_id`
- remember that Codex snapshot diff returns no deltas on the first baseline capture

If branch or project naming looks wrong:

- confirm the hook `cwd` is inside the intended Git root
- for worktrees, confirm the `.git` pointer and `commondir` files are valid

If Claude changes are missing after compact or transcript rotation:

- rebuild the Claude adapter
- inspect `CLIPULSE_STATE_DIR/claude-transcripts`
- confirm the latest hook run is using the same `session_id` and project root
