# Clipulse

[简体中文](./README.md) | [English](./README.en.md) | [日本語](./README.ja.md)

Clipulse 是一個面向 `Claude Code`、`Codex`、`Gemini CLI`、`OpenCode` 等 coding agent CLI 的輕量活動追蹤工具。

它專注於 agentic CLI 工作流：
- 統計活躍編碼時間與等待時間
- 統計 AI 生成程式碼的新增 / 刪減行數
- 聚合語言、模型、作業系統、CLI/IDE 使用分布
- 提供自託管 dashboard 與 README 徽章

## 當前範圍
- 首批正式支援：`Claude Code`、`Codex`
- 下一階段：`Gemini CLI`、`OpenCode`
- 部署方式：自託管優先
- 隱私預設：不上傳原始碼正文、不上傳 prompt 正文

## 快速啟動
```bash
npm install
npm run build
uv sync --group dev
PYTHONPATH=apps/api uv run uvicorn clipulse_api.app:create_app --factory --reload
```

## 接入與狀態目錄
- `Claude Code`：參考 `packages/adapter-claude/.claude-plugin/plugin.json` 與 `packages/adapter-claude/hooks/hooks.json`
- `Codex`：參考 `packages/adapter-codex/examples/hooks.json`
- `CLIPULSE_API_URL` 指向你的 Clipulse API
- `CLIPULSE_STATE_DIR` 可指定本機 spool、session timing 與 snapshot 目錄

## 徽章
```md
![Clipulse Top Language](https://your-domain.example/api/v1/badges/top-language.svg)
![Clipulse Today Time](https://your-domain.example/api/v1/badges/today-time.svg)
![Clipulse This Week Time](https://your-domain.example/api/v1/badges/this-week-time.svg)
```

## 當前限制
- `active_ms` / `wait_ms` 仍是基於 hook 間隔的近似值
- Claude 檔案改動優先使用 transcript patch
- Codex 在 hook 資訊不足時會回退到本機 snapshot diff
