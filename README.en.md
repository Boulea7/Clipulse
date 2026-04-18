# Clipulse

[简体中文](./README.md) | [繁體中文](./README.zh-TW.md) | [日本語](./README.ja.md)

[![Beta Checks](https://github.com/Boulea7/Clipulse/actions/workflows/beta-checks.yml/badge.svg)](https://github.com/Boulea7/Clipulse/actions/workflows/beta-checks.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-0f766e.svg)](./LICENSE)
[![Python 3.12+](https://img.shields.io/badge/python-3.12%2B-1d4ed8.svg)](./pyproject.toml)
[![Node 22.12+](https://img.shields.io/badge/node-22.12%2B-111827.svg)](./package.json)

Clipulse is a self-hosted activity tracker for coding-agent CLIs. It turns local hooks and plugin events into privacy-aware summaries, a lightweight dashboard, and README-ready badges without uploading source contents or raw prompts.

## Why Clipulse

- Keep the API, SQLite database, and dashboard on infrastructure you control.
- Track active time, wait time, file deltas, languages, models, and host mix.
- Support `Claude Code` and `Codex` as the stable path today.
- Try `Gemini CLI` and `OpenCode` through narrower experimental adapters.
- Expose only badges and README snippets publicly when you want a public surface.

## Status

- First-class support today: `Claude Code`, `Codex`
- Experimental today: `Gemini CLI`, `OpenCode`
- Deployment style: self-hosted, single-user, SQLite-backed
- Current writable deployment boundary: one Clipulse API process per SQLite file
- Diagnostics: `/healthz`, `/api/v1/status`, `doctor`, `pending`

## Quickstart

### Requirements

- `Node.js 22.12+`
- `npm 10+`
- `Python 3.12+`
- `uv`

### 1. Install and build

```bash
npm install
npm run build
uv sync --group dev
```

### 2. Start Clipulse

```bash
export CLIPULSE_DATABASE_URL="sqlite+pysqlite:///$(pwd)/clipulse.sqlite3"
export CLIPULSE_STATE_DIR="/tmp/clipulse-state"
export CLIPULSE_DASHBOARD_TOKEN="replace-with-a-random-dashboard-token"
export CLIPULSE_API_BEARER_TOKEN="replace-with-a-random-api-token"
export CLIPULSE_SESSION_SECRET="replace-with-a-long-random-session-secret"
PYTHONPATH=apps/api uv run python -m clipulse_api.migrate upgrade "$CLIPULSE_DATABASE_URL"
PYTHONPATH=apps/api uv run uvicorn clipulse_api.app:create_app --factory --host 127.0.0.1 --port 8000
```

Only opt into unauthenticated local debugging when you really want it:

```bash
export CLIPULSE_ALLOW_INSECURE_NO_AUTH="1"
```

### 3. Send one sample fixture

```bash
export CLIPULSE_API_URL="http://127.0.0.1:8000"
export CLIPULSE_API_BEARER_TOKEN="$CLIPULSE_API_BEARER_TOKEN"
ROOT="$(pwd)"
sed "s|__CODEX_SMOKE_PROJECT_ROOT__|$ROOT|g" packages/adapter-codex/examples/smoke/session-start.json \
  | node packages/adapter-codex/dist/cli.js
```

This uses a checked-in smoke fixture to prove the wiring and dashboard path, not a real production host event.

### 4. Open the dashboard

Visit `http://127.0.0.1:8000/`.

- Protected mode is now the default: the browser sees a login page first.
- Dashboard login uses `CLIPULSE_DASHBOARD_TOKEN`, write routes use `CLIPULSE_API_BEARER_TOKEN`, and cookies are signed with `CLIPULSE_SESSION_SECRET`.
- Only `CLIPULSE_ALLOW_INSECURE_NO_AUTH=1` opens the dashboard directly for local development.
- `CLIPULSE_SERVER_TOKEN` still works as a legacy fallback, but new deployments should not rely on it. See `docs/self-hosting-and-integration.md` for the exact compatibility boundary.

## Deployment Surface

### Source checkout

This is still the simplest contributor and operator path:

- build the repo
- run `clipulse_api.migrate upgrade`
- launch `uvicorn`

### Python release artifact

`npm run check:py-build` now builds a Python `sdist` and `wheel` that bundle:

- the FastAPI backend
- dashboard static assets under `/static/*`
- dashboard compatibility contracts under `/contracts/*`

`npm run check:py-install-smoke` installs the built release artifacts into clean virtualenvs, starts a real local server, and runs `smoke:deployment` against them.

### Public badge and README routes

If you want a public surface, keep the main dashboard/API private and only publish:

- `/api/v1/badges/*`
- `/api/v1/public/readme/*`

Set both:

```bash
export CLIPULSE_ENABLE_PUBLIC_READS="1"
export CLIPULSE_PUBLIC_BASE_URL="https://clipulse.example"
```

`CLIPULSE_PUBLIC_BASE_URL` is required for public README snippets. Clipulse no longer falls back to request `Host` when building public markdown.

Gemini baseline wiring example: build `packages/adapter-gemini/dist/cli.js` and wire `SessionStart`, `BeforeTool`, `AfterTool`, `BeforeAgent`, `AfterAgent`, and `SessionEnd` from the checked-in example.

`BeforeAgent` and the compatibility alias `UserPromptSubmit` should not both stay wired in the same installation.

OpenCode opt-in guardrail: keep `session.diff` behind `CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF=1`.

## Verify

### Repo verification

```bash
npm run smoke:stable
npm run smoke:experimental
```

### Running deployment probe

For a real already-running instance:

```bash
export CLIPULSE_BASE_URL="http://127.0.0.1:8000"
export CLIPULSE_DASHBOARD_TOKEN="$CLIPULSE_DASHBOARD_TOKEN"
export CLIPULSE_API_BEARER_TOKEN="$CLIPULSE_API_BEARER_TOKEN"
export CLIPULSE_PUBLIC_BASE_URL="http://127.0.0.1:8000"
export CLIPULSE_EXPECT_PUBLIC_READS=1
npm run smoke:deployment
```

Set `CLIPULSE_PUBLIC_PROBE_URL` only when the public outlet lives on a separate origin or proxy path.

On protected deployments, `smoke:deployment` now checks both sides:

- anonymous `/api/v1/status`, `/static/*`, `/contracts/*`, `/docs`, and `/openapi.json` are blocked
- the login page appears at `/`
- the signed browser session can read private dashboard routes after login
- when `CLIPULSE_PUBLIC_PROBE_URL` is set, the probe hits a separate public outlet directly; without it, public checks stay same-origin

<details>
<summary>Environment variables</summary>

- `CLIPULSE_API_URL`: adapter delivery target
- `CLIPULSE_DASHBOARD_TOKEN`: dashboard login token
- `CLIPULSE_API_BEARER_TOKEN`: bearer token for protected ingest and private API reads
- `CLIPULSE_SESSION_SECRET`: signing secret for dashboard session cookies
- `CLIPULSE_DATABASE_URL`: SQLite database URL
- `CLIPULSE_STATE_DIR`: local spool, snapshot, and timing state
- `CLIPULSE_STATE_RETENTION_DAYS`: local retention window
- `CLIPULSE_STATE_MAX_FILES`: retained state-file cap
- `CLIPULSE_STATE_MAX_SPOOL_BYTES`: backlog byte cap
- `CLIPULSE_ALLOW_INSECURE_NO_AUTH=1`: explicit local-only auth bypass
- `CLIPULSE_SERVER_TOKEN`: legacy single-token fallback; not recommended for new deployments
- `CLIPULSE_ENABLE_PUBLIC_READS=1`: allows anonymous badge and README routes
- `CLIPULSE_PUBLIC_BASE_URL`: canonical public origin used in README snippets
- `CLIPULSE_PUBLIC_PROBE_URL`: optional public outlet base URL that `smoke:deployment` probes directly

</details>

<details>
<summary>Adapter entry points</summary>

Stable:

- [Claude adapter README](./packages/adapter-claude/README.md)
- [Claude canonical hooks](./packages/adapter-claude/hooks/hooks.json)
- [Codex adapter README](./packages/adapter-codex/README.md)
- [Codex canonical hooks](./packages/adapter-codex/examples/hooks.json)

Experimental:

- [Gemini adapter README](./packages/adapter-gemini/README.md)
- [Gemini settings example](./packages/adapter-gemini/examples/.gemini/settings.json)
- [OpenCode adapter README](./packages/adapter-opencode/README.md)
- [OpenCode wrapper example](./packages/adapter-opencode/examples/clipulse.ts)

</details>

## Docs

- [Self-hosting and integration guide](./docs/self-hosting-and-integration.md)
- [Release and packaging notes](./docs/release-and-packaging.md)
- `/contracts/dashboard-compat.v1.json`
- `/contracts/events-batch.v1.json`
- [Changelog](./CHANGELOG.md)
- [Security policy](./SECURITY.md)
- [Contributing](./CONTRIBUTING.md)
- [Support](./SUPPORT.md)

## Community

- [Code of Conduct](./CODE_OF_CONDUCT.md)
- [Issue templates](https://github.com/Boulea7/Clipulse/issues/new/choose)
- [Security reporting path](https://github.com/Boulea7/Clipulse/security/policy)
- General contact: <opensource@lnzai.com>
- Private security fallback email: <opensource@lnzai.com>
