# Clipulse Gemini Adapter

Minimal `Gemini CLI` hooks-first adapter for Clipulse alpha+.
Tryable experimental adapter; not yet a first-class stable integration on the same level as `Claude Code` or `Codex`.

Current scope:
- normalize hook payloads into Clipulse events
- reuse shared project context and timing helpers
- cover official `SessionStart` / `SessionEnd`, `BeforeTool` / `AfterTool`, `BeforeAgent`, and `AfterAgent`
- treat `AfterAgent` as a distinct turn-complete signal instead of collapsing it into prompt submission
- emit minimal file deltas when official `write_file` / `replace` payloads include an explicit file path
- resolve relative Gemini file paths from the original hook `cwd` before scoping them to the resolved project root, including worktree-style project roots
- deliver batches directly or print them to stdout for local wiring
- keep `SessionEnd` as a best-effort stop/cleanup fallback that may finalize pending wait timing and clear local session state, not a guaranteed completion barrier

Official wiring:
- `examples/.gemini/settings.json` is the canonical checked-in wiring example and source for the official Gemini CLI hook surface
- prefer that checked-in example when wiring docs or local setup notes drift, instead of widening the documented hook surface here
- replace `/absolute/path/to/packages/adapter-gemini/dist/cli.js` with your local built adapter path before using it
- wire the official `BeforeAgent` / `AfterAgent` pair for the primary prompt-turn path; `BeforeAgent` and compatibility-only `UserPromptSubmit` should not both be wired for the same installation

Compatibility notes:
- the documented primary surface is still the official Gemini hooks contract
- the accepted hook-name allowlist is explicit: official `SessionStart`, `SessionEnd`, `BeforeTool`, `AfterTool`, `BeforeAgent`, `AfterAgent`, plus compatibility-only `AfterToolFailure` and `UserPromptSubmit`
- compatibility-only aliases stay limited to normalization / cleanup compatibility and do not widen the official wiring contract
- compatibility-only aliases do not imply file-delta equivalence with the official hook surface
- compatibility-only `UserPromptSubmit` exists for older environments that lack `BeforeAgent`; prefer `BeforeAgent` whenever the official hook is available
- if your environment emits `AfterToolFailure`, keep it wired because it can close failed-tool wait gaps earlier than `SessionEnd`
- undocumented hooks such as `AfterModel` / `BeforeModel` are ignored and do not produce sendable Clipulse events
- ignored hooks stay silent by default; set `CLIPULSE_GEMINI_DEBUG_HOOKS` if you want a local stderr diagnostic for unexpected hook names
- accepted values are `1` and `true`
- debug output stays limited to ignored non-allowlisted hook names; allowlisted official and compatibility hooks stay quiet
- minimal `file_deltas` stay limited to official `AfterTool` events whose `write_file` / `replace` payloads include an explicit `file_path`

Current non-goals:
- `AfterModel` chunk-level event handling
- transcript parsing
- shell command parsing
- server-side Gemini integrations
- broad or transcript-derived file delta capture
