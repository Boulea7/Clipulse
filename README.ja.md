# Clipulse

[简体中文](./README.md) | [繁體中文](./README.zh-TW.md) | [English](./README.en.md)

Clipulse は coding-agent CLI 向けのセルフホスト型アクティビティトラッカーです。ローカルの hooks / plugin イベントを、ソースコード本文や raw prompt を送らない前提で、軽量なダッシュボード、要約レポート、埋め込み用 badge にまとめます。

## できること

- 自分で管理する API、SQLite、dashboard
- session、project、language、model、host、行変更サマリー
- `Claude Code` と `Codex` の安定サポート
- `Gemini CLI` と `OpenCode` の試験的サポート
- 私用 dashboard 全体ではなく、公開用 badge / README snippet の切り出し

## サポート状況

- 現在の一級対応: `Claude Code`, `Codex`
- 現在の experimental 対応: `Gemini CLI`, `OpenCode`
- 配置方針: self-hosting first
- 製品範囲: beta-ready な単一ユーザー向け集計。マルチテナント分析基盤ではありません

## 実行要件

- `Node.js 22+`
- `npm 10+`
- `Python 3.12+`
- `uv`
- いまはソース checkout + ローカル build 前提です

## 5 分で最初のイベントを確認する

1. 依存関係を入れて build します。

```bash
npm install
npm run build
uv sync --group dev
```

2. API を起動します。

```bash
export CLIPULSE_DATABASE_URL="sqlite+pysqlite:///$(pwd)/clipulse.sqlite3"
export CLIPULSE_STATE_DIR="/tmp/clipulse-state"
PYTHONPATH=apps/api uv run uvicorn clipulse_api.app:create_app --factory --host 127.0.0.1 --port 8000
```

3. 別ターミナルで安定 adapter を API に向け、実際の hook イベントを 1 件送ります。

```bash
export CLIPULSE_API_URL="http://127.0.0.1:8000"
ROOT="$(pwd)"
sed "s|__CODEX_SMOKE_PROJECT_ROOT__|$ROOT|g" packages/adapter-codex/examples/smoke/session-start.json \
  | node packages/adapter-codex/dist/cli.js
```

4. `http://127.0.0.1:8000/` を開きます。

- `CLIPULSE_SERVER_TOKEN` を設定していなければ、そのまま dashboard が開きます。
- `CLIPULSE_SERVER_TOKEN` を設定している場合は、一度だけログイン画面が表示されます。同じ token を入力すると、ブラウザには生の API token ではなく署名付き session cookie だけが保存されます。
- smoke イベントが入れば、空画面ではなく少なくとも 1 件の session / project 行が見えるはずです。

## 主要な環境変数

- `CLIPULSE_API_URL`: adapter がイベントを送る API のベース URL
- `CLIPULSE_API_BEARER_TOKEN`: API を保護している場合に adapter が使う bearer token
- `CLIPULSE_DATABASE_URL`: API 用 SQLite パス
- `CLIPULSE_STATE_DIR`: ローカル spool、snapshot、session timing の保存先
- `CLIPULSE_SERVER_TOKEN`: 私用 dashboard と `/api/v1/*` を保護する token
- `CLIPULSE_ENABLE_PUBLIC_READS=1`: badge / README snippet の匿名公開を明示的に許可
- `CLIPULSE_PUBLIC_BASE_URL`: 保護された配置で公開 README snippet を生成するときに必須

## 配置モード

### 私用 dashboard + 私用 API

完全な dashboard と `/api/v1/*` を非公開のまま使う構成です。

```bash
export CLIPULSE_SERVER_TOKEN="replace-with-a-long-random-token"
export CLIPULSE_API_BEARER_TOKEN="$CLIPULSE_SERVER_TOKEN"
```

- adapter プロセスは `CLIPULSE_API_URL` と `CLIPULSE_API_BEARER_TOKEN` の両方を継承する必要があります。
- ブラウザに生の API token は渡りません。保護された dashboard は一度のログイン後にサーバー署名 cookie を使います。

### 公開 badge / README snippet

推奨構成は、メインの dashboard/API を非公開のまま維持し、badge/snippet だけを別の公開出口、reverse proxy の限定パス、または別インスタンスで出すことです。

- 公開に必要なのは `/api/v1/badges/*` と `/api/v1/public/readme/*` だけです
- メインインスタンスの `/`、`/api/v1/*`、`/static/*`、`/contracts/*` は原則として非公開のままにしてください
- 公開 snippet では少なくとも次を設定します

```bash
export CLIPULSE_ENABLE_PUBLIC_READS="1"
export CLIPULSE_PUBLIC_BASE_URL="https://clipulse.example"
```

- 保護された配置で `CLIPULSE_PUBLIC_BASE_URL` が無いと README snippet は `503` を返します
- `CLIPULSE_ENABLE_PUBLIC_READS` が無いと匿名 badge / snippet は `401` になります

## 運用クイックチェック

まず安定レーンを実行します。

```bash
npm run smoke:stable
npm run smoke:experimental
```

次のコマンドは診断用です。smoke の代わりにはしません。

```bash
curl -i http://127.0.0.1:8000/healthz
curl http://127.0.0.1:8000/api/v1/status
node packages/collector-core/dist/cli.js doctor
node packages/collector-core/dist/cli.js pending
```

dashboard が空のままなら、ingest が通っているか確認するために最小の POST を試せます。

```bash
curl -X POST "http://127.0.0.1:8000/api/v1/events/batch" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CLIPULSE_SERVER_TOKEN" \
  -d '{"events":[{"host":"codex","host_version":"0.1.0","session_id":"manual-check","project_root":"/tmp/demo","project_name":"demo","git_branch":"main","event_name":"session_start","event_time":"2026-04-14T12:00:00Z","model_name":"gpt-5.4","os_name":"macos","editor_or_terminal":"terminal","active_ms":1000,"wait_ms":0,"privacy_mode":"hashed","language_stats":{},"file_deltas":[]}]}'
```

## Adapter 配線

最初の失敗原因で多いのは、hook / plugin 自体ではなく、そのプロセスに配信用環境変数が渡っていないことです。Clipulse adapter が API に送るには、ホストプロセスが次を継承している必要があります。

- `CLIPULSE_API_URL`
- 保護された配置なら `CLIPULSE_API_BEARER_TOKEN`

安定 integration:

- [Claude adapter README](./packages/adapter-claude/README.md)
- [Claude canonical hooks](./packages/adapter-claude/hooks/hooks.json)
- [Codex adapter README](./packages/adapter-codex/README.md)
- [Codex canonical hooks](./packages/adapter-codex/examples/hooks.json)

experimental integration:

- `packages/adapter-gemini/dist/cli.js` は `SessionStart`、`BeforeTool`、`AfterTool`、`BeforeAgent`、`AfterAgent`、`SessionEnd` を中心にした試用向け hooks-first 入口です
- [Gemini adapter README](./packages/adapter-gemini/README.md)
- [Gemini settings example](./packages/adapter-gemini/examples/.gemini/settings.json)
- [OpenCode adapter README](./packages/adapter-opencode/README.md)
- [OpenCode wrapper example](./packages/adapter-opencode/examples/clipulse.ts)

Gemini の guardrail:

- `BeforeAgent` と互換 alias `UserPromptSubmit` を同じ導入で同時に配線しないでください

OpenCode の guardrail:

- `session.diff` は `CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF=1` で明示的に opt-in します

## プライバシーとセキュリティ

- ソースコード本文はアップロードしません
- raw prompt / transcript 本文はアップロードしません
- 公開 badge はインストール全体の集計を出します。単一 project の秘密ビューではないので、公開前にその境界を理解してください
- `.clipulse-private/`、SQLite、`CLIPULSE_STATE_DIR`、`.env*`、`credentials*`、`*.pem`、`*.key`、`*.p12`、`*.pfx` は GitHub に置かないでください

詳しい安全・運用情報:

- [Security policy](./SECURITY.md)
- [Self-hosting and integration guide](./docs/self-hosting-and-integration.md)
- [Support](./SUPPORT.md)

## コミュニティ

- [Contributing](./CONTRIBUTING.md) `[English]`
- [Code of Conduct](./CODE_OF_CONDUCT.md) `[English]`
- [Security policy](./SECURITY.md) `[English]`
- [Support](./SUPPORT.md) `[English]`
- [Changelog](./CHANGELOG.md)
- [Issue templates](https://github.com/Boulea7/Clipulse/issues/new/choose)

## さらに読む

- [Self-hosting and integration guide](./docs/self-hosting-and-integration.md)
- `/contracts/dashboard-compat.v1.json`
- [Claude adapter README](./packages/adapter-claude/README.md)
- [Codex adapter README](./packages/adapter-codex/README.md)
- [Gemini adapter README](./packages/adapter-gemini/README.md)
- [OpenCode adapter README](./packages/adapter-opencode/README.md)
