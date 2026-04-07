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
- ingest は軽量なイベント単位結果も返すようになり、adapter はまだ再試行すべきイベントだけを残せる
- partial delivery outcome は安定した `event_id` を優先して結果に対応付けるようになり、未確認の結果は誤分類せず再試行対象として残せる
- `Claude Code` アダプタはローカル transcript cursor を使って新しい記録だけを増分解析し、各 hook ごとに全文再走査しない
- `Claude Code` は compact や transcript 巻き戻りの後にも基線を組み直し、空の `PreToolUse` ノイズを抑え、ゼロ行 change patch を無視し、`stop` / `session_end` / `pre_compact` 時に同一 session の transcript path 変種 state を掃除する
- `Claude Code` はファイル編集が無い `UserPromptSubmit` でも project-level activity を 1 件保持する
- `Claude Code` と `Codex` はどちらも、ローカル Git 文脈からより安定した `project_root`、`project_name`、`git_branch` を補完しようとする
- FastAPI + SQLite は overview、timeseries、language/model/host breakdown、`projects/top`、`sessions/recent`、`sessions/{session_id}`、`projects/{project_ref}`、`projects/{project_ref}/sessions`、複数の badge / README snippet をすでに提供している
- FastAPI は `GET /api/v1/status` も返すようになり、セルフホスト時の API / DB / ローカル spool 状態をすぐ確認できる。queue 件数、ローカル byte 合計、backlog / quarantine の最古 age も含まれる
- recent session と project session の一覧は、同じ論理 session 内で host / model が切り替わっても 1 行に集約されるようになった
- project detail は session detail と同系統の compact summary を持ち、changed files、changed languages、line changes、top language、host-model mix を返す
- dashboard は overview、今日 / 今週の時間、languages、models、hosts、project ランキング、recent sessions、7 日 activity と、branch context、breadcrumb navigation、heuristic guidance、changed files / changed languages / line changes の要約を含む hash 駆動の session / project detail を表示できる
- dashboard detail は `projects/top` / `sessions/recent` を前提にせず dedicated detail endpoint を優先するようになり、home では `/api/v1/status` の読み込み失敗も明示される
- `ready/processing` backlog にもローカル age / size cap が入り、古すぎる batch や size cap を超えて押し出された batch は `spool/quarantine/` に sidecar metadata 付きで隔離される
- backlog sidecar metadata は `first_seen_at`、`attempt_count`、`last_attempted_at` も保持するようになり、`processing -> ready` 復旧やローカル quarantine のあとでも同じ backlog batch を「新しい問題」と誤認しにくくなった
- ローカル spool sidecar は、metadata の一部だけが壊れていても有効な lineage 欄位をできるだけ引き継ぐようになり、孤児 `.meta.json` bookkeeping ファイルで current batch が payload backlog に塞がれて見えることもなくなった
- `collector-core` には、ごく小さなローカル operator CLI も追加された。`node packages/collector-core/dist/cli.js doctor` / `pending` で、spool payload、orphan sidecar、quarantine reason を read-only で確認でき、processing backlog だけが残っている状況もより分かりやすく示す
- dashboard は起動時や deep link 切替時に loading copy と failure copy を分け、project view の sessions 領域も project-scoped のまま保たれる。project sessions の子リクエストだけが失敗しても project detail 自体は表示を維持し、home/status では quarantine があると最古 quarantine age も示す
- session / project detail では、`fingerprint` が生の path ではなく privacy-safe identifier であることを説明し、file delta が 0 件でも prompt-only activity や初回 Codex snapshot baseline では正常な場合があることを案内する

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

長期運用、自ホスト接続、payload サンプル、トラブルシュートをまとめたガイドは [docs/self-hosting-and-integration.md](./docs/self-hosting-and-integration.md) を参照してください。

主な環境変数:
- `CLIPULSE_API_URL`。例: `http://127.0.0.1:8000`
- `CLIPULSE_STATE_DIR`。ローカル state directory。未設定なら `XDG_STATE_HOME/clipulse` または `~/.local/state/clipulse`

まず API を起動してから hooks をつなぐのが安全です。

```bash
PYTHONPATH=apps/api uv run uvicorn clipulse_api.app:create_app --factory --host 0.0.0.0 --port 8000
```

ローカルのトラブルシュート時には次も使えます。

```bash
node packages/collector-core/dist/cli.js doctor
node packages/collector-core/dist/cli.js pending
```

## ローカル State Directory 構造
現在の alpha+ では、`CLIPULSE_STATE_DIR` 配下に次の構造を使います。

```text
clipulse-state/
  sessions/
    <host>-<scoped-session-hash>.json
  snapshots/
    <host>-<scoped-session-hash>.json
  claude-transcripts/
    <session-scope>.json
  spool/
    tmp/
    ready/
    processing/
    quarantine/
```

用途:
- `sessions/`: `active_ms` と `wait_ms` を導くためのローカル timing state
- `snapshots/`: Codex の fallback diff 用に保持する session 単位の project text snapshot
- `claude-transcripts/`: Claude transcript cursor のローカル state
- `spool/`: 未送信 batch の一時保存領域。送信時は `ready/` backlog を先に flush する
- backlog は再送前に安定した `event_id` で機会的に重複排除され、ノイズを減らす
- `spool/quarantine/` には自動再試行しない payload や、ローカル age / size cap で隔離された payload と、同名の `.meta.json` 説明ファイルが保存される。再試行可能な subset は `ready/` に残る
- `ready/` と `processing/` backlog にも軽量なローカル age / size cap があり、ローカル sidecar metadata は `first_seen_at` / `attempt_count` / `last_attempted_at` を引き継ぎ、quarantine sidecar には `source_state` や `approx_bytes` が入ることがある
- sidecar の一部だけが壊れている場合でも、Clipulse は有効な lineage 欄位をできるだけ救済し、ローカル backlog の同一性を丸ごとリセットしない
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
5. パッケージングまたはインストール時は、最終 `${CLAUDE_PLUGIN_ROOT}` に `hooks/` と `dist/cli.js` の両方が見えるようにする。リポジトリでは manifest を `.claude-plugin/` に置いているが、実際の plugin root には実行用ファイルが必要
6. 環境変数を設定する:

```bash
export CLIPULSE_API_URL="http://127.0.0.1:8000"
export CLIPULSE_STATE_DIR="$HOME/.local/state/clipulse"
```

### Codex
1. `npm run build` を実行する
2. `packages/adapter-codex/examples/hooks.json` を参考にする。推奨 hook セットは `SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`Stop`
3. コマンドパスを `packages/adapter-codex/dist/cli.js` に向ける
4. `CLIPULSE_API_URL` と必要なら `CLIPULSE_STATE_DIR` を設定する

## Project / Session の現状
現在の API と dashboard は、軽量 drill-down をすでに提供しています。
- `GET /api/v1/projects/top`: project 集計と `project_ref`
- `GET /api/v1/sessions/recent`: recent session 集計と `project_ref`
- `GET /api/v1/sessions/{session_id}`: session metadata、active / wait 合計、event 数、language 集計、file-delta summary に加えて changed files / changed languages / line changes / top language の要約
- `GET /api/v1/projects/{project_ref}`: project-level detail payload
- `GET /api/v1/projects/{project_ref}/sessions`: その project の compact な session list のみ
- `GET /api/v1/status`: セルフホストの `api` / `db` / `spool` 最小状態。queue 件数、byte 数、最古 backlog / quarantine age も返す

detail view はまだ summary-first であり、完全な event timeline ではありません。

互換性メモ:
- `GET /api/v1/projects/{project_ref}/sessions` は compact list 専用になりました。project summary は `GET /api/v1/projects/{project_ref}` を使ってください
- 同じ `session_id` が複数 project にある場合、`GET /api/v1/sessions/{session_id}` には `?project_ref=...` が必須です。未指定だと machine-readable な `409` を返します

`file_preview` と `fingerprint` は privacy boundary の一部です。
- `file_preview` は変化傾向の要約であり、ソース本文は返さない
- `fingerprint` は安定 ID であり、生の file path ではない

Example batch payload:

```json
{
  "events": [
    {
      "event_id": "demo-event-1",
      "host": "codex",
      "host_version": "0.1.0",
      "session_id": "demo-session",
      "project_root": "/workspace/demo",
      "project_name": "demo",
      "git_branch": "feat/example",
      "event_name": "post_tool_use",
      "event_time": "2026-04-06T12:00:00Z",
      "model_name": "gpt-5.4",
      "os_name": "macos",
      "editor_or_terminal": "terminal",
      "active_ms": 12000,
      "wait_ms": 3000,
      "privacy_mode": "hashed",
      "language_stats": {
        "TypeScript": { "added": 5, "removed": 1, "changed": 6 }
      },
      "file_deltas": [
        {
          "fingerprint": "example-fingerprint",
          "language": "TypeScript",
          "added": 5,
          "removed": 1
        }
      ]
    }
  ]
}
```

## Troubleshooting
- 同じ論理 session で host や model が切り替わっただけなら、recent sessions はもう分割表示されないはずです。まだ重複するなら、まず `project_root` が別になっていないか確認してください。
- Codex の snapshot ベース差分で最初のイベントに file delta が出ないのは想定内です。最初のキャプチャはローカル baseline 作成に使われます。
- 直接送信に失敗した場合は `CLIPULSE_STATE_DIR/spool/ready` を確認してください。Clipulse は次の hook 実行時に未確定イベントを先に再送します。
- `spool/quarantine/` にファイルがある場合は、まず同名の `.meta.json` を確認してください。隔離されるのは自動再試行しない subset だけでなく、ローカル age / size cap で収容された backlog のこともあります。
- よくある quarantine `reason` は `http_error`、`invalid_results`、`recovery_failed`、`invalid_spool_payload`、`stale_backlog`、`spool_size_cap` です。`stale_backlog` と `spool_size_cap` は元の backlog の `first_seen_at` と `attempt_count` を保持します。
- dashboard が API / DB / spool の異常を示したら、まず `GET /api/v1/status` を開いて、ローカル backlog 数だけでなく byte 数と最古 age も確認してください
- ターミナル中心で確認したい場合は `node packages/collector-core/dist/cli.js doctor` または `pending` を使えます。どちらも現在の `CLIPULSE_STATE_DIR` を read-only で参照します
- Claude の compact や transcript rotation 後に古い state が残って見える場合は、最新 build を使っているか確認してください。この版では同一 session の transcript path 変種もまとめて掃除します。

## Dashboard Walkthrough
- まず home view で overview、top projects、recent sessions を見る
- project を開くと project detail と breadcrumb navigation が出る
- project view の sessions card は、その project 専用の compact session list に切り替わります
- session を開くと host / model / branch / changed files / languages / line changes を確認できる
- `active`、`wait`、`line changes`、`host-model mix` は日常確認向けの local summary heuristic であり、正確な audit trail ではない

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
- Codex の file-delta 集計は、Bash command の候補 path を優先して絞り込む最小可用 heuristic であり、pipe / redirection / subshell / semicolon chain / escaped-space path のような低信頼 Bash や `git diff` のような明確な read-only command では保守的に広めの snapshot 比較へ戻るが、正確な VCS diff ではない
- Codex の rename / move は現在 remove + add として集計され、独立した rename event にはならない
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
