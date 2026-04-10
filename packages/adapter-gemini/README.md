# Clipulse Gemini Adapter

Minimal `Gemini CLI` hooks-first adapter for Clipulse alpha+.
Tryable experimental adapter; not yet a first-class stable integration on the same level as `Claude Code` or `Codex`.

Current scope:
- normalize hook payloads into Clipulse events
- reuse shared project context and timing helpers
- cover official `SessionStart` / `SessionEnd`, `BeforeTool` / `AfterTool`, `BeforeAgent`, and `AfterAgent`
- treat `AfterAgent` as a distinct turn-complete signal instead of collapsing it into prompt submission
- emit minimal file deltas when official `write_file` / `replace` payloads include an explicit file path
- deliver batches directly or print them to stdout for local wiring
- keep `SessionEnd` as a best-effort stop/cleanup fallback that may finalize pending wait timing and clear local session state, not a guaranteed completion barrier

Official wiring:
- `examples/.gemini/settings.json` is the canonical checked-in wiring example and source for the official Gemini CLI hook surface
- prefer that checked-in example when wiring docs or local setup notes drift, instead of widening the documented hook surface here
- replace `/absolute/path/to/packages/adapter-gemini/dist/cli.js` with your local built adapter path before using it

Compatibility notes:
- only the documented compatibility-only aliases such as `AfterToolFailure` or `UserPromptSubmit` may still be accepted when present
- the documented primary surface is still the official Gemini hooks contract
- compatibility-only aliases stay limited to normalization / cleanup compatibility and do not widen the official wiring contract
- only the aliases documented here are part of the supported compatibility contract
- compatibility-only aliases do not imply file-delta equivalence with the official hook surface
- if your environment emits `AfterToolFailure`, keep it wired because it can close failed-tool wait gaps earlier than `SessionEnd`
- minimal `file_deltas` stay limited to official `AfterTool` events whose `write_file` / `replace` payloads include an explicit `file_path`

Current non-goals:
- `AfterModel` chunk-level event handling
- transcript parsing
- shell command parsing
- server-side Gemini integrations
- broad or transcript-derived file delta capture
