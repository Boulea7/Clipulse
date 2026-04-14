# Clipulse Self-Hosting And Integration Guide

## Summary

- Use the top-level `README.md`, `README.en.md`, `README.zh-TW.md`, and `README.ja.md` for the public overview.
- Treat `npm run smoke:stable` as the stable gate for `Claude Code` and `Codex`.
- Treat `npm run smoke:experimental` as the experimental gate for `Gemini CLI` and `OpenCode`.
- Use `npm run smoke:self-hosted` for focused stable self-hosted checks.
- Use `npm run smoke:self-hosted:experimental` for focused experimental self-hosted checks.
- Keep the main dashboard/API private by default. Expose public badge and README routes through a separate public outlet, limited reverse proxy path, or dedicated instance.
- Keep package-specific host contracts in the package READMEs instead of duplicating every host detail here.

## Supported Runtime Floor

- `Node.js 22+`
- `npm 10+`
- `Python 3.12+`
- `uv`

These are the currently documented floors because the beta CI lane runs Node 22 and Python 3.12.

## Deployment Modes

### Mode A: Private dashboard and full API

Use one private instance for:

- `/`
- `/static/*`
- `/contracts/*`
- `/api/v1/*`

Recommended environment:

```bash
export CLIPULSE_DATABASE_URL="sqlite+pysqlite:////srv/clipulse/clipulse.sqlite3"
export CLIPULSE_STATE_DIR="/srv/clipulse/state"
export CLIPULSE_SERVER_TOKEN="replace-with-a-long-random-token"
export CLIPULSE_API_BEARER_TOKEN="$CLIPULSE_SERVER_TOKEN"
PYTHONPATH=apps/api uv run uvicorn clipulse_api.app:create_app \
  --factory \
  --host 127.0.0.1 \
  --port 8000
```

Behavior:

- Adapters must inherit both `CLIPULSE_API_URL` and `CLIPULSE_API_BEARER_TOKEN`
- Browsers do not receive the raw API bearer token
- When `CLIPULSE_SERVER_TOKEN` is set, the dashboard root shows a one-time login page until the user enters the token
- After successful login, the server sets a signed dashboard session cookie

### Mode B: Public badges and README snippets

Recommended pattern:

- Keep the main dashboard/API private
- Publish only:
  - `/api/v1/badges/*`
  - `/api/v1/public/readme/*`

Required environment:

```bash
export CLIPULSE_ENABLE_PUBLIC_READS="1"
export CLIPULSE_PUBLIC_BASE_URL="https://clipulse.example"
```

Important behavior:

- If `CLIPULSE_ENABLE_PUBLIC_READS` is not enabled, anonymous badge and README routes return `401`
- If `CLIPULSE_PUBLIC_BASE_URL` is missing on a protected deployment, README snippet routes return `503`
- Public badges expose installation-level rollups such as top language and today/this-week time. They are public data once you expose them.

## First-Run Checklist

1. Build the JavaScript workspaces:

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

4. Start the API with explicit environment variables:

```bash
export CLIPULSE_DATABASE_URL="sqlite+pysqlite:////srv/clipulse/clipulse.sqlite3"
export CLIPULSE_STATE_DIR="/srv/clipulse/state"
PYTHONPATH=apps/api uv run uvicorn clipulse_api.app:create_app \
  --factory \
  --host 127.0.0.1 \
  --port 8000
```

5. In the adapter host process, export delivery variables before wiring hooks:

```bash
export CLIPULSE_API_URL="http://127.0.0.1:8000"
export CLIPULSE_API_BEARER_TOKEN="$CLIPULSE_SERVER_TOKEN"
```

6. Trigger one event from a stable host integration.

7. Open the dashboard and verify that the first session/project row appears.

## Minimal Delivery Proof

Use this when the dashboard is empty and you need to distinguish “server is alive” from “events are actually arriving”.

```bash
curl -X POST "http://127.0.0.1:8000/api/v1/events/batch" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CLIPULSE_SERVER_TOKEN" \
  -d '{"events":[{"host":"codex","host_version":"0.1.0","session_id":"manual-check","project_root":"/tmp/demo","project_name":"demo","git_branch":"main","event_name":"session_start","event_time":"2026-04-14T12:00:00Z","model_name":"gpt-5.4","os_name":"macos","editor_or_terminal":"terminal","active_ms":1000,"wait_ms":0,"privacy_mode":"hashed","language_stats":{},"file_deltas":[]}]}'
```

If this works but your real host integration still produces an empty dashboard, the usual problem is that the hook/plugin process did not inherit `CLIPULSE_API_URL` or `CLIPULSE_API_BEARER_TOKEN`.

## Runtime Surfaces

- `GET /healthz` is liveness only. It returns `204 No Content`.
- `GET /api/v1/status` is the canonical self-hosted runtime and troubleshooting surface for the dashboard.
- `node packages/collector-core/dist/cli.js doctor` and `node packages/collector-core/dist/cli.js pending` are the canonical local read-only spool diagnostics.
- If the dashboard looks mixed-version, blank, or contract-incompatible, compare the checked-in `/contracts/dashboard-compat.v1.json`.
- There is no separate readiness probe. Use `/api/v1/status` for operator context instead of treating `/healthz` as proof that every dependency is healthy.

## Manual Probes

Manual probes stay diagnostic only. They do not replace `npm run smoke:stable`, `npm run smoke:experimental`, `npm run smoke:self-hosted`, or `npm run smoke:self-hosted:experimental`.

Use these after `npm run smoke:stable`, `npm run smoke:self-hosted`, or `npm run smoke:experimental` fails, or when you need a direct diagnostic pass against a running deployment.

```bash
curl -i http://127.0.0.1:8000/healthz
curl http://127.0.0.1:8000/api/v1/status
node packages/collector-core/dist/cli.js doctor
node packages/collector-core/dist/cli.js pending
```

- Expect `/healthz` to return `204`
- Expect `/api/v1/status` to summarize API, database, spool state, and dashboard compatibility metadata
- Use `doctor` for a short local summary and `pending` when you need to inspect queued payload files

## Reverse Proxy Notes

For a private dashboard deployment, keep these paths on the same origin:

- `/`
- `/static/*`
- `/contracts/*`
- `/api/v1/*`

The browser dashboard fetches `/api/v1/*` and `/contracts/dashboard-compat.v1.json` directly from the same origin. If your reverse proxy forwards only `/` and `/api/v1/*` but not `/static/*` or `/contracts/*`, the page can open and still fall back into degraded compatibility behavior.

For a public badge/snippet outlet, expose only:

- `/api/v1/badges/*`
- `/api/v1/public/readme/*`

Do not publish the private dashboard origin just to make badges work.

## Dashboard Login Flow

When `CLIPULSE_SERVER_TOKEN` is enabled:

- `/api/v1/*` requires bearer auth or a valid signed dashboard session cookie
- The dashboard root shows a one-time login page until the token is provided
- The login page trades the token for a signed cookie; the browser never receives the raw API token as a reusable cookie value

This is intentionally different from adapter delivery:

- Browsers use the signed dashboard cookie after login
- Adapters use `CLIPULSE_API_BEARER_TOKEN`

## Token Rotation

1. Generate a new random `CLIPULSE_SERVER_TOKEN`
2. Update the server environment
3. Update `CLIPULSE_API_BEARER_TOKEN` for every adapter host
4. Restart the API process
5. Restart or reload host integrations so they inherit the new env
6. Revisit the protected dashboard and log in again to mint a new signed session cookie
7. Re-check badge/snippet behavior if you also changed `CLIPULSE_PUBLIC_BASE_URL` or public proxy rules

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

- `sessions/` stores local timing heuristics
- `snapshots/` stores local baselines for Codex file-delta fallback
- `spool/ready/` is the first place to inspect when delivery is lagging
- `spool/quarantine/` stores payloads that should not be retried automatically, plus matching `.meta.json` notes
- Keep the state directory on local disk rather than inside the repository checkout
- Back up the SQLite file; do not treat transient spool state as the long-term source of truth

## Stable Host Integrations

### Claude Code

- Treat `packages/adapter-claude/.claude-plugin/` as the plugin manifest root
- The checked-in canonical wiring source is `packages/adapter-claude/hooks/hooks.json`
- `packages/adapter-claude/README.md` is the public source of truth for installation notes
- Keep `PostToolUseFailure`, `StopFailure`, `SessionEnd`, and `PreCompact` wired when the host exposes them

### Codex

- Use `packages/adapter-codex/dist/cli.js` as the hook command target
- Use `packages/adapter-codex/examples/hooks.json` as the checked-in canonical wiring source
- `packages/adapter-codex/README.md` is the public source of truth for installation notes
- Keep `UserPromptSubmit` wired if you want prompt-only turns to remain visible, and keep failure-path hooks wired when the host exposes them

## Experimental Integrations

### Gemini CLI

- `packages/adapter-gemini/dist/cli.js` is tryable as a direct command-hook target
- The checked-in canonical wiring source is `packages/adapter-gemini/examples/.gemini/settings.json`
- The detailed host contract intentionally lives in `packages/adapter-gemini/README.md`
- The public summary covers `SessionStart`, `BeforeTool`, `AfterTool`, `BeforeAgent`, `AfterAgent`, and `SessionEnd` without assuming transcripts or shell parsing
- Keep `BeforeAgent` and the compatibility alias `UserPromptSubmit` not both wired in the same installation

### OpenCode

- `packages/adapter-opencode/dist/plugin.js` is a thin bridge entrypoint, not a full drop-in plugin
- The checked-in wrapper example is `packages/adapter-opencode/examples/clipulse.ts`
- The detailed host contract intentionally lives in `packages/adapter-opencode/README.md`
- `file.edited` remains the default high-confidence delta source
- `session.diff` stays default-off unless you explicitly set `CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF=1`
- The checked-in wrapper forwards only the minimal `{ path, additions, deletions }` shape even when that opt-in is enabled

## Never Push These Files

- `.clipulse-private/`
- `CLIPULSE_STATE_DIR` and everything inside it
- SQLite databases such as `clipulse.sqlite3`
- `.env*`
- `credentials*`
- `*.pem`
- `*.key`
- `*.p12`
- `*.pfx`

`.gitignore` already blocks these by default, but operators should still treat them as strictly local.

## Troubleshooting Notes

- If the dashboard is up but the data looks stale, compare `/api/v1/status` with local `doctor` and `pending` output
- If the host integration behavior is unclear, prefer the package README and the checked-in example for that host over copied snippets from issues or chat logs
- If a report could expose source contents, raw prompts, raw transcripts, private paths, or secrets, do not put it in a public issue. Use `SECURITY.md` and the private reporting path instead

## Community Links

- `CONTRIBUTING.md`
- `SECURITY.md`
- `CODE_OF_CONDUCT.md`
- `SUPPORT.md`
- <https://github.com/Boulea7/Clipulse/issues/new/choose>
