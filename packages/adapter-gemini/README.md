# Clipulse Gemini Adapter

Minimal `Gemini CLI` hooks-first adapter for Clipulse alpha+.

Current scope:
- normalize hook payloads into Clipulse events
- reuse shared project context and timing helpers
- cover `SessionStart` / `SessionEnd`, tool wait, agent boundaries, and prompt-only activity
- deliver batches directly or print them to stdout for local wiring

Current non-goals:
- transcript parsing
- shell command parsing
- server-side Gemini integrations
- high-confidence file delta capture
