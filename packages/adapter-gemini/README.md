# Clipulse Gemini Adapter

Minimal `Gemini CLI` hooks-first adapter for Clipulse alpha+.

Current scope:
- normalize hook payloads into Clipulse events
- reuse shared project context and timing helpers
- cover official `SessionStart` / `SessionEnd`, `BeforeTool` / `AfterTool`, `BeforeAgent`, and `AfterAgent`
- treat `AfterAgent` as a distinct turn-complete signal instead of collapsing it into prompt submission
- emit minimal file deltas when official `write_file` / `replace` payloads include an explicit file path
- deliver batches directly or print them to stdout for local wiring
- keep `SessionEnd` as best-effort cleanup only, not a guaranteed completion barrier

Official wiring:
- `examples/.gemini/settings.json` is the canonical checked-in wiring example for the official Gemini CLI hook surface
- replace `/absolute/path/to/packages/adapter-gemini/dist/cli.js` with your local built adapter path before using it

Compatibility notes:
- compatibility-only aliases such as `AfterToolFailure` or `UserPromptSubmit` may still be accepted when present
- the documented primary surface is still the official Gemini hooks contract
- compatibility-only aliases do not imply file-delta equivalence with the official hook surface
- minimal `file_deltas` stay limited to official `AfterTool` events whose `write_file` / `replace` payloads include an explicit `file_path`

Current non-goals:
- `AfterModel` chunk-level event handling
- transcript parsing
- shell command parsing
- server-side Gemini integrations
- broad or transcript-derived file delta capture
