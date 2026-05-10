# Clipulse

[简体中文](./README.md) | [繁體中文](./README.zh-TW.md) | [English](./README.en.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [한국어](./README.ko.md)

[![Beta Checks](https://github.com/Boulea7/Clipulse/actions/workflows/beta-checks.yml/badge.svg)](https://github.com/Boulea7/Clipulse/actions/workflows/beta-checks.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-0f766e.svg)](./LICENSE)
[![Python 3.12+](https://img.shields.io/badge/python-3.12%2B-1d4ed8.svg)](./pyproject.toml)
[![Node 22.12+](https://img.shields.io/badge/node-22.12%2B-111827.svg)](./package.json)

> `Claude Code`、`Codex`、`Gemini CLI`、`OpenCode` 向けの、プライバシー優先なセルフホスト型アクティビティトラッカー。

Clipulse は coding-agent CLI 向けのセルフホスト型アクティビティトラッカーです。ローカル hooks と plugin イベントを、プライバシーに配慮した集計、軽量 dashboard、README に埋め込める badge にまとめます。ソース本文や raw prompt は既定で送信しません。

## Clipulse を使う理由

- API、SQLite、dashboard を自分のインフラに置いたまま運用できます。
- ひとつの制限されたイベント契約で active time、wait time、file delta、言語、モデル、host mix を追跡できます。
- 公開したいときは badge と README snippet だけを出し、私用 dashboard は閉じたままにできます。
- まずは source checkout で始めて、必要になったら Python release artifact へ移れます。

既定の転送では、集計に必要な限定的な活動メタデータだけを扱います。たとえばハッシュ化された `project_root` scope key、host / model 名、タイムスタンプ、集計済み language stats、file-delta count です。raw のローカルパス、ソース本文、raw prompt、raw transcript は既定で送信しません。

## 得られるもの

- `apps/api` にある配備可能な FastAPI runtime と、`apps/web` 由来の同梱 dashboard
- `packages/collector-core` にある共有の収集、バッファ、配送ロジック
- 安定対応の `Claude Code` と `Codex`
- 実験対応の `Gemini CLI` と `OpenCode`
- `/contracts/dashboard-compat.v1.json` を含む第一方互換アーティファクト

## サポート状況

- 現在の一級対応: `Claude Code`、`Codex`
- 現在の実験対応: `Gemini CLI`、`OpenCode`
- すぐ使える診断入口: `/healthz`、`/api/v1/status`、`doctor`、`pending`

## Coding Agent で一気にインストール

最短で試したいなら、リポジトリを `Claude Code`、`Codex`、`OpenCode` で開き、次のプロンプトをそのまま貼り付けてください。

- 先にこの README と `docs/self-hosting-and-integration.md` を読ませます。
- 実行コマンドはそのまま承認する前に確認してください。特に環境変数の設定と長時間動くサーバコマンドは要確認です。
- 手で入れたい場合は、この次の Quickstart から進めてください。

```text
あなたは Clipulse リポジトリのルートにいます。README.ja.md と docs/self-hosting-and-integration.md を先に読み、このマシンで Clipulse のローカル導入を最後まで完了してください。

目標:
1. 必要な Node.js と Python の依存関係を入れる。
2. 保護されたローカルデプロイ用の環境変数を設定する。まだ本物の秘密情報がなければ分かりやすいプレースホルダを使い、最後に何を差し替えるべきか明示する。
3. データベース migration を実行する。
4. API を 127.0.0.1:8000 で起動する。
5. 同梱の Codex smoke fixture をローカル API に送る。
6. dashboard のログイン画面が開くことを確認し、ログイン方法を説明する。
7. 途中で失敗したら原因を調べて直し、ローカル導入が通るまで続ける。
8. tag や release は作らず、無関係なファイルも変更しない。

最後に必ず出力するもの:
- 実行した全コマンド
- まだ手動で差し替える必要がある環境変数
- 最終的な検証結果
```

## Quickstart

前提:

- `Node.js 22.12+`
- `npm 10+`
- `Python 3.12+`
- `uv`

1. リポジトリを build し、Python 依存関係を入れます。

```bash
npm install
npm run build
uv sync --group dev
```

2. 保護モードで Clipulse を起動します。

```bash
export CLIPULSE_DATABASE_URL="sqlite+pysqlite:///$(pwd)/clipulse.sqlite3"
export CLIPULSE_STATE_DIR="/tmp/clipulse-state"
export CLIPULSE_DASHBOARD_TOKEN="replace-with-a-random-dashboard-token"
export CLIPULSE_API_BEARER_TOKEN="replace-with-a-random-api-token"
export CLIPULSE_SESSION_SECRET="replace-with-a-long-random-session-secret"
PYTHONPATH=apps/api uv run python -m clipulse_api.migrate upgrade "$CLIPULSE_DATABASE_URL"
PYTHONPATH=apps/api uv run uvicorn clipulse_api.app:create_app --factory --host 127.0.0.1 --port 8000
```

`CLIPULSE_ALLOW_INSECURE_NO_AUTH=1` は、ローカルで dashboard 認証を意図的に外したいときだけ使ってください。

3. 安定した `Codex` adapter 経路で、同梱 smoke fixture を 1 件流します。

```bash
export CLIPULSE_API_URL="http://127.0.0.1:8000"
export CLIPULSE_API_BEARER_TOKEN="reuse-the-token-from-step-2"
ROOT="$(pwd)"
sed "s|__CODEX_SMOKE_PROJECT_ROOT__|$ROOT|g" packages/adapter-codex/examples/smoke/session-start.json \
  | node packages/adapter-codex/dist/cli.js
```

4. `http://127.0.0.1:8000/` を開き、`CLIPULSE_DASHBOARD_TOKEN` でログインして、最初の session が見えることを確認します。

5. checkout から stable release asset 一式を準備する場合は、次も実行します。

```bash
npm run check:py-build
npm run check:package:stable
node scripts/release-assets.mjs manifest
node scripts/release-assets.mjs checksums
npm run check:release-assets:stable
```

診断優先で進めたい場合は `docs/self-hosting-and-integration.md` を続けて見てください。repo smoke は意図的に 2 本です。`npm run smoke:stable` が安定面、`npm run smoke:experimental` が実験 host の追加分です。

## 出力例

`CLIPULSE_ENABLE_PUBLIC_READS=1` と `CLIPULSE_PUBLIC_BASE_URL` を設定すると、`/api/v1/public/readme/top-language` は他の README にそのまま貼れる markdown を返します。

```md
![Clipulse Top Language](https://clipulse.example/api/v1/badges/top-language.svg)
```

同じ public パターンで `today-time` と `this-week-time` も使えます。

## ドキュメント案内

- [Self-hosting and integration guide](./docs/self-hosting-and-integration.md): 配備モード、認証、reverse proxy、probe、adapter 配線
- [Architecture overview](./docs/architecture.md): データフロー、信頼境界、runtime surface
- [Release and packaging overview](./docs/release-and-packaging.md): source checkout と Python artifact の違い
- [Clipulse Python Package](./README.package.md): build 済み `sdist` / `wheel` の導入方法
- [Contributing](./CONTRIBUTING.md): 貢献ルールと public doc の案内ルール
- [Support](./SUPPORT.md): 公開サポートの経路と、相談時に含めるべき情報
- [Security policy](./SECURITY.md): 脆弱性や privacy leak の私的な報告経路
- [Changelog](./CHANGELOG.md): リリース向けの変更履歴

<details>
<summary>Adapter 入口と checked example</summary>

- 安定 adapter 文書: [packages/adapter-claude/README.md](./packages/adapter-claude/README.md)、[packages/adapter-codex/README.md](./packages/adapter-codex/README.md)
- 安定 checked example: [packages/adapter-claude/hooks/hooks.json](./packages/adapter-claude/hooks/hooks.json)、[packages/adapter-codex/examples/hooks.json](./packages/adapter-codex/examples/hooks.json)
- 実験 adapter 文書: [packages/adapter-gemini/README.md](./packages/adapter-gemini/README.md)、[packages/adapter-opencode/README.md](./packages/adapter-opencode/README.md)
- 実験 checked example: [packages/adapter-gemini/examples/.gemini/settings.json](./packages/adapter-gemini/examples/.gemini/settings.json)、[packages/adapter-opencode/examples/clipulse.ts](./packages/adapter-opencode/examples/clipulse.ts)

</details>

<details>
<summary>Packaging と詳細メモ</summary>

- contributor とセルフホスト operator にとっては、source checkout が今も最短経路です。
- build 済み Python artifact の説明は [docs/release-and-packaging.md](./docs/release-and-packaging.md) と [README.package.md](./README.package.md) にあります。API runtime、dashboard asset、`/contracts/*` を同梱します。
- `npm run check:release:prep` は安定面の release-ready preflight、`npm run check:release:prep:full` はそこに実験 adapter を追加します。
- public read surface だけを公開するなら `/api/v1/badges/*` と `/api/v1/public/readme/*` を出し、`CLIPULSE_ENABLE_PUBLIC_READS=1` と `CLIPULSE_PUBLIC_BASE_URL` を設定します。
- `CLIPULSE_PUBLIC_PROBE_URL` は public outlet が別 origin や別 proxy path にあるときだけ追加し、`npm run smoke:deployment` から直接 probe します。
- Gemini の基線配線は `packages/adapter-gemini/dist/cli.js` と checked-in lifecycle example から始めます: `SessionStart`、`BeforeTool`、`AfterTool`、`BeforeAgent`、`AfterAgent`、`SessionEnd`。
- `BeforeAgent` と互換 alias `UserPromptSubmit` を同じ導入で同時に配線しないでください。
- `OpenCode` の `session.diff` は `CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF=1` のときだけ有効です。

</details>

## サポートとセキュリティ

- 公開できる非機密の相談は [SUPPORT.md](./SUPPORT.md) の案内に従ってください。
- 脆弱性、privacy leak、非公開で扱うべき内容は [SECURITY.md](./SECURITY.md) を使ってください。
- 公開 bug や docs gap は [issue chooser](https://github.com/Boulea7/Clipulse/issues/new/choose) から送ってください。
