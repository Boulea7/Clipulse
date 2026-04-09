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

Compatibility notes:
- compatibility aliases such as `AfterToolFailure` or `UserPromptSubmit` may still be accepted when present
- the documented primary surface is still the official Gemini hooks contract

Current non-goals:
- `AfterModel` chunk-level event handling
- transcript parsing
- shell command parsing
- server-side Gemini integrations
- broad or transcript-derived file delta capture
