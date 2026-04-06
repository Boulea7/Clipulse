# Clipulse

[简体中文](./README.md) | [繁體中文](./README.zh-TW.md) | [English](./README.en.md)

Clipulse は、`Claude Code` や `Codex` などの coding agent CLI 向けの軽量アクティビティトラッカーです。現在の alpha+ は、セルフホスト、プライバシー重視、ターミナル中心の利用を優先しています。

WakaTime API の複製や、agent ワークフロー向けの大きな SaaS 層を目指しているわけではありません。現時点での実装目標は、より実務的です。
- 自分で API、SQLite、dashboard を運用できるようにする
- plugin / hooks を通じて session、project、language、model、host、file delta の要約を収集する
- ソース本文や raw prompt を送信せずに README badge と軽量レポートを提供する

## Alpha+ の範囲
- 初期の正式対応: `Claude Code`, `Codex`
- 次の対象: `Gemini CLI`, `OpenCode`
- 配置方針: self-hosting first
- データ境界: 正規化イベントと file delta 要約のみを送信し、ソース本文や raw prompt は送信しない
- 製品境界: alpha+ では単一ユーザー・ローカル優先・要約中心を維持し、認証、多租戶、リモートコード保存は入れない

## 現在すでに動く部分
- `Claude Code` と `Codex` の両アダプタが実際の `dist/cli.js` をビルドできる
- `CLIPULSE_API_URL` を使った直接送信に対応している
- API が落ちているときは、イベントをローカル state directory に一時保存し、次回は backlog を先に flush してから現在バッチを送る
- `Claude Code` アダプタはローカル transcript cursor を使って新しい記録だけを増分解析し、各 hook ごとに全文再走査しない
- `Claude Code` はファイル編集が無い `UserPromptSubmit` でも project-level activity を 1 件保持する
- `Claude Code` と `Codex` はどちらも、ローカル Git 文脈からより安定した `project_name` と `git_branch` を補完しようとする
- FastAPI + SQLite は overview、timeseries、language/model/host breakdown、`projects/top`、`sessions/recent`、`sessions/{session_id}`、`projects/{project_ref}/sessions`、複数の badge / README snippet をすでに提供している
- dashboard は overview、今日 / 今週の時間、languages、models、hosts、project ランキング、recent sessions、7 日 activity と、branch context を含む hash 駆動の session / project detail を表示できる

## Alpha+ で揃えたい実装目標
- コア構成は「セルフホスト + ローカル state directory + 薄い API」のまま維持し、別の queue service は増やさない
- Codex の file-delta heuristic を詰めて、snapshot diff のノイズと走査範囲を減らす
- より価値の高い summary-first レポートを増やしつつ、複雑な BI にはしない

## クイックスタート
```bash
npm install
npm run build
uv sync --group dev
PYTHONPATH=apps/api uv run uvicorn clipulse_api.app:create_app --factory --reload
```

その後、`http://127.0.0.1:8000/` を開きます。

## セルフホストと保存先
デフォルトの DB ファイルは、リポジトリルートの `clipulse.sqlite3` です。

主な環境変数:
- `CLIPULSE_API_URL`。例: `http://127.0.0.1:8000`
- `CLIPULSE_STATE_DIR`。ローカル state directory。未設定なら `XDG_STATE_HOME/clipulse` または `~/.local/state/clipulse`

まず API を起動してから hooks をつなぐのが安全です。

```bash
PYTHONPATH=apps/api uv run uvicorn clipulse_api.app:create_app --factory --host 0.0.0.0 --port 8000
```

## ローカル State Directory 構造
現在の alpha+ では、`CLIPULSE_STATE_DIR` 配下に次の構造を使います。

```text
clipulse-state/
  sessions/
    <host>-<scoped-session-hash>.json
  snapshots/
    <host>-<scoped-session-hash>.json
  spool/
    tmp/
    ready/
    processing/
    quarantine/
```

用途:
- `sessions/`: `active_ms` と `wait_ms` を導くためのローカル timing state
- `snapshots/`: Codex の fallback diff 用に保持する session 単位の project text snapshot
- `spool/`: 未送信 batch の一時保存領域。送信時は `ready/` backlog を先に flush する
- backlog は再送前に安定した `event_id` で機会的に重複排除され、ノイズを減らす
- hooks 実行時には古い `tmp` / `quarantine` / `sessions` / `snapshots` state を機会的に掃除し、`stop` 後には現在 session の一時 state を削除する

## プライバシー境界
- ソースコード本文は送信しない
- raw prompt / transcript 本文は送信しない
- ファイル単位で送るのは、正規化 delta と privacy-safe fingerprint のみで、完全な path や内容は送らない
- `snapshots/`、`sessions/`、`spool/` はローカルにのみ残り、ソース資料としてはアップロードされない
- `.clipulse-private/` はローカル研究と私的メモ用で、コミットしない前提

## 導入
### Claude Code
1. `npm run build` を実行する
2. `packages/adapter-claude/.claude-plugin/` を Claude plugin directory として扱う
3. その plugin root 内で、`plugin.json` は `./hooks/hooks.json` を参照する
4. ローカル検証時は plugin directory として読み込む。例: `claude --plugin-dir /abs/path/to/packages/adapter-claude`
5. パッケージングまたはインストール時に、`${CLAUDE_PLUGIN_ROOT}/dist/cli.js` が存在するようにする。つまり最終的な plugin root 配下に `dist/cli.js` が必要
6. 環境変数を設定する:

```bash
export CLIPULSE_API_URL="http://127.0.0.1:8000"
export CLIPULSE_STATE_DIR="$HOME/.local/state/clipulse"
```

### Codex
1. `npm run build` を実行する
2. `packages/adapter-codex/examples/hooks.json` を参考にする
3. コマンドパスを `packages/adapter-codex/dist/cli.js` に向ける
4. `CLIPULSE_API_URL` と必要なら `CLIPULSE_STATE_DIR` を設定する

## Project / Session の現状
現在の API と dashboard は、軽量 drill-down をすでに提供しています。
- `GET /api/v1/projects/top`: project 集計と `project_ref`
- `GET /api/v1/sessions/recent`: recent session 集計と `project_ref`
- `GET /api/v1/sessions/{session_id}`: session metadata、active / wait 合計、event 数、language 集計、file-delta summary
- `GET /api/v1/projects/{project_ref}/sessions`: project ごとの recent session と project rollup

detail view はまだ summary-first であり、完全な event timeline ではありません。

## Badge と README Snippet
現在の badge endpoint:
- `GET /api/v1/badges/top-language.svg`
- `GET /api/v1/badges/today-time.svg`
- `GET /api/v1/badges/this-week-time.svg`

README に直接埋め込む例:

```md
![Clipulse Top Language](https://your-domain.example/api/v1/badges/top-language.svg)
![Clipulse Today Time](https://your-domain.example/api/v1/badges/today-time.svg)
![Clipulse This Week Time](https://your-domain.example/api/v1/badges/this-week-time.svg)
```

公開 snippet endpoint:

```bash
curl https://your-domain.example/api/v1/public/readme/top-language
curl https://your-domain.example/api/v1/public/readme/today-time
curl https://your-domain.example/api/v1/public/readme/this-week-time
```

返却形:

```json
{"markdown":"![Clipulse Top Language](https://your-domain.example/api/v1/badges/top-language.svg)"}
```

## 現在の Heuristic と制限
- `active_ms` / `wait_ms` は hook-gap heuristic であり、正確な foreground activity time ではない
- wait ではない `active_ms` は 1 ギャップあたり最大 `15_000` ms に clamp される
- `wait_ms` は `pre_tool_use -> post_tool_use` の差分からのみ算出する
- Claude transcript の増分 state はローカル `CLIPULSE_STATE_DIR` にのみ保存され、リモート資産としては公開されない
- Codex の最初の snapshot は baseline を作るだけで、file delta は返さない
- ローカル snapshot は text file だけを走査し、`.git`、`.clipulse-private`、`.venv`、`.worktrees`、`.pytest_cache`、`.ruff_cache`、`.mypy_cache`、`coverage`、`dist`、`build`、`node_modules` を無視する。`256 KiB` 超、極端に長い text file、binary byte を含む file もスキップされる
- Codex の file-delta 集計は、Bash command の候補 path を優先して絞り込む最小可用 heuristic であり、正確な VCS diff ではない
- session / project detail は集計要約であり、完全な event timeline ではない
- 現時点では auth、多用户隔離、リモート code-content storage はない

## ロードマップ
- [x] 統一イベントモデルと batch delivery
- [x] Claude Code plugin / hooks の初期アダプタ
- [x] Codex hooks の初期アダプタ
- [x] FastAPI ingest / overview / breakdown / badge API
- [x] top-project と recent-session の集計
- [x] 軽量 dashboard
- [x] session / project detail drill-down
- [x] ローカル state pruning policy
- [ ] より細かな時間推定と低オーバーヘッドな Codex file-delta tracking
- [ ] Gemini CLI と OpenCode のアダプタ

## 開発メモ
- 私的な調査、upstream メモ、競合分析は `.clipulse-private/` に置く
- `.clipulse-private/` はコミットしない
- この README では「今日すでに実装済みのこと」と「alpha+ で次にやること」を混同しない
