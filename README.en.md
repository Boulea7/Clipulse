# Clipulse

[简体中文](./README.md) | [繁體中文](./README.zh-TW.md) | [日本語](./README.ja.md)

Clipulse is a lightweight activity tracker for coding-agent CLIs, with the current alpha+ focused on self-hosted, privacy-aware, terminal-first workflows around `Claude Code` and `Codex`.

It is not trying to clone the WakaTime API or become a heavy SaaS layer for agent workflows. The practical implementation goals are:
- run your own API, SQLite database, and dashboard
- collect session, project, language, model, host, and file-delta summaries through plugins and hooks
- generate README badges and lightweight reports without uploading source contents or raw prompt bodies

## Alpha+ Scope
- First-class support: `Claude Code`, `Codex`
- Tryable experimental support now: `Gemini CLI`, `OpenCode`
- First-class stable support later: `Gemini CLI`, `OpenCode`
- Deployment posture: self-hosting first
- Data boundary: upload normalized events and file-delta summaries, not source contents or raw prompts
- Product boundary: keep alpha+ single-user, local-first, and summary-oriented instead of adding auth, multitenancy, or remote code storage

## What Already Works
- Both `Claude Code` and `Codex` adapters build real `dist/cli.js` entrypoints
- The repository now also includes tryable experimental `Gemini CLI` hooks-first integration at `packages/adapter-gemini/dist/cli.js` and an `OpenCode` plugin/event-first bridge entrypoint at `packages/adapter-opencode/dist/plugin.js`; both are built and fixture/contract-tested, but they still fall short of the stability promise carried by `Claude Code` and `Codex`
- Events can be delivered directly with `CLIPULSE_API_URL`
- If the API is unavailable, batches are buffered in the local state directory and backlog is flushed before the current batch
- Batch ingest now returns lightweight per-event outcomes so adapters can retry only the still-retryable subset instead of replaying the whole batch forever
- Partial delivery outcomes are now matched by stable `event_id` before falling back to batch position, so unresolved results stay retryable instead of being misclassified; when the API has to generate a fallback `event_id`, it also canonicalizes equivalent UTC timestamp forms before hashing so the same event is not split by `Z` vs `+00:00`
- The `Claude Code` adapter incrementally parses only new transcript records using a local transcript cursor instead of rescanning the full transcript on every hook
- `Claude Code` also recovers when transcript state rewinds after compact/rotation, suppresses empty `PreToolUse` noise without dropping meaningful boundary hooks, ignores zero-line patches, and clears transcript state across transcript-path variants on `stop`, `stop_failure`, `session_end`, and `pre_compact`
- `Claude Code` keeps a project-level activity event for `UserPromptSubmit` even when no file edit is detected
- Both `Claude Code` and `Codex` try to enrich events with steadier local Git-derived `project_root`, `project_name`, and `git_branch` context
- FastAPI + SQLite already expose overview, timeseries, language/model/host breakdowns, `projects/top`, `sessions/recent`, `sessions/{session_id}`, `projects/{project_ref}`, `projects/{project_ref}/sessions`, and multiple badges / README snippets
- FastAPI now also exposes `GET /api/v1/status` for quick self-hosted API / DB / local spool checks, including queue counts, byte totals, and oldest backlog/quarantine age hints
- Recent session and project-session lists now aggregate by logical session, so a mid-session host/model switch no longer duplicates the same session into multiple rows
- Project detail now mirrors session detail with compact summary fields for changed files, changed languages, line changes, top language, and host-model mix
- The dashboard already shows overview, today/this-week totals, languages, models, hosts, top projects, recent sessions, a lightweight 7-day activity strip, and hash-driven session/project detail views with session branch context, breadcrumb navigation, heuristic guidance, and compact changed-file / changed-language / line-change summaries
- Dashboard detail views now prefer the dedicated detail endpoints instead of treating `projects/top` / `sessions/recent` as hard prerequisites, and the home detail view makes `/api/v1/status` load failures explicit
- `ready/processing` backlog is now constrained locally by age and total spool size; stale or oversized batches are moved into `spool/quarantine/` with sidecar metadata for troubleshooting
- Backlog sidecar metadata now also preserves `first_seen_at`, `attempt_count`, and `last_attempted_at` so `processing -> ready` recovery and local quarantine do not reset the same backlog batch into a fake “new” issue
- Local spool sidecars now also salvage still-valid lineage fields when metadata is only partially malformed, and orphan `.meta.json` bookkeeping files no longer make the current batch look blocked behind payload backlog
- `collector-core` now also ships a tiny local operator CLI, intentionally limited to the two read-only commands `node packages/collector-core/dist/cli.js doctor` / `pending`, for spool inspection, orphan-sidecar warnings, quarantine-reason troubleshooting, clearer processing-only / quarantine-only / orphan-only backlog hints, and retention guidance for `stale_backlog` / `spool_size_cap`
- The dashboard now keeps loading copy separate from failure copy during startup and deep-link transitions, keeps the project view sessions area explicitly project-scoped, keeps project detail visible when only the project sessions feed fails, normalizes unscoped session deep links back to a project-scoped hash after a successful detail lookup, and makes the home status copy call out oldest quarantine age plus payload-spool byte totals more explicitly
- Session and project detail now also explain that file fingerprints are privacy-safe identifiers rather than raw paths or source excerpts, and zero-delta session summaries can still be valid for prompt-only activity, read-only commands, or the first Codex snapshot baseline

## Alpha+ Implementation Goals
- Keep the core architecture centered on self-hosting, a local state directory, and a thin API instead of adding a queue service
- Tighten the Codex file-delta heuristic to reduce snapshot-diff noise and scanning scope
- Keep extending summary-first reports without turning the product into a BI suite
- Keep `Gemini CLI` hooks-first and `OpenCode` plugin/event-first scaffolds intentionally small until the host contracts stabilize

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

If the `CLIPULSE_STATE_DIR` path does not exist yet, these commands inspect it without creating the directory.

Minimal smoke flow:

```bash
curl -i http://127.0.0.1:8000/healthz
curl http://127.0.0.1:8000/api/v1/status
node packages/collector-core/dist/cli.js doctor
node packages/collector-core/dist/cli.js pending
```

- `/healthz` is liveness-only and should return `204`
- `/api/v1/status` is the troubleshooting surface; there is currently no separate readiness probe, and `/api/v1/status` should not be treated as a high-frequency load-balancer readiness check
- `doctor` / `pending` are read-only smoke checks and do not create a missing state directory

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
      <batch>.json
      <batch>.meta.json
    processing/
      <batch>.json
      <batch>.meta.json
    quarantine/
      <batch>.json
      <batch>.meta.json
```

What they are used for:
- `sessions/`: local timing state used to derive `active_ms` and `wait_ms`
- `snapshots/`: per-session project text snapshots used by the Codex fallback diff path
- `claude-transcripts/`: local Claude transcript cursor state
- `spool/`: buffered event batches; Clipulse flushes `ready/` backlog before sending the current batch
- Backlog batches are opportunistically deduplicated by stable `event_id` before resend to reduce noisy duplicates
- `spool/quarantine/` now keeps non-retryable or locally quarantined payloads together with same-name `.meta.json` explanation files, while retryable subsets stay in `ready/`
- Same-name `.meta.json` bookkeeping sidecars may appear in `ready/`, `processing/`, and `quarantine/` so local lineage survives recovery and quarantine paths
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
2. Use `packages/adapter-codex/examples/hooks.json` as the checked-in canonical wiring source; its recommended baseline covers the common success-path hooks: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, and `Stop`, and the same example also keeps `SessionEnd` wired as a cleanup / teardown boundary
3. If your host also exposes failure-path hooks such as `PostToolUseFailure` or `StopFailure`, wire them too; Clipulse can use them to finalize `wait_ms` more precisely
4. Point your command path at `packages/adapter-codex/dist/cli.js`
5. Set `CLIPULSE_API_URL` and optionally `CLIPULSE_STATE_DIR`
- Keep `UserPromptSubmit` wired if you want prompt-only turns to be recorded; zero-delta Codex events can still be normal for prompt-only activity, read-only commands, or the first snapshot baseline capture

### Gemini CLI / OpenCode
- `packages/adapter-gemini/dist/cli.js` now provides a tryable hooks-first entrypoint centered on the official `SessionStart`, `SessionEnd`, `BeforeTool`, `AfterTool`, `BeforeAgent`, and `AfterAgent` surfaces.
- `packages/adapter-gemini` reuses shared project-context and timing helpers, keeps `AfterAgent` separate from prompt submission, emits minimal file deltas only when official `write_file` / `replace` payloads include an explicit file path, and keeps `AfterModel` out of scope. `SessionEnd` remains a best-effort stop/cleanup fallback, not a guaranteed barrier. Compatibility-only aliases such as `AfterToolFailure` or `UserPromptSubmit` may still be accepted, but they are not the primary Gemini contract and do not imply file-delta equivalence with the official hook surface.
- `packages/adapter-gemini/examples/.gemini/settings.json` is now the checked-in canonical wiring example for the official Gemini hook surface, and the top-level docs intentionally reference it instead of maintaining a second JSON copy.
- `packages/adapter-opencode/dist/plugin.js` is still a thin bridge entrypoint rather than a full drop-in plugin module; the recommended tryable path is a local wrapper example such as `packages/adapter-opencode/examples/clipulse.ts` that forwards the current selected subset: `session.created` / `session.deleted` / `session.idle` / `session.error`, named `tool.execute.before` / `tool.execute.after` / `tool.execute.error`, and `file.edited`. That checked-in wrapper example is the canonical wiring source for the current OpenCode path.
- `packages/adapter-opencode` still treats explicit `file.edited` as the high-confidence delta source; when the host only provides a file path, Clipulse records a path-only delta and intentionally avoids transcript scraping, server APIs, and the broader message/TUI event stream.
- OpenCode also exposes `session.diff` upstream, but Clipulse does not consume it by default yet because it is cumulative and carries raw `before` / `after` text that would need privacy stripping plus dedupe policy. If you explicitly set `CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF=1`, the checked-in wrapper example can do wrapper-only post-turn backfill, but it strips that data down to `{ path, additions, deletions }`, drops paths already seen via `file.edited` in the same buffered phase, tolerates the current upstream shape aliases across `file` / `path` and `added` / `removed` vs `additions` / `deletions` before normalizing, and only falls back without `sessionID` when exactly one live session is currently tracked by the wrapper.
- Both adapters are in a “tryable but still experimental” phase: buildable, fixture/contract-tested, and documented well enough to attempt self-hosted wiring, but not yet a first-class stable integration on the same level as `Claude Code` and `Codex`.
- Promotion threshold: keep `Gemini CLI` / `OpenCode` experimental until the official lifecycle contract is stable, the default wiring path yields high-confidence file deltas, and the checked-in wiring example plus fixture/contract coverage can consistently cover success and failure cleanup paths.

## Project And Session Surface
The current API and dashboard already provide lightweight drill-down:
- `GET /api/v1/projects/top` returns project summaries plus `project_ref`
- `GET /api/v1/sessions/recent` returns recent session summaries plus `project_ref`
- `GET /api/v1/sessions/{session_id}` returns session metadata, active/wait totals, event count, language summary, file-delta summary, and compact summary fields such as changed files, changed languages, total line changes, and top language
- `GET /api/v1/projects/{project_ref}` returns the project-level detail payload
- `GET /api/v1/projects/{project_ref}/sessions` returns that project's session list without mixing in project-detail fields
- `GET /healthz` returns only `204 No Content` as a liveness probe
- `GET /api/v1/status` returns a schema-backed minimal `api` / `db` / `spool` status payload for self-hosted troubleshooting, including queue counts, bytes, and oldest backlog/quarantine age; counts and bytes cover payload `.json` files only

Detail views are still summary-first; they are not a full event timeline.

Compatibility note:
- `GET /api/v1/projects/{project_ref}/sessions` still keeps the default full list contract; project summary fields live on `GET /api/v1/projects/{project_ref}`
- All three list endpoints clamp `limit <= 0` to an empty `items` array
- When a `session_id` exists under multiple projects, `GET /api/v1/sessions/{session_id}` must include `?project_ref=...` or the API returns a machine-readable `409`
- Session rollups and lookups are effectively scoped by `(project_root, session_id)`, so project-scoped links are more stable than a bare `session_id`
- Project routes and session detail now keep one canonical `project_name` per `project_root` even if later events report a different name for the same project root
- Detail/list payloads now distinguish `host_model_primary` from explicit `last_*` host/model/branch fields, and expose `file_preview_truncated_count` when preview rows omit additional changed files
- `sessions/recent` and `projects/{project_ref}/sessions` still keep the full default `host_model_mix` array today for backward compatibility; first-party dashboard lists mainly use `host_model_primary` and `host_model_mix_count`, so any slimming should happen through an explicit compatibility migration rather than a silent default change
- `sessions/recent?compact=true` and `projects/{project_ref}/sessions?compact=true` are now the explicit opt-in slimming path for first-party list views; they omit `host_model_mix` but keep `host_model_primary` and `host_model_mix_count`
- The first-party dashboard now prefers `compact=true` and retries the default full path once when a mixed-version rollout returns a clearly incompatible list response; external callers should still explicitly request `compact=true` if they want the slimmed shape.

`file_preview` and `fingerprint` are part of the privacy boundary:
- `file_preview` shows change trends, not source contents
- `fingerprint` is a stable identifier, not a raw in-project file path

Probe roles:
- `GET /healthz` only tells you that the process answered and returns `204`
- `GET /api/v1/status` is the runtime status feed used for self-hosted troubleshooting
- There is currently no separate readiness probe; if the API still answers, inspect `/api/v1/status` instead of treating `/healthz` as proof that DB and spool state are ready

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

Example ambiguous session `409`:

```json
{
  "detail": {
    "code": "ambiguous_session",
    "message": "session_id matched multiple projects",
    "hint": "Retry with the matching project_ref from /api/v1/projects/top or /api/v1/sessions/recent."
  }
}
```

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
- If `CLIPULSE_STATE_DIR` does not exist yet, `GET /api/v1/status` returns zeroed spool counts instead of failing.
- If you prefer terminal-first troubleshooting, run `node packages/collector-core/dist/cli.js doctor` or `pending`; the local operator surface is intentionally limited to those two read-only commands, they do not create a missing state directory during inspection, and they now print an explicit “no local state directory yet” hint when local state has never been created. `doctor` also calls out quarantine-only, orphan-only, and retention-related backlog hints, and unknown commands explicitly fall back to `doctor`.
- If `/api/v1/status` looks fully zeroed while `CLIPULSE_STATE_DIR` does not exist yet, treat that as “no local state yet”, not proof that hooks already ran; if `/api/v1/status` and local `doctor` / `pending` disagree, trust local spool inspection first.
- In addition to `409 ambiguous_session`, a wrong project scope returns `404 project_not_found`, and an unknown session returns `404 session_not_found`.
- If Claude transcript state looks stale after compact or transcript rotation, make sure the latest adapter build is installed so cleanup runs across transcript-path variants; an empty `PreToolUse` can still open an implicit wait that is finalized only by a later closing event.

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
- `wait_ms` starts at `pre_tool_use` and is finalized when a matching `post_tool_use`, `post_tool_use_failure`, `stop`, `stop_failure`, or `session_end` closes the pending tool wait
- Claude transcript cursor state stays local under `CLIPULSE_STATE_DIR` and is never exposed as a remote asset
- The first Codex snapshot establishes a baseline and returns no file deltas
- Local snapshots only scan text files and ignore `.git`, `.clipulse-private`, `.venv`, `.worktrees`, `.pytest_cache`, `.ruff_cache`, `.mypy_cache`, `__pycache__`, `.next`, `coverage`, `dist`, `build`, and `node_modules`, plus common sensitive patterns such as `.env*`, `credentials*`, `*.pem`, and `*.key`; files larger than `256 KiB`, overly long text files, or binary-like files are skipped
- Codex file-delta counting is still a minimum viable heuristic: it narrows only when Bash is simple enough to safely reduce candidate paths, keeps thin support for simple `env` / `command` / `builtin` / `noglob` / `bash -lc` / `/bin/zsh -lc` wrappers plus common write commands such as `touch` / `cp` / `sed -i` / `tee`, but falls back to broader snapshots for low-confidence Bash such as pipes, redirection, subshells, semicolon chains, escaped-space paths, obvious read-only commands like `git diff`, `git show`, `sort`, `awk`, `cut`, or `uniq`, and broad-scope commands such as `.venv/bin/python -m ...`, `python -m ...`, `python3 -m ...`, `tar`, `unzip`, `rsync`, `sort -o`, in-place `perl -pi*`, `cmd /c`, `powershell -Command`, `pwsh -Command`, `sh.exe -c`, or recursive `cp -r` / `cp -R`; it is not a precise VCS diff
- Codex rename / move remains intentionally summarized as remove + add for both file-level and directory-level moves
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
- [ ] First-class Gemini CLI / OpenCode integration docs, examples, and fuller host contracts

## Development Notes
- Keep private research, upstream notes, and competitive analysis under `.clipulse-private/`
- Never commit `.clipulse-private/`
- Keep this README aligned to what is implemented today versus what alpha+ is explicitly targeting next
