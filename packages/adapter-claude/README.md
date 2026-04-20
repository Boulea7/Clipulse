# Clipulse Claude Adapter

Minimal `Claude Code` hooks-first adapter for Clipulse alpha+.

## Status

- Support tier: stable
- Host: `Claude Code`
- Canonical checked-in wiring: `packages/adapter-claude/.claude-plugin/` and `packages/adapter-claude/hooks/hooks.json`
- Delivery modes: direct API delivery with `CLIPULSE_API_URL`, or stdout handoff when `CLIPULSE_API_URL` is unset

## Required environment

- `CLIPULSE_API_URL` for direct delivery
- `CLIPULSE_API_BEARER_TOKEN` when the target API is protected
- `CLIPULSE_STATE_DIR` if you want a stable local state/spool location instead of the default
- `CLIPULSE_REQUIRE_PROJECT_FILE=1` only when you want to suppress events from directories that do not contain `.clipulse-project`

## Canonical example

- Treat `packages/adapter-claude/.claude-plugin/` as the checked-in plugin manifest root, not `plugin.json` as a standalone file.
- `packages/adapter-claude/hooks/hooks.json` is the checked-in canonical wiring source of truth.

## Install

- Run `npm run build --workspace @clipulse/adapter-claude` from the repo root before wiring the adapter.
- For release assets outside this repo, either:
  - extract `clipulse-adapter-claude.tar.gz` and point Claude Code at the extracted `dist/cli.js`
  - or install `clipulse-collector-core-<version>.tgz` plus `clipulse-adapter-claude-<version>.tgz` together in your local integration project

Minimal local wiring environment:

```bash
export CLIPULSE_API_URL="http://127.0.0.1:8000"
export CLIPULSE_API_BEARER_TOKEN="replace-with-your-api-token"
export CLIPULSE_STATE_DIR="$HOME/.local/state/clipulse"
```

Optional explicit project override:

```text
# .clipulse-project
project_name=my-project-name
git_branch=feature/branch-name
# optional: scope=workspace
```

## Wire

Canonical wiring:
- Treat `packages/adapter-claude/.claude-plugin/` as the checked-in plugin manifest root, not `plugin.json` as a standalone file.
- `packages/adapter-claude/hooks/hooks.json` is the checked-in canonical wiring source of truth.
- Inside that plugin root, `.claude-plugin/plugin.json` points to `./hooks/hooks.json`.
- Replace `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js"` with your local built adapter path when wiring outside this repo.
- Make sure the final installed `${CLAUDE_PLUGIN_ROOT}` exposes both `hooks/` and `dist/cli.js`, and that `${CLAUDE_PLUGIN_ROOT}/dist/cli.js` is the built adapter entrypoint the hooks execute.
- Keep `UserPromptSubmit` wired if you want prompt-only turns to be retained instead of disappearing behind zero-delta activity.

Minimal repo-external wiring shape:

```bash
export CLIPULSE_API_URL="http://127.0.0.1:8000"
export CLIPULSE_API_BEARER_TOKEN="replace-with-your-api-token"
export CLIPULSE_STATE_DIR="$HOME/.local/state/clipulse"
node /absolute/path/to/adapter-claude/dist/cli.js
```

## Smoke check

- Run `node scripts/smoke-claude.mjs` from the repo root.
- The smoke flow uses the built `packages/adapter-claude/dist/cli.js` entrypoint plus checked-in fixtures.
- The checked-in `test/fixtures/smoke.transcript.jsonl` file is a synthetic transcript fixture, not a real user transcript.
- The stable smoke now exercises `SessionStart -> PreToolUse -> PostToolUse -> SessionEnd` and verifies transcript-state cleanup.

## Notes

Cleanup boundaries:
- `PostToolUseFailure` can still close a pending tool wait and emit the matching wait window.
- `Stop`, `StopFailure`, `SessionEnd`, and `PreCompact` are cleanup boundaries for transcript cursor state.
- `SubagentStop` is not a transcript-state cleanup boundary by itself.

Public file-delta boundary:
- the current public file-delta contract only includes transcript entries with a concrete `toolUseResult.filePath` plus patch-backed `structuredPatch` line changes that produce real `+` or `-` deltas
- prompt-only turns may still be retained as project-level activity with `file_deltas: []`
- path-only transcript entries, header-only patches, or any relative transcript-path interpretation are implementation details and are not promised as public delta-contract behavior

Current scope:
- incoming `cwd` is resolved to the nearest git-backed project root before state lookup and event normalization
- equivalent nested-cwd and repo-root inputs share the same transcript cursor state once that root is resolved
- worktree inputs keep local file filtering scoped to the active worktree, while event-level project identity resolves to the canonical shared git root when the worktree belongs to a common Git directory

- `scripts/smoke-claude.mjs` reads the checked-in `test/fixtures/smoke.stdin.json` plus `test/fixtures/smoke.transcript.jsonl`, validates the normalized stdout batch, and then prints that stdout
- those checked-in smoke inputs stay synthetic transcript fixtures for tests and docs, not production transcript examples
