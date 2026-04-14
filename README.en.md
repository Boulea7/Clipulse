# Clipulse

[Simplified Chinese](./README.md) | [Traditional Chinese](./README.zh-TW.md) | [日本語](./README.ja.md)

Clipulse is a self-hosted activity tracker for coding-agent CLIs. It turns local hook and plugin events into privacy-aware summaries, a lightweight dashboard, and embeddable badges without uploading source code or raw prompt bodies.

## What You Get

- Your own API, SQLite database, and dashboard
- Rollups for sessions, projects, languages, models, hosts, and line-change summaries
- Stable support for `Claude Code` and `Codex`
- Tryable experimental support for `Gemini CLI` and `OpenCode`
- Public badge and README snippets without exposing the full private dashboard

## Support Status

- First-class support today: `Claude Code`, `Codex`
- Experimental today: `Gemini CLI`, `OpenCode`
- Deployment posture: self-hosting first
- Product posture: beta-ready single-user reporting, not multi-tenant analytics

## Runtime Requirements

- `Node.js 22+`
- `npm 10+`
- `Python 3.12+`
- `uv`
- Source checkout build flow for now; no packaged installer yet

## 5-Minute First Event

1. Install dependencies and build:

```bash
npm install
npm run build
uv sync --group dev
```

2. Start the API:

```bash
export CLIPULSE_DATABASE_URL="sqlite+pysqlite:///$(pwd)/clipulse.sqlite3"
export CLIPULSE_STATE_DIR="/tmp/clipulse-state"
PYTHONPATH=apps/api uv run uvicorn clipulse_api.app:create_app --factory --host 127.0.0.1 --port 8000
```

3. In a second terminal, point a stable adapter at the API and send one real hook event:

```bash
export CLIPULSE_API_URL="http://127.0.0.1:8000"
ROOT="$(pwd)"
sed "s|__CODEX_SMOKE_PROJECT_ROOT__|$ROOT|g" packages/adapter-codex/examples/smoke/session-start.json \
  | node packages/adapter-codex/dist/cli.js
```

4. Open `http://127.0.0.1:8000/`.

- If `CLIPULSE_SERVER_TOKEN` is not set, the dashboard opens directly.
- If `CLIPULSE_SERVER_TOKEN` is set, the browser shows a one-time dashboard login page. Enter the same token and the server stores a signed session cookie instead of exposing the raw API token.
- After the smoke event lands, you should see one session/project row instead of an empty dashboard.

## Core Environment Variables

- `CLIPULSE_API_URL`: API base URL used by adapters for event delivery
- `CLIPULSE_API_BEARER_TOKEN`: optional bearer token used by adapters when the API is protected
- `CLIPULSE_DATABASE_URL`: SQLite path for the API
- `CLIPULSE_STATE_DIR`: local spool, snapshots, and session timing state
- `CLIPULSE_SERVER_TOKEN`: protects private dashboard and `/api/v1/*`
- `CLIPULSE_ENABLE_PUBLIC_READS=1`: explicitly allows anonymous badge and README snippet routes
- `CLIPULSE_PUBLIC_BASE_URL`: required when generating public README snippets from a protected deployment

## Deployment Modes

### Private dashboard and API

Use one private instance for your own dashboard and full `/api/v1/*` surface.

```bash
export CLIPULSE_SERVER_TOKEN="replace-with-a-long-random-token"
export CLIPULSE_API_BEARER_TOKEN="$CLIPULSE_SERVER_TOKEN"
```

- Adapters must inherit both `CLIPULSE_API_URL` and `CLIPULSE_API_BEARER_TOKEN`.
- Browsers do not receive the raw API token. Protected dashboard access uses a signed server cookie after one-time login.

### Public badges and README snippets

Recommended pattern: keep the main dashboard/API private and expose badges through a separate public outlet, reverse-proxy path, or dedicated instance.

- Public routes are limited to `/api/v1/badges/*` and `/api/v1/public/readme/*`
- Keep `/`, `/api/v1/*`, `/static/*`, and `/contracts/*` private on the main instance unless you intentionally want a public dashboard
- Set both:

```bash
export CLIPULSE_ENABLE_PUBLIC_READS="1"
export CLIPULSE_PUBLIC_BASE_URL="https://clipulse.example"
```

- If `CLIPULSE_PUBLIC_BASE_URL` is missing on a protected instance, README snippet routes fail with `503`
- If `CLIPULSE_ENABLE_PUBLIC_READS` is missing, anonymous badge and README snippet routes fail with `401`

## Operator Quick Checks

Run the stable lane first:

```bash
npm run smoke:stable
npm run smoke:experimental
```

Use these as diagnostics, not as a replacement for the smoke lanes:

```bash
curl -i http://127.0.0.1:8000/healthz
curl http://127.0.0.1:8000/api/v1/status
node packages/collector-core/dist/cli.js doctor
node packages/collector-core/dist/cli.js pending
```

Use this minimal ingest probe when the dashboard is still empty and you need to prove delivery works:

```bash
curl -X POST "http://127.0.0.1:8000/api/v1/events/batch" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CLIPULSE_SERVER_TOKEN" \
  -d '{"events":[{"host":"codex","host_version":"0.1.0","session_id":"manual-check","project_root":"/tmp/demo","project_name":"demo","git_branch":"main","event_name":"session_start","event_time":"2026-04-14T12:00:00Z","model_name":"gpt-5.4","os_name":"macos","editor_or_terminal":"terminal","active_ms":1000,"wait_ms":0,"privacy_mode":"hashed","language_stats":{},"file_deltas":[]}]}'
```

## Adapter Wiring

The most common first-run failure is forgetting to pass delivery env vars into the hook/plugin process. Clipulse adapters only deliver to the API when the host process inherits:

- `CLIPULSE_API_URL`
- `CLIPULSE_API_BEARER_TOKEN` when the API is protected

Stable integrations:

- [Claude adapter README](./packages/adapter-claude/README.md)
- [Claude canonical hooks](./packages/adapter-claude/hooks/hooks.json)
- [Codex adapter README](./packages/adapter-codex/README.md)
- [Codex canonical hooks](./packages/adapter-codex/examples/hooks.json)

Experimental integrations:

- `packages/adapter-gemini/dist/cli.js` now provides a tryable hooks-first entrypoint centered on `SessionStart`, `BeforeTool`, `AfterTool`, `BeforeAgent`, `AfterAgent`, and `SessionEnd`
- [Gemini adapter README](./packages/adapter-gemini/README.md)
- [Gemini checked-in settings example](./packages/adapter-gemini/examples/.gemini/settings.json)
- [OpenCode adapter README](./packages/adapter-opencode/README.md)
- [OpenCode wrapper example](./packages/adapter-opencode/examples/clipulse.ts)

Gemini guardrail:

- `BeforeAgent` and the compatibility alias `UserPromptSubmit` should not both stay wired in the same installation

OpenCode guardrail:

- `session.diff` stays opt-in via `CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF=1`

## Privacy and Security

- Clipulse does not upload source file contents
- Clipulse does not upload raw prompt bodies or transcript bodies
- Public badges expose installation-level rollups, not per-project secrets, but they are still public data and should be treated deliberately
- Keep `.clipulse-private/`, SQLite files, `CLIPULSE_STATE_DIR`, `.env*`, `credentials*`, `*.pem`, `*.key`, `*.p12`, and `*.pfx` out of GitHub

For deeper security and deployment guidance, see:

- [Security policy](./SECURITY.md)
- [Self-hosting and integration guide](./docs/self-hosting-and-integration.md)
- [Support](./SUPPORT.md)

## Community

- [Contributing](./CONTRIBUTING.md) `[English]`
- [Code of Conduct](./CODE_OF_CONDUCT.md) `[English]`
- [Security policy](./SECURITY.md) `[English]`
- [Support](./SUPPORT.md) `[English]`
- [Changelog](./CHANGELOG.md)
- [Issue templates](https://github.com/Boulea7/Clipulse/issues/new/choose)

## More Docs

- [Self-hosting and integration guide](./docs/self-hosting-and-integration.md)
- `/contracts/dashboard-compat.v1.json`
- [Claude adapter README](./packages/adapter-claude/README.md)
- [Codex adapter README](./packages/adapter-codex/README.md)
- [Gemini adapter README](./packages/adapter-gemini/README.md)
- [OpenCode adapter README](./packages/adapter-opencode/README.md)
