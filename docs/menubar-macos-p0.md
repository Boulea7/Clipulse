# macOS Menubar Companion P0

Clipulse now includes a first-party SwiftUI menu bar companion under
`apps/menubar-macos`. It is a local-only status surface for the existing
`/api/v1/menubar/*` contract.

## What It Shows

- Today Token total, estimated cost, active time, and wait time.
- Current session summary only when a recent non-terminal event can be treated
  as active; otherwise the popover shows an inactive recent-activity state.
- Provider summaries derived from local usage events, with quota/risk state
  reported as `unknown` until real provider polling is added.
- Active block, top risk, and alerts when the selected density has enough room.
- Pending and failed spool counts.
- Menubar preferences for minimal, standard, or detailed view density and
  refresh interval.
- Optional status item text for the today Token count, today cost, top risk
  percent, or alert count. The default remains icon-only to avoid crowding the
  macOS menu bar.
- Provider visibility and ordering from the local preferences API.
- Actions for refresh, opening the dashboard, and quitting the companion.

The companion does not read prompts, transcripts, source files, raw local paths,
environment dumps, provider credentials, or API tokens from disk. It only calls
the local Clipulse API. Model, project, source, provider, and host labels shown
in the popover are display-safe labels from the API; unsafe path-like or
credential-like values are dropped before they reach the menu bar payload.

## Build And Test

```bash
cd apps/menubar-macos
swift test
```

Run it from a source checkout:

```bash
cd apps/menubar-macos
CLIPULSE_MENUBAR_API_URL=http://127.0.0.1:8000 \
CLIPULSE_DASHBOARD_URL=http://127.0.0.1:8000 \
CLIPULSE_MENUBAR_TOKEN="$CLIPULSE_API_BEARER_TOKEN" \
swift run ClipulseMenuBar
```

For local insecure dashboard smoke, omit `CLIPULSE_MENUBAR_TOKEN` and start the
API with `CLIPULSE_ALLOW_INSECURE_NO_AUTH=1` on `127.0.0.1` only.

## API Contract

The companion uses:

- `GET /api/v1/menubar/summary`
- `GET /api/v1/menubar/preferences`
- `PUT /api/v1/menubar/preferences`
- `POST /api/v1/menubar/refresh`

When protected API auth is enabled, set `CLIPULSE_MENUBAR_TOKEN` to the same
local bearer token used by adapters. The token is sent as an Authorization
header and is never rendered in the menu.

The Swift companion refuses non-loopback `CLIPULSE_MENUBAR_API_URL` /
`CLIPULSE_API_URL` values by default so a bearer token cannot be sent to a
remote host by accident. Remote API testing requires the explicit opt-in:

```bash
CLIPULSE_MENUBAR_ALLOW_REMOTE_API=1
```

Use that only for a trusted endpoint you control.

## P0 Limitations

- It is a SwiftPM executable, not a signed `.app` bundle yet.
- It is menu-bar-only and intentionally uses accessory activation.
- It does not poll real provider APIs; provider rows come from local Clipulse
  usage summaries and quota/risk state stays `unknown`.
- Menubar preferences are stored in the local SQLite database through the
  private API. They stay local and survive API restarts.
- The current native surface is intentionally compact: minimal view shows only
  today's core metrics, current session, and top risk; standard adds the active
  block and Provider list; detailed adds alerts and spool health.
- The current preferences contract includes `statusDisplay`, `visibleProviders`,
  `providerOrder`, `thresholds`, and `theme`. The companion applies
  `statusDisplay`, `visibleProviders`, `providerOrder`, and `thresholds` locally;
  `theme` is persisted for the P1 native theme picker but is not applied to the
  SwiftUI surface yet.
- A shared generated menubar preferences contract for Swift, Python, and the
  dashboard is still P1 work; the P0 surfaces keep explicit tests on each side
  to reduce drift.
- Packaging, notarization, LaunchAgent startup, native theme application, and
  polished native settings are P1 work.

## Clean-Room Note

The onWatch macOS companion informed the product behavior: status item,
popover-like summary, refresh action, density preferences, and provider status
ordering. The Swift implementation here is written for Clipulse from scratch and
does not copy onWatch GPL-3.0 source, templates, icons, or text.
