# Clipulse

[简体中文](./README.md) | [繁體中文](./README.zh-TW.md) | [English](./README.en.md)

[![Beta Checks](https://github.com/Boulea7/Clipulse/actions/workflows/beta-checks.yml/badge.svg)](https://github.com/Boulea7/Clipulse/actions/workflows/beta-checks.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-0f766e.svg)](./LICENSE)
[![Python 3.12+](https://img.shields.io/badge/python-3.12%2B-1d4ed8.svg)](./pyproject.toml)
[![Node 22+](https://img.shields.io/badge/node-22%2B-111827.svg)](./package.json)

Clipulse は coding-agent CLI 向けのセルフホスト型アクティビティトラッカーです。ローカル hooks / plugin イベントを、プライバシーに配慮した集計、軽量 dashboard、README に埋め込める badge にまとめます。ソース本文や raw prompt は既定で送信しません。

## Clipulse を使う理由

- API、SQLite、dashboard を自分で管理できます。
- active time、wait time、file delta、言語、モデル、host mix を追跡できます。
- `Claude Code` と `Codex` を安定パスとして扱います。
- `Gemini CLI` と `OpenCode` は、より狭い実験アダプタとして試せます。
- 公開面が必要でも、badge / README snippet だけを公開し、私用 dashboard 全体は公開しません。

## 現在の状態

- 現在の一級対応: `Claude Code`, `Codex`
- 現在の実験対応: `Gemini CLI`, `OpenCode`
- Deployment style: self-hosted、single-user、SQLite
- 現在の writable 境界: 1 つの SQLite ファイルに対して 1 つの Clipulse API プロセス
- 診断コマンド: `/healthz`、`/api/v1/status`、`doctor`、`pending`

## Quickstart

### 前提

- `Node.js 22+`
- `npm 10+`
- `Python 3.12+`
- `uv`

### 1. 依存関係の導入と build

```bash
npm install
npm run build
uv sync --group dev
```

### 2. Clipulse を起動

```bash
export CLIPULSE_DATABASE_URL="sqlite+pysqlite:///$(pwd)/clipulse.sqlite3"
export CLIPULSE_STATE_DIR="/tmp/clipulse-state"
PYTHONPATH=apps/api uv run python -m clipulse_api.migrate upgrade "$CLIPULSE_DATABASE_URL"
PYTHONPATH=apps/api uv run uvicorn clipulse_api.app:create_app --factory --host 127.0.0.1 --port 8000
```

### 3. 最初の実イベントを送る

```bash
export CLIPULSE_API_URL="http://127.0.0.1:8000"
ROOT="$(pwd)"
sed "s|__CODEX_SMOKE_PROJECT_ROOT__|$ROOT|g" packages/adapter-codex/examples/smoke/session-start.json \
  | node packages/adapter-codex/dist/cli.js
```

### 4. dashboard を開く

`http://127.0.0.1:8000/` にアクセスします。

- `CLIPULSE_SERVER_TOKEN` が未設定なら dashboard は直接開きます。
- `CLIPULSE_SERVER_TOKEN` を設定すると、まずログインページが表示されます。
- dashboard cookie は現在 read-only のブラウザセッションです。書き込み系 API は引き続き `Authorization: Bearer` が必要です。

## Deployment Surface

### Source checkout

開発者と多くの operator にとって、source checkout は今も最も素直な経路です。

- リポジトリを build
- `clipulse_api.migrate upgrade` を先に実行
- その後 `uvicorn` を起動

### Python release artifact

`npm run check:py-build` は dashboard 資産を含む Python `sdist` / `wheel` を構築します。内容は次の通りです。

- FastAPI backend
- `/static/*` に必要な dashboard 資産
- `/contracts/*` に必要な互換契約

`npm run check:py-install-smoke` は wheel をクリーンな仮想環境に入れ、実際にローカルサーバを起動し、そのサーバに対して `smoke:deployment` を実行します。

### Public badge / README routes

公開面が必要な場合は、メインの dashboard / API は非公開のままにし、次だけを公開する構成を勧めます。

- `/api/v1/badges/*`
- `/api/v1/public/readme/*`

次の 2 つを設定してください。

```bash
export CLIPULSE_ENABLE_PUBLIC_READS="1"
export CLIPULSE_PUBLIC_BASE_URL="https://clipulse.example"
```

README snippet には `CLIPULSE_PUBLIC_BASE_URL` が必須です。Clipulse は request `Host` から公開 markdown を組み立てなくなりました。

Gemini の基線配線例: `packages/adapter-gemini/dist/cli.js` を build し、checked-in 例に従って `SessionStart`、`BeforeTool`、`AfterTool`、`BeforeAgent`、`AfterAgent`、`SessionEnd` を配線します。

`BeforeAgent` と互換 alias `UserPromptSubmit` を同じ導入で同時に配線しないでください。

OpenCode の opt-in guardrail: `session.diff` は `CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF=1` のときだけ有効です。

## Verify

### リポジトリ検証

```bash
npm run smoke:stable
npm run smoke:experimental
```

### 稼働中インスタンスの probe

すでに起動している実インスタンスに対しては次を使います。

```bash
export CLIPULSE_BASE_URL="http://127.0.0.1:8000"
export CLIPULSE_SERVER_TOKEN="$CLIPULSE_SERVER_TOKEN"
export CLIPULSE_PUBLIC_BASE_URL="http://127.0.0.1:8000"
export CLIPULSE_EXPECT_PUBLIC_READS=1
npm run smoke:deployment
```

保護されたデプロイでは、`smoke:deployment` が次を確認します。

- 匿名の `/api/v1/status`、`/static/*`、`/contracts/*`、`/docs`、`/openapi.json` が拒否される
- `/` でログインページが返る
- ログイン後の signed browser session が私用 dashboard の read ルートを読める

<details>
<summary>環境変数</summary>

- `CLIPULSE_API_URL`: adapter の送信先
- `CLIPULSE_API_BEARER_TOKEN`: 保護された ingest 用 bearer token
- `CLIPULSE_DATABASE_URL`: SQLite database URL
- `CLIPULSE_STATE_DIR`: ローカル spool、snapshot、timing 状態
- `CLIPULSE_STATE_RETENTION_DAYS`: ローカル保持期間
- `CLIPULSE_STATE_MAX_FILES`: 保持ファイル上限
- `CLIPULSE_STATE_MAX_SPOOL_BYTES`: backlog byte cap
- `CLIPULSE_SERVER_TOKEN`: dashboard、private API、docs、contracts を保護
- `CLIPULSE_ENABLE_PUBLIC_READS=1`: 匿名 badge / README route を有効化
- `CLIPULSE_PUBLIC_BASE_URL`: 公開 README snippet が使う正規 origin

</details>

<details>
<summary>Adapter entry points</summary>

Stable:

- [Claude adapter README](./packages/adapter-claude/README.md)
- [Claude canonical hooks](./packages/adapter-claude/hooks/hooks.json)
- [Codex adapter README](./packages/adapter-codex/README.md)
- [Codex canonical hooks](./packages/adapter-codex/examples/hooks.json)

Experimental:

- [Gemini adapter README](./packages/adapter-gemini/README.md)
- [Gemini settings example](./packages/adapter-gemini/examples/.gemini/settings.json)
- [OpenCode adapter README](./packages/adapter-opencode/README.md)
- [OpenCode wrapper example](./packages/adapter-opencode/examples/clipulse.ts)

</details>

## Docs

- [Self-hosting and integration guide](./docs/self-hosting-and-integration.md)
- [Release and packaging notes](./docs/release-and-packaging.md)
- `/contracts/dashboard-compat.v1.json`
- [Changelog](./CHANGELOG.md)
- [Security policy](./SECURITY.md)
- [Contributing](./CONTRIBUTING.md)
- [Support](./SUPPORT.md)

## Community

- [Code of Conduct](./CODE_OF_CONDUCT.md)
- [Issue templates](https://github.com/Boulea7/Clipulse/issues/new/choose)
- [Security reporting path](https://github.com/Boulea7/Clipulse/security/policy)
