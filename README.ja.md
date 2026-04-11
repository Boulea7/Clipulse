# Clipulse

[简体中文](./README.md) | [繁體中文](./README.zh-TW.md) | [English](./README.en.md)

Clipulse は、`Claude Code` や `Codex` などの coding agent CLI 向けの軽量アクティビティトラッカーです。現在の alpha+ は、セルフホスト、プライバシー重視、ターミナル中心の利用を優先しています。

WakaTime API の複製や、agent ワークフロー向けの大きな SaaS 層を目指しているわけではありません。現時点での実装目標は、より実務的です。
- 自分で API、SQLite、dashboard を運用できるようにする
- plugin / hooks を通じて session、project、language、model、host、file delta の要約を収集する
- ソース本文や raw prompt を送信せずに README badge と軽量レポートを提供する

## Alpha+ の範囲
- 初期の正式対応: `Claude Code`, `Codex`
- 現在は試用可能だがまだ実験的: `Gemini CLI`, `OpenCode`
- 今後あらためて一級の安定対応へ進める対象: `Gemini CLI`, `OpenCode`
- 配置方針: self-hosting first
- データ境界: 正規化イベントと file delta 要約のみを送信し、ソース本文や raw prompt は送信しない
- 製品境界: alpha+ では単一ユーザー・ローカル優先・要約中心を維持し、認証、多租戶、リモートコード保存は入れない

## 現在すでに動く部分
- `Claude Code` と `Codex` の両アダプタが実際の `dist/cli.js` をビルドできる
- リポジトリには、試用可能な実験的 `Gemini CLI` hooks-first 入口（`packages/adapter-gemini/dist/cli.js`）と `OpenCode` plugin/event-first ブリッジ入口（`packages/adapter-opencode/dist/plugin.js`）も追加されている。どちらもビルドと fixture / contract 検証には入っているが、`Claude Code` / `Codex` と同じ安定約束にはまだ達していない
- `CLIPULSE_API_URL` を使った直接送信に対応している
- API が落ちているときは、イベントをローカル state directory に一時保存し、次回は backlog を先に flush してから現在バッチを送る
- ingest は軽量なイベント単位結果も返すようになり、adapter はまだ再試行すべきイベントだけを残せる
- partial delivery outcome は安定した `event_id` を優先して結果に対応付けるようになり、未確認の結果は誤分類せず再試行対象として残せる。API 側で fallback の `event_id` を生成する場合も、等価な UTC timestamp 表現を先に正規化するため、`Z` と `+00:00` の違いだけで同じ event が分裂しにくくなった
- `Claude Code` アダプタはローカル transcript cursor を使って新しい記録だけを増分解析し、各 hook ごとに全文再走査しない
- `Claude Code` は compact や transcript 巻き戻りの後にも基線を組み直し、空の `PreToolUse` ノイズを抑え、ゼロ行 change patch を無視し、`stop` / `stop_failure` / `session_end` / `pre_compact` 時に同一 session の transcript path 変種 state を掃除する
- `Claude Code` はファイル編集が無い `UserPromptSubmit` でも project-level activity を 1 件保持する
- `Claude Code` と `Codex` はどちらも、ローカル Git 文脈からより安定した `project_root`、`project_name`、`git_branch` を補完しようとする
- FastAPI + SQLite は overview、timeseries、language/model/host breakdown、`projects/top`、`sessions/recent`、`sessions/{session_id}`、`projects/{project_ref}`、`projects/{project_ref}/sessions`、複数の badge / README snippet をすでに提供している
- FastAPI は `GET /api/v1/status` も返すようになり、セルフホスト時の API / DB / ローカル spool 状態をすぐ確認できる。queue 件数、ローカル byte 合計、backlog / quarantine の最古 age も含まれる
- recent session と project session の一覧は、同じ論理 session 内で host / model が切り替わっても 1 行に集約されるようになった
- project detail は session detail と同系統の compact summary を持ち、changed files、changed languages、line changes、top language、host-model mix を返す
- dashboard は overview、今日 / 今週の時間、languages、models、hosts、project ランキング、recent sessions、7 日 activity と、session branch context、breadcrumb navigation、heuristic guidance、changed files / changed languages / line changes の要約を含む hash 駆動の session / project detail を表示できる
- dashboard detail は `projects/top` / `sessions/recent` を前提にせず dedicated detail endpoint を優先するようになり、home では `/api/v1/status` の読み込み失敗も明示される
- `ready/processing` backlog にもローカル age / size cap が入り、古すぎる batch や size cap を超えて押し出された batch は `spool/quarantine/` に sidecar metadata 付きで隔離される
- backlog sidecar metadata は `first_seen_at`、`attempt_count`、`last_attempted_at` も保持するようになり、`processing -> ready` 復旧やローカル quarantine のあとでも同じ backlog batch を「新しい問題」と誤認しにくくなった
- ローカル spool sidecar は、metadata の一部だけが壊れていても有効な lineage 欄位をできるだけ引き継ぐようになり、孤児 `.meta.json` bookkeeping ファイルで current batch が payload backlog に塞がれて見えることもなくなった
- `collector-core` には、ごく小さなローカル operator CLI も追加された。現在は意図的に `node packages/collector-core/dist/cli.js doctor` / `pending` の 2 つの read-only コマンドだけを公開し、spool payload、orphan sidecar、quarantine reason を確認でき、processing-only / quarantine-only / orphan-only backlog や `stale_backlog` / `spool_size_cap` の保持ヒントも分かりやすく示す
- dashboard は起動時や deep link 切替時に loading copy と failure copy を分け、project view の sessions 領域も project-scoped のまま保たれる。project sessions の子リクエストだけが失敗しても project detail 自体は表示を維持し、unscoped session deep link は detail lookup 成功後に project-scoped hash へ正規化され、home detail では最古 quarantine age と payload spool bytes をより明示する
- session / project detail では、`fingerprint` が生の path や source excerpt ではない privacy-safe identifier であることを説明し、file delta が 0 件でも prompt-only activity、read-only command、または初回 Codex snapshot baseline では正常な場合があることを案内する

## Alpha+ で揃えたい実装目標
- コア構成は「セルフホスト + ローカル state directory + 薄い API」のまま維持し、別の queue service は増やさない
- Codex の file-delta heuristic を詰めて、snapshot diff のノイズと走査範囲を減らす
- より価値の高い summary-first レポートを増やしつつ、複雑な BI にはしない
- `Gemini CLI` は hooks-first、`OpenCode` は plugin/event-first の最小スキャフォールドとして維持し、宿主契約が安定するまで重い統合面に広げない

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

`CLIPULSE_STATE_DIR` の対象パスがまだ存在しない場合でも、この 2 つのコマンドは確認だけを行い、ディレクトリを新規作成しません。

最小 smoke flow:

```bash
curl -i http://127.0.0.1:8000/healthz
curl http://127.0.0.1:8000/api/v1/status
node packages/collector-core/dist/cli.js doctor
node packages/collector-core/dist/cli.js pending
```

- `/healthz` は liveness 専用で、成功時は `204` を返します
- `/api/v1/status` が自ホスト排障の状態面です。現時点では独立した readiness probe はなく、これを高頻度のロードバランサ readiness probe として使う前提でもありません
- `doctor` / `pending` は read-only の smoke であり、欠落している state directory を作成せず、backlog も変更しません

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
      <batch>.json
      <batch>.meta.json
    processing/
      <batch>.json
      <batch>.meta.json
    quarantine/
      <batch>.json
      <batch>.meta.json
```

用途:
- `sessions/`: `active_ms` と `wait_ms` を導くためのローカル timing state
- `snapshots/`: Codex の fallback diff 用に保持する session 単位の project text snapshot
- `claude-transcripts/`: Claude transcript cursor のローカル state
- `spool/`: 未送信 batch の一時保存領域。送信時は `ready/` backlog を先に flush する
- backlog は再送前に安定した `event_id` で機会的に重複排除され、ノイズを減らす
- `spool/quarantine/` には自動再試行しない payload や、ローカル age / size cap で隔離された payload と、同名の `.meta.json` 説明ファイルが保存される。再試行可能な subset は `ready/` に残る
- `ready/`、`processing/`、`quarantine/` の各 spool state には、同名の `.meta.json` sidecar が現れることがあります。これはローカル lineage とトラブルシュート用フィールドを保持するためです。
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

- より詳しい adapter 境界は `packages/adapter-claude/README.md` を参照してください。prompt-only `UserPromptSubmit`、`Stop` / `StopFailure` / `SessionEnd` / `PreCompact` cleanup、そして現時点で公開契約に含める file-delta 範囲をまとめています。

### Codex
1. `npm run build` を実行する
2. `packages/adapter-codex/examples/hooks.json` を参考にする。この checked-in 例が現在の canonical wiring source であり、推奨 baseline は一般的な成功パスをカバーする `SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`Stop` で、同じ例に `SessionEnd` も cleanup / teardown 境界として残されています
3. 実行環境が `PostToolUseFailure` / `StopFailure` のような failure-path hooks も提供するなら、それらも配線すると `wait_ms` をより完全に確定できます
4. コマンドパスを `packages/adapter-codex/dist/cli.js` に向ける
5. `CLIPULSE_API_URL` と必要なら `CLIPULSE_STATE_DIR` を設定する
- prompt-only turn も残したいなら `UserPromptSubmit` を外さないでください。Codex の zero-delta event 自体は、prompt-only activity、read-only command、または最初の snapshot baseline capture では正常な場合があります

### Gemini CLI / OpenCode
- `packages/adapter-gemini/dist/cli.js` は、現在は公式 `SessionStart`、`SessionEnd`、`BeforeTool`、`AfterTool`、`BeforeAgent`、`AfterAgent` surface を中心にした、試用可能な hooks-first 入口です。
- `packages/adapter-gemini` は shared project context / timing を再利用し、`AfterAgent` を prompt submit と分けて扱います。公式 `write_file` / `replace` payload に明示的な file path がある場合だけ最小限の file delta を出し、`AfterModel` は対象外のままです。`SessionEnd` も信頼できる barrier ではなく best-effort の stop/cleanup fallback に留めています。現在の明示的な互換 alias は `AfterToolFailure` と `UserPromptSubmit` のみで、未文書の hook 名は無視され、送信対象イベントを生成しません。
- `packages/adapter-gemini/examples/.gemini/settings.json` は、包内に checked-in された公式 Gemini hook wiring の参照元になりました。トップレベル docs もこの例を基準にし、別の JSON コピーは維持しません。
- `packages/adapter-opencode/dist/plugin.js` は、依然として薄い bridge 入口であり、そのまま使う完全な plugin module ではありません。試用時は `packages/adapter-opencode/examples/clipulse.ts` のようなローカル wrapper から、現在選定している subset、つまり `session.created` / `session.deleted` / `session.idle` / `session.error`、命名 `tool.execute.before` / `tool.execute.after` / `tool.execute.error`、および `file.edited` を転送するのが前提です。この checked-in wrapper 例が現在の canonical wiring source です。
- `packages/adapter-opencode` は引き続き明示的な `file.edited` を高信頼 delta の主入口として扱い、ホストが path しか返さない場合は path-only delta に留めます。transcript scraping、server API、広い message/TUI event stream 取り込みは意図的に行いません。wrapper / bridge は repo 外の絶対 path や `../` で逃げる path も先に落とします。
- OpenCode には upstream の `session.diff` もありますが、Clipulse はまだそれを既定では取り込みません。累積的な snapshot surface であり、生の `before` / `after` テキストを含むため、利用には privacy stripping と dedupe policy が必要だからです。`CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF=1` を明示的に設定した場合だけ、リポジトリ内 wrapper 例が wrapper-only の post-turn backfill を行いますが、それでも転送するのは最小の `{ path, additions, deletions }` のみで、同じ buffered phase ですでに `file.edited` に現れた path は落とします。現在の wrapper は、upstream 側の `file` / `path` と `added` / `removed`、`additions` / `deletions` の shape alias も許容したうえで、この最小形に正規化します。さらに `file.edited` と gated `session.diff` は同じ fallback ownership ルールを共有し、`sessionID` なしで転送できるのは wrapper がちょうど 1 つの live session だけを追跡している場合に限られます。
- この 2 つのアダプタは「試せるがまだ実験的」という段階です。ビルド、fixture / contract test、最小 self-hosted wiring までは揃っていますが、`Claude Code` / `Codex` と同等の安定統合としてはまだ扱いません。
- 昇格条件: 公式 lifecycle contract が安定し、標準 wiring 経路で高信頼な file delta が得られ、checked-in の canonical wiring と fixture/contract coverage が成功/失敗の cleanup path を継続的に覆えるようになるまでは、`Gemini CLI` / `OpenCode` を実験的扱いのまま維持します。

## Project / Session の現状
現在の API と dashboard は、軽量 drill-down をすでに提供しています。
- `GET /api/v1/projects/top`: project 集計と `project_ref`
- `GET /api/v1/sessions/recent`: recent session 集計と `project_ref`
- `GET /api/v1/sessions/{session_id}`: session metadata、active / wait 合計、event 数、language 集計、file-delta summary に加えて changed files / changed languages / line changes / top language の要約
- `GET /api/v1/projects/{project_ref}`: project-level detail payload
- `GET /api/v1/projects/{project_ref}/sessions`: その project の session list。project detail 本体は混在しません
- `GET /healthz`: `204 No Content` だけを返す liveness probe
- `GET /api/v1/status`: schema-backed な最小 `api` / `db` / `spool` 状態。queue 件数、byte 数、最古 backlog / quarantine age も返し、件数と byte 数は payload `.json` のみを数える

detail view はまだ summary-first であり、完全な event timeline ではありません。

互換性メモ:
- `GET /api/v1/projects/{project_ref}/sessions` の既定は引き続き full list contract です。project summary は `GET /api/v1/projects/{project_ref}` を使ってください
- 3 つの list endpoint は `limit <= 0` のとき、安定して空の `items` を返します
- 同じ `session_id` が複数 project にある場合、`GET /api/v1/sessions/{session_id}` には `?project_ref=...` が必須です。未指定だと machine-readable な `409` を返します
- session の集計と lookup は実質的に `(project_root, session_id)` scope なので、裸の `session_id` より project-scoped link のほうが安定します
- 同じ `project_root` に対して後続イベントが別の `project_name` を報告しても、project 系 route と session detail は 1 つの canonical `project_name` を使い続けます
- detail / list payload は、`host_model_primary` と明示的な `last_*` host/model/branch 欄位を区別するようになり、preview から追加の changed file が省略されている場合は `file_preview_truncated_count` も返します
- `sessions/recent` と `projects/{project_ref}/sessions` の既定 payload は、現時点では後方互換のため完全な `host_model_mix` も保持しています。第一方 dashboard list は主に `host_model_primary` と `host_model_mix_count` を使うため、将来 slim 化する場合は silent な既定変更ではなく明示的な互換移行で行う想定です
- `sessions/recent?compact=true` と `projects/{project_ref}/sessions?compact=true` は、その明示的な opt-in slim path です。`host_model_mix` は省略しますが、`host_model_primary` と `host_model_mix_count` は維持します
- 第一方 dashboard は現在 `compact=true` を優先し、mixed-version rollout で list response が明確に非互換な場合だけ既定の full path に 1 回 fallback します。外部 caller が slim な shape に依存するなら、引き続き明示的に `compact=true` を付けてください

`file_preview` と `fingerprint` は privacy boundary の一部です。
- `file_preview` は変化傾向の要約であり、ソース本文は返さない
- `fingerprint` は安定 ID であり、生の file path ではない

Probe roles:
- `GET /healthz` は process が応答したことだけを示し、`204` を返します
- `GET /api/v1/status` は self-hosted troubleshooting に使う runtime status feed です
- 現在は独立した readiness probe はありません。API がまだ応答するなら、DB や spool の準備完了を `/healthz` だけで判断せず、`/api/v1/status` を確認してください

Example runtime status response:

```json
{
  "api": { "status": "ok", "version": "0.1.0" },
  "db": { "status": "ok", "events": 8, "projects": 2, "sessions": 3 },
  "spool": {
    "state_dir": "/srv/clipulse/state",
    "ready": 2,
    "processing": 1,
    "quarantine": 1,
    "ready_bytes": 2048,
    "processing_bytes": 512,
    "quarantine_bytes": 1024,
    "oldest_backlog_age_seconds": 3600,
    "oldest_quarantine_age_seconds": 7200
  }
}
```

初回起動でローカル state directory がまだ無い場合は、次のような all-zero empty state も正しい応答です。

```json
{
  "api": { "status": "ok", "version": "0.1.0" },
  "db": { "status": "ok", "events": 0, "projects": 0, "sessions": 0 },
  "spool": {
    "state_dir": "/home/demo/.local/state/clipulse",
    "ready": 0,
    "processing": 0,
    "quarantine": 0,
    "ready_bytes": 0,
    "processing_bytes": 0,
    "quarantine_bytes": 0,
    "oldest_backlog_age_seconds": 0,
    "oldest_quarantine_age_seconds": 0
  }
}
```

Example ambiguous session `409`:

```json
{
  "detail": {
    "code": "ambiguous_session",
    "message": "session_id matched multiple projects",
    "hint": "Retry with the matching project_ref from /api/v1/projects/top or /api/v1/sessions/recent."
  }
}
```

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
- `CLIPULSE_STATE_DIR` がまだ存在しない場合でも、`GET /api/v1/status` は失敗せず、spool count をゼロで返します
- ターミナル中心で確認したい場合は `node packages/collector-core/dist/cli.js doctor` または `pending` を使えます。ローカル operator surface は意図的にこの 2 つの read-only コマンドだけで、missing state dir も作成せずに確認します。ローカル state がまだ無い場合は “no local state directory yet” を明示し、`doctor` は quarantine-only、orphan-only、そして `stale_backlog` / `spool_size_cap` の retention ヒントも出します。未知コマンドは明示的に `doctor` へ fallback します。
- `/api/v1/status` が完全に 0 に見えても `CLIPULSE_STATE_DIR` 自体がまだ無いなら、それは「local state がまだ無い」だけで、hooks が既に正常稼働した証拠ではありません。`/api/v1/status` とローカルの `doctor` / `pending` が食い違う場合は、まずローカル spool inspection を優先してください。
- `409 ambiguous_session` に加えて、誤った project scope では `404 project_not_found`、未知の session では `404 session_not_found` を安定して返します
- Claude の compact や transcript rotation 後に古い state が残って見える場合は、最新 build を使っているか確認してください。この版では同一 session の transcript path 変種もまとめて掃除します。空の `PreToolUse` がノイズ抑制で送信されなくても、内部では wait が暗黙に開いていて、後続の closing event で精算される場合があります。

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
- `wait_ms` は `pre_tool_use` から計測を始め、対応する `post_tool_use`、`post_tool_use_failure`、`stop`、`stop_failure`、または `session_end` で待機時間を確定する
- Claude transcript の増分 state はローカル `CLIPULSE_STATE_DIR` にのみ保存され、リモート資産としては公開されない
- Codex の最初の snapshot は baseline を作るだけで、file delta は返さない
- ローカル snapshot は text file だけを走査し、`.git`、`.clipulse-private`、`.venv`、`.worktrees`、`.pytest_cache`、`.ruff_cache`、`.mypy_cache`、`__pycache__`、`.next`、`coverage`、`dist`、`build`、`node_modules` に加え、`.env*`、`credentials*`、`*.pem`、`*.key` のような一般的な機密パターンも無視する。`256 KiB` 超、極端に長い text file、binary byte を含む file もスキップされる
- Codex の file-delta 集計は依然として最小可用 heuristic であり、Bash が十分に単純で安全に candidate path を絞り込める場合だけ narrow する。`env` / `command` / `builtin` / `noglob` / `bash -lc` / `/bin/zsh -lc` のような単純 wrapper と `touch` / `cp` / `sed -i` / `tee` のような一般的な write command は軽量に扱う一方、pipe / redirection / subshell / semicolon chain / escaped-space path のような低信頼 Bash、`git diff`、`git show`、`sort`、`awk`、`cut`、`uniq` のような明確な read-only command、さらに `.venv/bin/python -m ...`、`python -m ...`、`python3 -m ...`、`tar`、`unzip`、`rsync`、`sort -o`、`perl -pi*`、`cmd /c`、`powershell -Command`、`pwsh -Command`、`sh.exe -c`、再帰的な `cp -r` / `cp -R` のように実際の書き込み面が広いか意味解釈が重い command では保守的に広めの snapshot 比較へ戻るが、正確な VCS diff ではない
- Codex の rename / move は現在 remove + add として集計され、file-level と directory-level の move も独立した rename event にはならない
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
- [ ] Gemini CLI / OpenCode の一級統合ドキュメント、例、より完全な host 契約

## 開発メモ
- 私的な調査、upstream メモ、競合分析は `.clipulse-private/` に置く
- `.clipulse-private/` はコミットしない
- この README では「今日すでに実装済みのこと」と「alpha+ で次にやること」を混同しない
