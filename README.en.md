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
- FastAPI + SQLite already expose overview, timeseries, language/model/host breakdowns, `projects/top`, `sessions/recent`, `sessions/{session_id}`, `projects/{project_ref}/sessions`, and multiple badges / README snippets
- The dashboard already shows overview, today/this-week totals, languages, models, hosts, top projects, recent sessions, a lightweight 7-day activity strip, and hash-driven session/project detail views

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

Common environment variables:
- `CLIPULSE_API_URL`, for example `http://127.0.0.1:8000`
- `CLIPULSE_STATE_DIR`, the local state directory; if unset, Clipulse falls back to `XDG_STATE_HOME/clipulse` or `~/.local/state/clipulse`

Start the API before wiring hooks:

```bash
PYTHONPATH=apps/api uv run uvicorn clipulse_api.app:create_app --factory --host 0.0.0.0 --port 8000
```

## Local State Directory Layout
Alpha+ currently maintains these paths under `CLIPULSE_STATE_DIR`:

```text
clipulse-state/
  sessions/
    <host>-<scoped-session-hash>.json
  snapshots/
    <host>-<scoped-session-hash>.json
  spool/
    tmp/
    ready/
    processing/
    quarantine/
```

What they are used for:
- `sessions/`: local timing state used to derive `active_ms` and `wait_ms`
- `snapshots/`: per-session project text snapshots used by the Codex fallback diff path
- `spool/`: buffered event batches; Clipulse flushes `ready/` backlog before sending the current batch
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
5. During packaging or installation, make sure `${CLAUDE_PLUGIN_ROOT}/dist/cli.js` exists; the built `dist/cli.js` must live under the final plugin root
6. Set environment variables:

```bash
export CLIPULSE_API_URL="http://127.0.0.1:8000"
export CLIPULSE_STATE_DIR="$HOME/.local/state/clipulse"
```

### Codex
1. Run `npm run build`
2. Use `packages/adapter-codex/examples/hooks.json` as the reference
3. Point your command path at `packages/adapter-codex/dist/cli.js`
4. Set `CLIPULSE_API_URL` and optionally `CLIPULSE_STATE_DIR`

## Project And Session Surface
The current API and dashboard already provide lightweight drill-down:
- `GET /api/v1/projects/top` returns project summaries plus `project_ref`
- `GET /api/v1/sessions/recent` returns recent session summaries plus `project_ref`
- `GET /api/v1/sessions/{session_id}` returns session metadata, active/wait totals, event count, language summary, and file-delta summary
- `GET /api/v1/projects/{project_ref}/sessions` returns recent sessions and rollups for a project

Detail views are still summary-first; they are not a full event timeline.

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
- The first Codex snapshot establishes a baseline and returns no file deltas
- Local snapshots only scan text files and ignore `.git`, `.clipulse-private`, `.venv`, `.worktrees`, `.pytest_cache`, `.ruff_cache`, `.mypy_cache`, `coverage`, `dist`, `build`, and `node_modules`; files larger than `256 KiB`, overly long text files, or binary-like files are skipped
- Codex file-delta counting is still a minimum viable heuristic: it narrows to Bash command candidates when possible, but it is not a precise VCS diff
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
