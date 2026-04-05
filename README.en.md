# Clipulse

[简体中文](./README.md) | [繁體中文](./README.zh-TW.md) | [日本語](./README.ja.md)

Clipulse is a lightweight activity tracker for coding-agent CLIs such as `Claude Code`, `Codex`, `Gemini CLI`, and `OpenCode`.

It is built as an independent open-source project for agentic terminal workflows:
- track active coding time and waiting time
- track AI-generated lines added and removed
- aggregate language, model, OS, and host usage
- provide a self-hosted dashboard and README badges

## Current Scope
- First-class support: `Claude Code`, `Codex`
- Planned next: `Gemini CLI`, `OpenCode`
- Deployment: self-hosted first
- Privacy default: no source contents and no raw prompt bodies uploaded

## Principles
- keep it simple
- prefer plugins and hooks
- normalize everything into one event model
- stay local-first and self-host-friendly

## Status
This repository is being built from scratch. The current implementation order is:
1. shared collector core
2. FastAPI + SQLite backend
3. lightweight dashboard
4. Claude Code and Codex adapters

## Quick Start
```bash
npm install
uv sync --group dev
PYTHONPATH=apps/api uv run uvicorn clipulse_api.app:create_app --factory --reload
```

Then open `http://127.0.0.1:8000/`.

## Integration
- `Claude Code`: see `packages/adapter-claude/.claude-plugin/plugin.json` and `packages/adapter-claude/hooks/hooks.json`
- `Codex`: see `packages/adapter-codex/examples/hooks.json`
- set `CLIPULSE_API_URL` to your Clipulse API base URL

## README Badge
```md
![Clipulse Top Language](https://your-domain.example/api/v1/badges/top-language.svg)
```

You can also fetch a generated markdown snippet from:

```bash
curl https://your-domain.example/api/v1/public/readme/top-language
```
