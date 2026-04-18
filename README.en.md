# Clipulse

[简体中文](./README.md) | [繁體中文](./README.zh-TW.md) | [日本語](./README.ja.md)

[![Beta Checks](https://github.com/Boulea7/Clipulse/actions/workflows/beta-checks.yml/badge.svg)](https://github.com/Boulea7/Clipulse/actions/workflows/beta-checks.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-0f766e.svg)](./LICENSE)
[![Python 3.12+](https://img.shields.io/badge/python-3.12%2B-1d4ed8.svg)](./pyproject.toml)
[![Node 22.12+](https://img.shields.io/badge/node-22.12%2B-111827.svg)](./package.json)

Clipulse is a self-hosted activity tracker for coding-agent CLIs. It turns local hooks and plugin events into privacy-aware summaries, a lightweight dashboard, and README-ready badges without uploading source contents or raw prompts.

## Why Clipulse

- Keep the API, SQLite database, and dashboard on infrastructure you control.
- Track active time, wait time, file deltas, languages, models, and host mix from one bounded event contract.
- Publish badges and README snippets without opening the private dashboard.
- Start from a source checkout today, then move to built Python release artifacts when you want a cleaner packaging path.

By default, Clipulse keeps the wire format narrow: it sends bounded activity metadata such as a hashed `project_root` scope key, host and model names, timestamps, aggregate language stats, and file-delta counts. It does not send raw local paths, source contents, raw prompts, or raw transcripts by default.

## What You Get

- A single deployable FastAPI runtime under `apps/api` with the bundled dashboard from `apps/web`.
- Shared collection and delivery logic in `packages/collector-core`.
- Stable adapters for `Claude Code` and `Codex`.
- Experimental adapters for `Gemini CLI` and `OpenCode`.
- First-party compatibility artifacts, including `/contracts/dashboard-compat.v1.json`.

## Support Matrix

- First-class support today: `Claude Code`, `Codex`
- Experimental today: `Gemini CLI`, `OpenCode`
- Diagnostics you can use right away: `/healthz`, `/api/v1/status`, `doctor`, `pending`

## Quickstart

Requirements:

- `Node.js 22.12+`
- `npm 10+`
- `Python 3.12+`
- `uv`

1. Build the repo and install Python dependencies.

```bash
npm install
npm run build
uv sync --group dev
```

2. Start Clipulse with protected mode enabled.

```bash
export CLIPULSE_DATABASE_URL="sqlite+pysqlite:///$(pwd)/clipulse.sqlite3"
export CLIPULSE_STATE_DIR="/tmp/clipulse-state"
export CLIPULSE_DASHBOARD_TOKEN="replace-with-a-random-dashboard-token"
export CLIPULSE_API_BEARER_TOKEN="replace-with-a-random-api-token"
export CLIPULSE_SESSION_SECRET="replace-with-a-long-random-session-secret"
PYTHONPATH=apps/api uv run python -m clipulse_api.migrate upgrade "$CLIPULSE_DATABASE_URL"
PYTHONPATH=apps/api uv run uvicorn clipulse_api.app:create_app --factory --host 127.0.0.1 --port 8000
```

Use `CLIPULSE_ALLOW_INSECURE_NO_AUTH=1` only for local debugging when you explicitly want to skip dashboard auth.

3. Send one checked-in smoke fixture through the stable `Codex` adapter path.

```bash
export CLIPULSE_API_URL="http://127.0.0.1:8000"
export CLIPULSE_API_BEARER_TOKEN="$CLIPULSE_API_BEARER_TOKEN"
ROOT="$(pwd)"
sed "s|__CODEX_SMOKE_PROJECT_ROOT__|$ROOT|g" packages/adapter-codex/examples/smoke/session-start.json \
  | node packages/adapter-codex/dist/cli.js
```

4. Open `http://127.0.0.1:8000/`, sign in with `CLIPULSE_DASHBOARD_TOKEN`, and confirm the first session appears.

For deeper operator guidance and deployment variants, continue with `docs/self-hosting-and-integration.md`. Repo smoke lanes stay split on purpose: `npm run smoke:stable` covers the stable path, and `npm run smoke:experimental` adds the experimental host lane.

## Example Output

When `CLIPULSE_ENABLE_PUBLIC_READS=1` and `CLIPULSE_PUBLIC_BASE_URL` are set, `/api/v1/public/readme/top-language` returns a concrete README snippet you can paste into another project:

```json
{
  "markdown": "![Clipulse Top Language](https://clipulse.example/api/v1/badges/top-language.svg)"
}
```

The same public pattern also exists for `today-time` and `this-week-time`.

## Docs Map

- [Self-hosting and integration guide](./docs/self-hosting-and-integration.md): deployment modes, auth, reverse proxy, probes, and adapter wiring
- [Architecture overview](./docs/architecture.md): data flow, trust boundaries, and runtime surfaces
- [Release and packaging overview](./docs/release-and-packaging.md): source checkout vs built Python artifacts
- [Clipulse Python Package](./README.package.md): installing a built `sdist` or `wheel`
- [Contributing](./CONTRIBUTING.md): contribution expectations and public-doc routing
- [Support](./SUPPORT.md): public help paths and what to include in a request
- [Security policy](./SECURITY.md): private reporting path for vulnerabilities and privacy leaks
- [Changelog](./CHANGELOG.md): release-facing history

<details>
<summary>Adapter entry points and checked examples</summary>

- Stable adapter docs: [packages/adapter-claude/README.md](./packages/adapter-claude/README.md), [packages/adapter-codex/README.md](./packages/adapter-codex/README.md)
- Stable checked examples: [packages/adapter-claude/hooks/hooks.json](./packages/adapter-claude/hooks/hooks.json), [packages/adapter-codex/examples/hooks.json](./packages/adapter-codex/examples/hooks.json)
- Experimental adapter docs: [packages/adapter-gemini/README.md](./packages/adapter-gemini/README.md), [packages/adapter-opencode/README.md](./packages/adapter-opencode/README.md)
- Experimental checked examples: [packages/adapter-gemini/examples/.gemini/settings.json](./packages/adapter-gemini/examples/.gemini/settings.json), [packages/adapter-opencode/examples/clipulse.ts](./packages/adapter-opencode/examples/clipulse.ts)

</details>

<details>
<summary>Packaging and advanced operator notes</summary>

- Source checkout is still the shortest path for contributors and self-hosting operators.
- Built Python artifacts are covered in [docs/release-and-packaging.md](./docs/release-and-packaging.md) and [README.package.md](./README.package.md). They bundle the API runtime, dashboard assets, and `/contracts/*`.
- `npm run check:release:prep` is the stable release-ready preflight. `npm run check:release:prep:full` adds the experimental adapter lane.
- If you expose only the public read surface, publish `/api/v1/badges/*` and `/api/v1/public/readme/*`, then set `CLIPULSE_ENABLE_PUBLIC_READS=1` and `CLIPULSE_PUBLIC_BASE_URL`.
- Set `CLIPULSE_PUBLIC_PROBE_URL` only when the public outlet lives on a separate origin or proxy path and you want `npm run smoke:deployment` to probe it directly.
- Gemini baseline wiring starts from `packages/adapter-gemini/dist/cli.js` and the checked-in example lifecycle: `SessionStart`, `BeforeTool`, `AfterTool`, `BeforeAgent`, `AfterAgent`, `SessionEnd`.
- `BeforeAgent` and the compatibility alias `UserPromptSubmit` should not both stay wired in the same Gemini installation.
- `session.diff` stays opt-in for `OpenCode` behind `CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF=1`.

</details>

## Support And Security

- Use [SUPPORT.md](./SUPPORT.md) for public, non-sensitive questions and troubleshooting context.
- Use [SECURITY.md](./SECURITY.md) for vulnerabilities, privacy leaks, and every report that should stay private.
- Use the [issue chooser](https://github.com/Boulea7/Clipulse/issues/new/choose) for public bugs or docs gaps.
