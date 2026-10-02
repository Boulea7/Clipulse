# Usage Reports, PWA, And Menubar Contracts

This document covers the first P0 slice that extends Clipulse from activity tracking into local usage reports, safe PWA shell assets, and machine-friendly local summaries.

## Usage CLI

The Python package exposes a `clipulse` console script:

```bash
clipulse usage daily
clipulse usage weekly --compact
clipulse usage monthly --since 2026-05-01 --until 2026-05-20
clipulse usage session --json
clipulse usage blocks
clipulse usage statusline
clipulse sources status
```

Supported P0 flags:

- `--json`: emit a stable JSON report.
- `--compact`: prefer a narrow terminal table.
- `--since` / `--until`: bound the report by event time.
- `--project`: filter by the same hashed project scope that Clipulse stores.
- `--source`: filter by source label, such as `claude`, `codex`, `gemini`, or `opencode`.
- `--timezone`: applies date-only `since` / `until` boundaries and daily, weekly, monthly, and 5-hour block grouping with an IANA timezone such as `Asia/Singapore`.
- `--breakdown`: accepted as a forward-compatible flag; richer breakdowns are reserved for the next slice.

Invalid date, source, and timezone filters fail fast with a usage error instead
of broadening the report or silently falling back to another timezone.

The CLI reads `CLIPULSE_DATABASE_URL` by default. You can also pass `--database-url` before the `usage` command:

```bash
clipulse --database-url sqlite+pysqlite:///clipulse.sqlite3 usage daily --json
```

The JSON shape is designed for other tools:

```json
{
  "range": {
    "type": "daily",
    "since": "2026-05-01",
    "until": "2026-05-20",
    "timezone": "UTC"
  },
  "totals": {
    "inputTokens": 0,
    "outputTokens": 0,
    "cacheCreationTokens": 0,
    "cacheReadTokens": 0,
    "reasoningTokens": 0,
    "totalTokens": 0,
    "costUSD": 0,
    "activeSeconds": 0,
    "waitSeconds": 0,
    "sessions": 0
  },
  "rows": []
}
```

`clipulse usage statusline` emits a short private-safe summary, for example:

```text
Clipulse · 18.2k tok · $0.31 · 42m today
```

## Source diagnostics

`clipulse sources status` is a local diagnostics command inspired by the same
operator workflow as tools like tokscale `clients`: it checks whether common
local source directories for Claude Code, Codex, Gemini CLI and OpenCode exist
and reports only coarse file counts.

It does not parse prompt text, transcript text, source code, credentials, or
environment dumps. Default locations are shown as home-relative labels such as
`~/.claude/projects`; custom paths are redacted in both table and JSON output.

```bash
clipulse sources status
clipulse sources status --json
```

## Optional Token And Cost Fields

Clipulse keeps the existing event contract backward compatible. The following fields are optional on inbound events:

- `provider`
- `source`
- `input_tokens`
- `output_tokens`
- `cache_creation_tokens`
- `cache_read_tokens`
- `reasoning_tokens`
- `total_tokens`
- `cost_usd`

Events without these fields continue to contribute active time, wait time, session, project, language, model, and host metrics. New report totals treat missing token and cost values as unknown/zero for aggregation.

`provider` and `source` are public-safe labels, not arbitrary strings. Inbound
events reject path-like values, URLs, credential-like strings, and `key=value`
values for those fields. Existing stored records with unsafe labels are omitted
from report and menubar label output.

## Report APIs

P0 report endpoints live under `/api/v1`:

- `GET /api/v1/reports/daily`
- `GET /api/v1/reports/weekly`
- `GET /api/v1/reports/monthly`
- `GET /api/v1/reports/session`
- `GET /api/v1/reports/blocks`

Supported query parameters:

- `since`
- `until`
- `project`
- `source`
- `timezone`
- `breakdown`

Invalid date, source, and timezone filters return `400 invalid_report_filter`
instead of widening a private query or silently using a different timezone.

These routes are private in the default protected deployment. Public badge and README routes are unchanged and do not inherit the new token/cost fields by default.

`breakdown=true` is accepted and echoed in the report metadata as a
forward-compatible flag. P0 rows remain the same compact aggregate shape.

## Provider And Quota P0 Contract

P0 adds a private provider/quota shape without polling real provider APIs:

- `GET /api/v1/capabilities`
- `GET /api/v1/providers`
- `GET /api/v1/providers/{provider_id}/current`

The current implementation derives safe provider summaries from stored usage
events. Today token and cost totals are scoped only to records whose safe
provider/source/host labels resolve to exactly one known provider; conflicting
labels are excluded from provider buckets and the rows are marked as
`summarySource: "local-events"`. Real account
credentials, auth refresh, external quota polling, burn-rate projection, and
multi-account management remain P1/P2 work.

## Menubar Summary Contract

The local companion contract starts with:

- `GET /api/v1/menubar/summary`
- `GET /api/v1/menubar/preferences`
- `PUT /api/v1/menubar/preferences`
- `POST /api/v1/menubar/refresh`

`/api/v1/menubar/summary` returns a compact, versioned payload with:

- overall status
- today active/wait seconds, token total, cost, session count, and project count
- current session summary only when a recent non-terminal event can be treated
  as active; otherwise this section is inactive and display labels are empty
- active block placeholder
- top provider risk placeholder with `unknown` state in P0
- provider summaries from local events with `unknown` quota state
- spool pending/failed counts
- alerts

The payload is consumed by the SwiftUI companion in `apps/menubar-macos` and
remains compatible with future Tauri or Swift app bundles. It must not include
raw prompts, raw transcripts, source contents, raw local paths, environment
variables, provider credentials, or API tokens. Source, provider, model, host,
and project labels are display-safe labels; unsafe path-like or credential-like
values are omitted.

## macOS Menubar Companion

The P0 native companion lives in `apps/menubar-macos` and uses SwiftUI
`MenuBarExtra`. It shows a compact local summary in the macOS menu bar:

- today Token total, cost, active time, and wait time
- current session summary when a recent active event is inferable
- Provider rows derived from local usage events, with quota state shown as
  `unknown` until real polling is implemented
- pending and failed spool counts
- minimal, standard, and detailed view density preferences
- active block, top risk, alerts, and refresh interval controls
- optional menu bar status text for the today Token count, today cost, top risk
  percent, or alert count, with icon-only as the default
- Provider visibility and ordering from persisted local preferences
- native settings controls for Provider visibility/order and theme
- a remote API opt-in warning when token-bearing requests may leave loopback

Build and test it with:

```bash
cd apps/menubar-macos
swift test
```

Run it against a local source checkout:

```bash
cd apps/menubar-macos
CLIPULSE_MENUBAR_API_URL=http://127.0.0.1:8000 \
CLIPULSE_DASHBOARD_URL=http://127.0.0.1:8000 \
CLIPULSE_MENUBAR_TOKEN="$CLIPULSE_API_BEARER_TOKEN" \
swift run ClipulseMenuBar
```

The Swift companion only sends tokens to loopback API URLs by default. For
remote API testing, explicitly set `CLIPULSE_MENUBAR_ALLOW_REMOTE_API=1` and use
a trusted endpoint. Menubar preferences are stored in the local Clipulse SQLite
database through the private API and survive API restarts. The status item stays
icon-only unless the local `statusDisplay` preference opts into a short bounded
summary.

See [macOS Menubar Companion P0](./menubar-macos-p0.md) for the full local
setup, privacy boundary, and P1 packaging notes.

## PWA Shell

The dashboard now serves:

- `GET /manifest.webmanifest`
- `GET /sw.js`
- `GET /offline.html`

These shell files are intentionally safe to fetch without authentication because they do not contain usage data, dashboard sessions, tokens, or private API responses. The manifest uses standalone display mode and default Simplified Chinese shortcuts for Overview, Reports, Providers, and Settings. The service worker caches static shell assets only. It treats private and semi-private routes as network-only, including:

- `/api/v1/`
- `/dashboard-login`
- `/dashboard-logout`
- `/contracts/`
- `/docs`
- `/redoc`
- `/openapi.json`

This keeps private API responses, dashboard sessions, token-bearing requests, contracts, and API documentation out of the offline cache.

P0 registers the service worker from the dashboard bootstrap and has static
privacy tests for the service worker script. Browser-level installability and
standalone-window checks remain a release gate before externally calling the PWA
fully installable.

## Local Browser Smoke

Clipulse refuses to start without auth configuration. For normal protected
local use, start it with the split auth environment from the main README:

```bash
export CLIPULSE_DATABASE_URL="sqlite+pysqlite:///$(pwd)/clipulse.sqlite3"
export CLIPULSE_STATE_DIR="/tmp/clipulse-state"
export CLIPULSE_DASHBOARD_TOKEN="replace-with-a-random-dashboard-token"
export CLIPULSE_API_BEARER_TOKEN="replace-with-a-random-api-token"
export CLIPULSE_SESSION_SECRET="replace-with-a-long-random-session-secret"
PYTHONPATH=apps/api uv run clipulse-api --host 127.0.0.1 --port 8000
```

For a quick dashboard smoke on the same machine, you can explicitly opt into
loopback-only insecure mode:

```bash
CLIPULSE_ALLOW_INSECURE_NO_AUTH=1 \
PYTHONPATH=apps/api uv run clipulse-api --host 127.0.0.1 --port 8000
```

Do not use insecure mode on a non-loopback host. The server rejects insecure
mode when `--host` is not loopback.

## Attribution And License Notes

This work was informed by:

- onWatch, GPL-3.0: used only for clean-room product and architecture research. Clipulse does not copy onWatch code, templates, styles, icons, or text.
- ccusage, MIT: used as a reference for local usage reporting concepts and CLI ergonomics. P0 implementation is rewritten for Clipulse's FastAPI, SQLite, and privacy model.
- tokscale, MIT: used as a reference for local source diagnostics and broad
  client/parser coverage. Clipulse's source status command is rewritten for
  Clipulse and reports only coarse, privacy-safe local source metadata.

Keep future provider polling and dashboard work under the same rule: study behavior and data shapes, then implement in Clipulse's own code and naming.
