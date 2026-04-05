# Clipulse

[简体中文](./README.md) | [繁體中文](./README.zh-TW.md) | [English](./README.en.md)

Clipulse は、`Claude Code`、`Codex`、`Gemini CLI`、`OpenCode` などの coding agent CLI 向けの軽量なアクティビティ追跡ツールです。

このプロジェクトは、agentic な CLI ワークフローのために作られています。
- アクティブなコーディング時間と待機時間を追跡する
- AI が生成したコードの追加 / 削除行数を追跡する
- 言語、モデル、OS、CLI/IDE 利用状況を集計する
- セルフホスト可能な dashboard と README バッジを提供する

## 現在の範囲
- 初期の正式対応：`Claude Code`、`Codex`
- 次の段階：`Gemini CLI`、`OpenCode`
- 配置方針：セルフホスト優先
- プライバシー既定：ソース本文と prompt 本文は送信しない

## クイックスタート
```bash
npm install
npm run build
uv sync --group dev
PYTHONPATH=apps/api uv run uvicorn clipulse_api.app:create_app --factory --reload
```

## 導入
- `Claude Code`: `packages/adapter-claude/.claude-plugin/plugin.json` と `packages/adapter-claude/hooks/hooks.json`
- `Codex`: `packages/adapter-codex/examples/hooks.json`
- `CLIPULSE_API_URL` で Clipulse API を指定
- `CLIPULSE_STATE_DIR` でローカル spool / session timing / snapshot の保存先を指定可能

## バッジ
```md
![Clipulse Top Language](https://your-domain.example/api/v1/badges/top-language.svg)
![Clipulse Today Time](https://your-domain.example/api/v1/badges/today-time.svg)
![Clipulse This Week Time](https://your-domain.example/api/v1/badges/this-week-time.svg)
```

## 現在の制限
- `active_ms` / `wait_ms` は hook 間隔ベースの近似値
- Claude のファイル差分は transcript patch を優先
- Codex は hook 情報が不足する場合にローカル snapshot diff を使う
