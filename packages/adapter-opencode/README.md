# Clipulse OpenCode Adapter

Minimal `OpenCode` plugin/event-first adapter for Clipulse alpha+.

Current scope:
- normalize a small event-bus subset into Clipulse events
- reuse shared project context and timing helpers
- keep file-delta capture limited to explicit `file.edited` payloads
- act as a thin bridge entrypoint that can be called from a local OpenCode plugin wrapper

Current non-goals:
- transcript or log scraping
- server-side OpenCode integrations
- full message/TUI event ingestion
