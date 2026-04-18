# Clipulse Self-Hosting And Integration Guide

## Summary

- Use the top-level `README.md`, `README.en.md`, `README.zh-TW.md`, and `README.ja.md` for the public overview.
- Treat `npm run smoke:stable` as the stable repo smoke lane for `Claude Code` and `Codex`.
- Treat `npm run smoke:experimental` as the experimental repo smoke lane for `Gemini CLI` and `OpenCode`.
- Use `npm run smoke:self-hosted` as the stable checkout deployment smoke lane for a built self-hosted checkout.
- Use `npm run smoke:self-hosted:experimental` as the experimental checkout deployment smoke lane for a built self-hosted checkout.
- Use `npm run smoke:deployment` as the live-instance deployment probe for an already running Clipulse server.
- Keep the main dashboard/API private by default. Expose public badge and README routes through a separate public outlet, limited reverse proxy path, or dedicated instance.
- Keep package-specific host contracts in the package READMEs instead of duplicating every host detail here.
- Python release artifacts now bundle dashboard assets and compatibility contracts; source checkout remains the simplest contributor path, not the only deployable path.
- The default public transport contract uses hashed project scope keys plus bounded activity metadata; it does not send raw local paths, source contents, raw prompts, or raw transcripts by default.

## Supported Runtime Floor

- `Node.js 22.12+`
- `npm 10+`
- `Python 3.12+`
- `uv`

These are the currently documented floors because the beta CI lane runs Node 22 and Python 3.12.

For release hygiene, the Python backend is expected to pass both `npm run check:py-build` and `npm run check:py-install-smoke`. The second command verifies that installed release artifacts can serve the dashboard, contracts, and a live deployment probe without depending on a repo checkout.

## Smoke Terminology

Clipulse uses three separate verification terms on purpose:

- Repo smoke: `npm run smoke:stable` and `npm run smoke:experimental`
  - These are source-tree guardrails for contributors and CI.
  - They cover checked-in adapter fixtures plus the self-hosted launcher contracts that belong to this repository.
- Checkout deployment smoke: `npm run smoke:self-hosted` and `npm run smoke:self-hosted:experimental`
  - These are focused runtime checks for a built self-hosted checkout.
  - Use them after changing runtime wiring, root-path handling, local state carry-over, or checkout-level asset/launcher behavior.
  - They do not exercise the protected login flow. After auth, reverse-proxy, or public/private outlet changes, also run `npm run smoke:deployment` against a live protected instance.
- Running deployment probe: `npm run smoke:deployment`
  - This probes a Clipulse instance that is already running.
  - Set `CLIPULSE_BASE_URL`, and when applicable also `CLIPULSE_DASHBOARD_TOKEN`, `CLIPULSE_API_BEARER_TOKEN`, `CLIPULSE_PUBLIC_BASE_URL`, `CLIPULSE_PUBLIC_PROBE_URL`, and `CLIPULSE_EXPECT_PUBLIC_READS=1`.
- Diagnostics only: `curl /healthz`, `curl /api/v1/status`, `doctor`, and `pending`
  - These help explain failures.
  - They do not replace the smoke lanes or the running deployment probe.

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
export CLIPULSE_DASHBOARD_TOKEN="replace-with-a-long-random-dashboard-token"
export CLIPULSE_API_BEARER_TOKEN="replace-with-a-long-random-api-token"
export CLIPULSE_SESSION_SECRET="replace-with-a-long-random-session-secret"
PYTHONPATH=apps/api uv run python -m clipulse_api.migrate upgrade "$CLIPULSE_DATABASE_URL"
PYTHONPATH=apps/api uv run uvicorn clipulse_api.app:create_app \
  --factory \
  --host 127.0.0.1 \
  --port 8000
```

Behavior:

- Adapters must inherit both `CLIPULSE_API_URL` and `CLIPULSE_API_BEARER_TOKEN`
- Browsers do not receive the raw API bearer token
- When split auth secrets are configured, the dashboard root shows a one-time login page until the user enters `CLIPULSE_DASHBOARD_TOKEN`
- After successful login, the server sets a signed read-only dashboard session cookie using `CLIPULSE_SESSION_SECRET`
- If TLS terminates upstream and the app still sees `http`, set `CLIPULSE_FORCE_SECURE_SESSION_COOKIE=1` so the dashboard session cookie still ships with the `Secure` attribute.
- Write routes such as `/api/v1/events/batch` still require `Authorization: Bearer`
- `/docs`, `/redoc`, and `/openapi.json` are part of the protected surface in the default protected mode

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

Optional when the public outlet lives on a separate origin or proxy path:

```bash
export CLIPULSE_PUBLIC_PROBE_URL="https://public-probe.clipulse.example"
```

Important behavior:

- If `CLIPULSE_ENABLE_PUBLIC_READS` is not enabled, anonymous badge and README routes return `401`
- If `CLIPULSE_PUBLIC_BASE_URL` is missing, README snippet routes return `503`
- `CLIPULSE_PUBLIC_PROBE_URL` is optional and only affects `smoke:deployment`; use it when the public outlet lives on a separate origin
- Public badges expose installation-level rollups such as top language and today/this-week time. They are public data once you expose them.

## Reverse Proxy Subpath And root_path

If you mount Clipulse under a subpath such as `/clipulse` instead of `/`, propagate that prefix into the ASGI `root_path` or your platform's equivalent forwarded-prefix setting.

Current behavior:

- the dashboard shell normalizes `/clipulse` and `/clipulse/` into the same `<base href="/clipulse/">`
- the protected login page posts back to `/clipulse/dashboard-login`
- public README snippets normalize repeated slashes and keep badge URLs under the same prefix

Operational rule:

- if your proxy strips a prefix but does not set `root_path`, the dashboard shell can open while `/static/*`, `/contracts/*`, login posts, or public README badge links still point at `/`
- if you change both the public hostname and the path prefix, update `CLIPULSE_PUBLIC_BASE_URL` and then re-run deployment smoke plus the public README snippet checks

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
export CLIPULSE_DASHBOARD_TOKEN="replace-with-a-long-random-dashboard-token"
export CLIPULSE_API_BEARER_TOKEN="replace-with-a-long-random-api-token"
export CLIPULSE_SESSION_SECRET="replace-with-a-long-random-session-secret"
PYTHONPATH=apps/api uv run python -m clipulse_api.migrate upgrade "$CLIPULSE_DATABASE_URL"
PYTHONPATH=apps/api uv run uvicorn clipulse_api.app:create_app \
  --factory \
  --host 127.0.0.1 \
  --port 8000
```

5. In the adapter host process, export delivery variables before wiring hooks:

```bash
export CLIPULSE_API_URL="http://127.0.0.1:8000"
export CLIPULSE_API_BEARER_TOKEN="$CLIPULSE_API_BEARER_TOKEN"
```

6. Trigger one event from a stable host integration.

7. Open the dashboard and verify that the first session/project row appears.

Keep the SQLite file and `CLIPULSE_STATE_DIR` on server-local disk. Do not place either path inside the repo checkout.

If the server exits early with a migration error, stop and re-run the explicit `clipulse_api.migrate upgrade` step instead of retrying `uvicorn` directly.

## Minimal Delivery Proof

Use this when the dashboard is empty and you need to distinguish “server is alive” from “events are actually arriving”.

```bash
curl -X POST "http://127.0.0.1:8000/api/v1/events/batch" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CLIPULSE_API_BEARER_TOKEN" \
  -d '{"events":[{"host":"codex","host_version":"0.1.0","session_id":"manual-check","project_root":"f902f0cad961","project_name":"demo","git_branch":"main","event_name":"session_start","event_time":"2026-04-14T12:00:00Z","model_name":"gpt-5.4","os_name":"macos","editor_or_terminal":"terminal","active_ms":1000,"wait_ms":0,"privacy_mode":"hashed","language_stats":{},"file_deltas":[]}]}'
```

Use the normalized project scope key shape from `/contracts/events-batch.v1.json` for manual transport examples. The server still accepts legacy raw paths for backward compatibility, but that is no longer the preferred wire format.

If this works but your real host integration still produces an empty dashboard, the usual problem is that the hook/plugin process did not inherit `CLIPULSE_API_URL` or `CLIPULSE_API_BEARER_TOKEN`.

## Running Deployment Probe

Use this after the server is already up and you want one quick end-to-end probe of auth, dashboard shell, static assets, contracts, and optional public routes:

```bash
export CLIPULSE_BASE_URL="http://127.0.0.1:8000"
export CLIPULSE_DASHBOARD_TOKEN="$CLIPULSE_DASHBOARD_TOKEN"
export CLIPULSE_API_BEARER_TOKEN="$CLIPULSE_API_BEARER_TOKEN"
export CLIPULSE_PUBLIC_BASE_URL="http://127.0.0.1:8000"
export CLIPULSE_EXPECT_PUBLIC_READS=1
npm run smoke:deployment
```

Add `CLIPULSE_PUBLIC_PROBE_URL` only when your public badge/README outlet lives on a separate origin or proxy path:

```bash
export CLIPULSE_PUBLIC_PROBE_URL="https://public-probe.clipulse.example"
```

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
curl -H "Authorization: Bearer $CLIPULSE_API_BEARER_TOKEN" http://127.0.0.1:8000/api/v1/status
node packages/collector-core/dist/cli.js doctor
node packages/collector-core/dist/cli.js pending
```

- Expect `/healthz` to return `204`
- Expect `/api/v1/status` to summarize API, database, spool state, and dashboard compatibility metadata
- Use `doctor` for a short local summary and `pending` when you need to inspect queued payload files

## Upgrade And Migration Flow

Use the explicit migration CLI before starting a reused database:

```bash
PYTHONPATH=apps/api uv run python -m clipulse_api.migrate upgrade "$CLIPULSE_DATABASE_URL"
```

Use `migrate upgrade` as the explicit schema-prep step for reused databases. It now handles schema version state, project-root backfill, and runtime indexes before the API starts serving traffic.

Recommended upgrade flow:

1. Stop the Clipulse API process that owns the SQLite file.
2. Pause or drain local hook/plugin senders if you want a quiet handoff.
3. Back up the SQLite file referenced by `CLIPULSE_DATABASE_URL`.
4. Back up the full `CLIPULSE_STATE_DIR` if queued payloads, snapshots, or session timing state matter to you.
5. Deploy the new checkout or build output while preserving the same database and state paths.
6. Start exactly one API instance with the upgraded database and preserved state paths.
7. Run `npm run smoke:self-hosted` and, if you use experimental hosts, `npm run smoke:self-hosted:experimental`.
8. Re-check `/api/v1/status`, the dashboard root, and any public README snippet routes if hostname or root-path settings changed.

If you move to a new machine, copy the SQLite file and the state directory together. The database is the durable source of truth; the state directory only carries retry backlog, local snapshots, and timing helpers.

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

In the default protected mode:

- read-only dashboard/API routes can use a valid signed dashboard session cookie
- write routes under `/api/v1/*` still require `Authorization: Bearer $CLIPULSE_API_BEARER_TOKEN`
- The dashboard root shows a one-time login page until the token is provided
- The login page trades the token for a signed cookie; the browser never receives the raw API token as a reusable cookie value

This is intentionally different from adapter delivery:

- Browsers use the signed dashboard cookie after login
- Adapters use `CLIPULSE_API_BEARER_TOKEN`

## Token Rotation

1. Generate new random values for `CLIPULSE_DASHBOARD_TOKEN`, `CLIPULSE_API_BEARER_TOKEN`, and `CLIPULSE_SESSION_SECRET`
2. Update the server environment
3. Update `CLIPULSE_API_BEARER_TOKEN` for every adapter host
4. Restart the API process
5. Restart or reload host integrations so they inherit the new env
6. Revisit the protected dashboard and log in again to mint a new signed session cookie
7. Re-check badge/snippet behavior if you also changed `CLIPULSE_PUBLIC_BASE_URL` or public proxy rules

Compatibility note:

- `CLIPULSE_SERVER_TOKEN` still works as a legacy single-token fallback only when all three split secrets are unset.
- As soon as any of `CLIPULSE_DASHBOARD_TOKEN`, `CLIPULSE_API_BEARER_TOKEN`, or `CLIPULSE_SESSION_SECRET` is configured, Clipulse expects the full split-auth set and fails fast if any member is missing.

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
- Keep the state directory on server-local disk rather than inside the repository checkout or shared network storage
- Treat the spool as host-local retry state, not as a shared server queue that multiple API instances consume
- Back up the SQLite file; do not treat transient spool state as the long-term source of truth

Current retention defaults and caps:

- `CLIPULSE_STATE_RETENTION_DAYS=14` by default
- `CLIPULSE_STATE_MAX_FILES=200` by default for retained session, snapshot, and quarantine files
- `CLIPULSE_STATE_MAX_SPOOL_BYTES=67108864` by default for ready + processing backlog bytes (`64 MiB`)

Current pruning behavior:

- old files under `sessions/`, `snapshots/`, `spool/tmp/`, and `spool/quarantine/` are pruned by retention age
- stale backlog files in `spool/ready/` or `spool/processing/` are quarantined instead of silently dropped
- when the backlog byte cap is exceeded, the oldest payloads are moved into `spool/quarantine/` with `reason=spool_size_cap`

If you raise those caps, keep the state directory on a local disk with enough headroom and watch `/api/v1/status`, `doctor`, and `pending` for growing backlog.

## SQLite Single-Instance Boundary

The current self-hosted target is one writable Clipulse API process per SQLite file.

Supported:

- one API process behind a reverse proxy
- one API process plus multiple local or remote adapters that send HTTP batches into it

Not currently supported as a documented deployment shape:

- multiple API replicas writing to the same SQLite file
- shared-network SQLite storage with concurrent writers
- a clustered control plane around the same `clipulse.sqlite3`

If you need multiple concurrent API writers or a multi-node control plane, treat that as outside the current SQLite-based deployment boundary.

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

## Keep Deployment Secrets Local

Treat deployment state, tokens, `.env*`, SQLite databases, `CLIPULSE_STATE_DIR`, and other secret-bearing files as strictly local. For contributor-facing repo hygiene and the broader “never commit these files” list, see `CONTRIBUTING.md` and `SECURITY.md`.

## Release And Packaging

For release metadata checks, Python artifact builds, and the tag-based release preflight workflow, see `docs/release-and-packaging.md`.

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
