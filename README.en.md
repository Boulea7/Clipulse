# Clipulse

[简体中文](./README.md) | [繁體中文](./README.zh-TW.md) | [日本語](./README.ja.md)

Clipulse is a lightweight activity tracker for coding-agent CLIs, with the current alpha+ focused on self-hosted, privacy-aware, terminal-first workflows around `Claude Code` and `Codex`.

It is not trying to clone the WakaTime API or become a heavy SaaS layer for agent workflows. The practical implementation goals are:
- run your own API, SQLite database, and dashboard
- collect session, project, language, model, host, and file-delta summaries through plugins and hooks
- generate README badges and lightweight reports without uploading source contents or raw prompt bodies

## Alpha+ Scope
- First-class support: `Claude Code`, `Codex`
- Planned next: `Gemini CLI`, `OpenCode`
- Deployment posture: self-hosting first
- Data boundary: upload normalized events and file-delta summaries, not source contents or raw prompts
- Product boundary: keep alpha+ single-user, local-first, and summary-oriented instead of adding auth, multitenancy, or remote code storage

## What Already Works
- Both `Claude Code` and `Codex` adapters build real `dist/cli.js` entrypoints
- Events can be delivered directly with `CLIPULSE_API_URL`
- If the API is unavailable, batches are buffered in the local state directory and backlog is flushed before the current batch
- Batch ingest now returns lightweight per-event outcomes so adapters can retry only the still-retryable subset instead of replaying the whole batch forever
- Partial delivery outcomes are now matched by stable `event_id` before falling back to batch position, so unresolved results stay retryable instead of being misclassified
- The `Claude Code` adapter incrementally parses only new transcript records using a local transcript cursor instead of rescanning the full transcript on every hook
- `Claude Code` also recovers when transcript state rewinds after compact/rotation, suppresses empty `PreToolUse` noise without dropping meaningful boundary hooks, ignores zero-line patches, and clears transcript state across transcript-path variants on `stop`, `session_end`, and `pre_compact`
- `Claude Code` keeps a project-level activity event for `UserPromptSubmit` even when no file edit is detected
- Both `Claude Code` and `Codex` try to enrich events with steadier local Git-derived `project_root`, `project_name`, and `git_branch` context
- FastAPI + SQLite already expose overview, timeseries, language/model/host breakdowns, `projects/top`, `sessions/recent`, `sessions/{session_id}`, `projects/{project_ref}`, `projects/{project_ref}/sessions`, and multiple badges / README snippets
- FastAPI now also exposes `GET /api/v1/status` for quick self-hosted API / DB / local spool checks, including queue counts, byte totals, and oldest backlog/quarantine age hints
- Recent session and project-session lists now aggregate by logical session, so a mid-session host/model switch no longer duplicates the same session into multiple rows
- Project detail now mirrors session detail with compact summary fields for changed files, changed languages, line changes, top language, and host-model mix
- The dashboard already shows overview, today/this-week totals, languages, models, hosts, top projects, recent sessions, a lightweight 7-day activity strip, and hash-driven session/project detail views with branch context, breadcrumb navigation, heuristic guidance, and compact changed-file / changed-language / line-change summaries
- Dashboard detail views now prefer the dedicated detail endpoints instead of treating `projects/top` / `sessions/recent` as hard prerequisites, and the home view makes `/api/v1/status` load failures explicit
- `ready/processing` backlog is now constrained locally by age and total spool size; stale or oversized batches are moved into `spool/quarantine/` with sidecar metadata for troubleshooting
- Backlog sidecar metadata now also preserves `first_seen_at`, `attempt_count`, and `last_attempted_at` so `processing -> ready` recovery and local quarantine do not reset the same backlog batch into a fake “new” issue
- Local spool sidecars now also salvage still-valid lineage fields when metadata is only partially malformed, and orphan `.meta.json` bookkeeping files no longer make the current batch look blocked behind payload backlog
- `collector-core` now also ships a tiny local operator CLI: `node packages/collector-core/dist/cli.js doctor` / `pending` for read-only spool inspection, orphan-sidecar warnings, quarantine-reason troubleshooting, and a clearer processing-only backlog hint
- The dashboard now keeps loading copy separate from failure copy during startup and deep-link transitions, keeps the project view sessions area explicitly project-scoped, keeps project detail visible when only the project sessions feed fails, and makes queue health mention oldest quarantine age when quarantine is non-empty
- Session and project detail now also explain that file fingerprints are privacy-safe identifiers rather than raw paths, and zero-delta session summaries can still be valid for prompt-only activity or the first Codex snapshot baseline

## Alpha+ Implementation Goals
- Keep the core architecture centered on self-hosting, a local state directory, and a thin API instead of adding a queue service
- Tighten the Codex file-delta heuristic to reduce snapshot-diff noise and scanning scope
- Keep extending summary-first reports without turning the product into a BI suite

## Quick Start
```bash
npm install
npm run build
uv sync --group dev
PYTHONPATH=apps/api uv run uvicorn clipulse_api.app:create_app --factory --reload
```

Then open `http://127.0.0.1:8000/`.

## Self-Hosting And Storage
The default database file is `clipulse.sqlite3` in the repository root.

For longer-running deployment notes, integration examples, payload samples, and troubleshooting, see [docs/self-hosting-and-integration.md](./docs/self-hosting-and-integration.md).

Common environment variables:
- `CLIPULSE_API_URL`, for example `http://127.0.0.1:8000`
- `CLIPULSE_STATE_DIR`, the local state directory; if unset, Clipulse falls back to `XDG_STATE_HOME/clipulse` or `~/.local/state/clipulse`

Start the API before wiring hooks:

```bash
PYTHONPATH=apps/api uv run uvicorn clipulse_api.app:create_app --factory --host 0.0.0.0 --port 8000
```

For local troubleshooting, you can also run:

```bash
node packages/collector-core/dist/cli.js doctor
node packages/collector-core/dist/cli.js pending
```

## Local State Directory Layout
Alpha+ currently maintains these paths under `CLIPULSE_STATE_DIR`:

```text
clipulse-state/
  sessions/
    <host>-<scoped-session-hash>.json
  snapshots/
    <host>-<scoped-session-hash>.json
  claude-transcripts/
    <session-scope>.json
  spool/
    tmp/
    ready/
    processing/
    quarantine/
```

What they are used for:
- `sessions/`: local timing state used to derive `active_ms` and `wait_ms`
- `snapshots/`: per-session project text snapshots used by the Codex fallback diff path
- `claude-transcripts/`: local Claude transcript cursor state
- `spool/`: buffered event batches; Clipulse flushes `ready/` backlog before sending the current batch
- Backlog batches are opportunistically deduplicated by stable `event_id` before resend to reduce noisy duplicates
- `spool/quarantine/` now keeps non-retryable or locally quarantined payloads together with same-name `.meta.json` explanation files, while retryable subsets stay in `ready/`
- `ready/` and `processing/` backlog now also have lightweight local age/size caps; local sidecar metadata carries `first_seen_at` / `attempt_count` / `last_attempted_at`, and quarantine sidecars can add fields such as `source_state` and `approx_bytes`
- If only part of a sidecar is malformed, Clipulse now salvages still-valid lineage fields instead of resetting the whole local backlog batch identity
- Hooks opportunistically prune old `tmp` / `quarantine` / `sessions` / `snapshots` state, and `stop` removes the current session's transient files

## Privacy Boundaries
- No source code contents are uploaded
- No raw prompt or transcript bodies are uploaded
- File-level upload is limited to normalized deltas and privacy-safe fingerprints instead of full paths or contents
- `snapshots/`, `sessions/`, and `spool/` stay on the local machine and are not uploaded as source material
- `.clipulse-private/` is reserved for local research and private notes and should not be committed

## Integration
### Claude Code
1. Run `npm run build`
2. Treat `packages/adapter-claude/.claude-plugin/` as the Claude plugin directory
3. Inside that plugin root, `plugin.json` points to `./hooks/hooks.json`
4. For local validation, load it as a plugin directory, for example `claude --plugin-dir /abs/path/to/packages/adapter-claude`
5. During packaging or installation, make sure the final `${CLAUDE_PLUGIN_ROOT}` also exposes `hooks/` and `dist/cli.js`; the repository keeps the manifest under `.claude-plugin/`, but the installed plugin root must contain the runtime files
6. Set environment variables:

```bash
export CLIPULSE_API_URL="http://127.0.0.1:8000"
export CLIPULSE_STATE_DIR="$HOME/.local/state/clipulse"
```

### Codex
1. Run `npm run build`
2. Use `packages/adapter-codex/examples/hooks.json` as the reference; the recommended hook set includes `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, and `Stop`
3. Point your command path at `packages/adapter-codex/dist/cli.js`
4. Set `CLIPULSE_API_URL` and optionally `CLIPULSE_STATE_DIR`

## Project And Session Surface
The current API and dashboard already provide lightweight drill-down:
- `GET /api/v1/projects/top` returns project summaries plus `project_ref`
- `GET /api/v1/sessions/recent` returns recent session summaries plus `project_ref`
- `GET /api/v1/sessions/{session_id}` returns session metadata, active/wait totals, event count, language summary, file-delta summary, and compact summary fields such as changed files, changed languages, total line changes, and top language
- `GET /api/v1/projects/{project_ref}` returns the project-level detail payload
- `GET /api/v1/projects/{project_ref}/sessions` returns only compact session list items for that project
- `GET /api/v1/status` returns a minimal `api` / `db` / `spool` status payload for self-hosted troubleshooting, including queue counts, bytes, and oldest backlog/quarantine age

Detail views are still summary-first; they are not a full event timeline.

Compatibility note:
- `GET /api/v1/projects/{project_ref}/sessions` is now compact-list-only; project summary fields live on `GET /api/v1/projects/{project_ref}`
- When a `session_id` exists under multiple projects, `GET /api/v1/sessions/{session_id}` must include `?project_ref=...` or the API returns a machine-readable `409`

`file_preview` and `fingerprint` are part of the privacy boundary:
- `file_preview` shows change trends, not source contents
- `fingerprint` is a stable identifier, not a raw in-project file path

Example batch payload:

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

## Troubleshooting
- Recent sessions should no longer split when only the host or model changes inside the same logical session. If you still see duplicates, confirm the events are not crossing different `project_root` values.
- If a Codex session shows no file deltas on the first snapshot-backed event, that is expected: the first capture establishes the local baseline.
- If direct delivery fails, inspect `CLIPULSE_STATE_DIR/spool/ready`. Clipulse will retry unresolved events first on the next hook run.
- If `spool/quarantine/` has files, inspect the matching `.meta.json` first. Quarantined payloads may be the non-retryable subset or backlog isolated by local age/size caps; retryable subsets stay in `ready/`.
- Common quarantine `reason` values now include `http_error`, `invalid_results`, `recovery_failed`, `invalid_spool_payload`, `stale_backlog`, and `spool_size_cap`; `stale_backlog` and `spool_size_cap` preserve the original backlog `first_seen_at` and `attempt_count`.
- If the dashboard points to API / DB / spool trouble, inspect `GET /api/v1/status` first to confirm local backlog counts, byte totals, and oldest backlog ages.
- If you prefer terminal-first troubleshooting, run `node packages/collector-core/dist/cli.js doctor` or `pending`; both commands are read-only and inspect the current `CLIPULSE_STATE_DIR`.
- If Claude transcript state looks stale after compact or transcript rotation, make sure the latest adapter build is installed so cleanup runs across transcript-path variants.

## Dashboard Walkthrough
- Start on the home view for overview totals, top projects, and recent sessions.
- Open a project to see project detail plus breadcrumb navigation.
- On the project view, the sessions card now switches to that project's compact session list instead of the global recent-session feed.
- Open a session to inspect host, model, branch, changed files, languages, and line changes.
- `active`, `wait`, `line changes`, and `host-model mix` are local summary heuristics for daily inspection, not a precise audit trail.

## Badges And README Snippets
Current badge endpoints:
- `GET /api/v1/badges/top-language.svg`
- `GET /api/v1/badges/today-time.svg`
- `GET /api/v1/badges/this-week-time.svg`

Direct README embeds:

```md
![Clipulse Top Language](https://your-domain.example/api/v1/badges/top-language.svg)
![Clipulse Today Time](https://your-domain.example/api/v1/badges/today-time.svg)
![Clipulse This Week Time](https://your-domain.example/api/v1/badges/this-week-time.svg)
```

Current public snippet endpoints:

```bash
curl https://your-domain.example/api/v1/public/readme/top-language
curl https://your-domain.example/api/v1/public/readme/today-time
curl https://your-domain.example/api/v1/public/readme/this-week-time
```

Response shape:

```json
{"markdown":"![Clipulse Top Language](https://your-domain.example/api/v1/badges/top-language.svg)"}
```

## Current Heuristics And Limits
- `active_ms` and `wait_ms` are hook-gap heuristics, not exact foreground activity time
- Non-wait `active_ms` is clamped to at most `15_000` ms per gap
- `wait_ms` is derived only from `pre_tool_use -> post_tool_use`
- Claude transcript cursor state stays local under `CLIPULSE_STATE_DIR` and is never exposed as a remote asset
- The first Codex snapshot establishes a baseline and returns no file deltas
- Local snapshots only scan text files and ignore `.git`, `.clipulse-private`, `.venv`, `.worktrees`, `.pytest_cache`, `.ruff_cache`, `.mypy_cache`, `coverage`, `dist`, `build`, and `node_modules`; files larger than `256 KiB`, overly long text files, or binary-like files are skipped
- Codex file-delta counting is still a minimum viable heuristic: it narrows to Bash command candidates when possible, keeps thin support for simple `env` / `command` / `builtin` / `noglob` / `bash -lc` wrappers plus common write commands such as `touch` / `cp` / `sed -i` / `tee`, but falls back to broader snapshots for low-confidence Bash such as pipes, redirection, subshells, semicolon chains, escaped-space paths, and obvious read-only commands like `git diff`; it is not a precise VCS diff
- Codex rename / move is intentionally summarized as remove-plus-add, not as a first-class rename event
- Session/project detail views are summary-first and do not expose a full event timeline
- There is still no auth layer, multi-user isolation, or remote code-content storage

## Roadmap
- [x] Unified event model and batch delivery
- [x] First-pass Claude Code plugin/hooks adapter
- [x] First-pass Codex hooks adapter
- [x] FastAPI ingest, overview, breakdown, and badge APIs
- [x] Top-project and recent-session summaries
- [x] Lightweight dashboard
- [x] Session/project detail drill-down
- [x] Local state pruning policy
- [ ] Finer time estimation and lower-overhead Codex file-delta tracking
- [ ] Gemini CLI and OpenCode adapters

## Development Notes
- Keep private research, upstream notes, and competitive analysis under `.clipulse-private/`
- Never commit `.clipulse-private/`
- Keep this README aligned to what is implemented today versus what alpha+ is explicitly targeting next
