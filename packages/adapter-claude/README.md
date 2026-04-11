# Clipulse Claude Adapter

Minimal `Claude Code` hooks-first adapter for Clipulse alpha+.

Canonical wiring:
- Treat `packages/adapter-claude/.claude-plugin/` as the checked-in plugin manifest root, not `plugin.json` as a standalone file.
- `packages/adapter-claude/hooks/hooks.json` is the checked-in canonical wiring source of truth.
- Inside that plugin root, `.claude-plugin/plugin.json` points to `./hooks/hooks.json`.
- Replace `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js"` with your local built adapter path when wiring outside this repo.
- Make sure the final installed `${CLAUDE_PLUGIN_ROOT}` exposes both `hooks/` and `dist/cli.js`.
- Keep `UserPromptSubmit` wired if you want prompt-only turns to be retained instead of disappearing behind zero-delta activity.

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
- worktree inputs stay scoped to the resolved worktree root rather than a shared common Git directory
