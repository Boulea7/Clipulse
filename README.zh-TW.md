# Clipulse

[简体中文](./README.md) | [English](./README.en.md) | [日本語](./README.ja.md)

Clipulse 是一個面向 `Claude Code`、`Codex` 等 coding agent CLI 的輕量活動追蹤器，目前的 alpha+ 版本優先服務自託管、重隱私、終端優先的使用情境。

它不是要複刻 WakaTime API，也不打算把 agent 工作流包成大型 SaaS。現在更務實的實作目標是：
- 自己部署 API、SQLite 與 dashboard
- 透過 plugin / hooks 蒐集 session、專案、語言、模型、主機與檔案變更摘要
- 在不上傳原始碼正文與 raw prompt 的前提下提供 README badge 與輕量報表

## Alpha+ 範圍
- 首批正式支援：`Claude Code`、`Codex`
- 目前可試接入但仍屬實驗性：`Gemini CLI`、`OpenCode`
- 後續再推進到一等穩定支援：`Gemini CLI`、`OpenCode`
- 部署方式：self-hosting first
- 資料邊界：預設只上傳標準化事件與檔案變更摘要，不上傳原始碼正文與 raw prompt
- 產品邊界：alpha+ 先聚焦單使用者、本地優先、輕量匯總，不引入複雜認證、多租戶或遠端程式碼儲存

## 目前已可用
- `Claude Code` 與 `Codex` 轉接器都能建出真實的 `dist/cli.js`
- 倉庫現在也帶有可試接入的實驗性 `Gemini CLI` hooks-first 入口（`packages/adapter-gemini/dist/cli.js`）與 `OpenCode` plugin/event-first 橋接入口（`packages/adapter-opencode/dist/plugin.js`）；兩者都已納入建置與 fixture / contract 驗證，但仍未達到 `Claude Code` / `Codex` 同級的穩定承諾
- 支援 `CLIPULSE_API_URL` 直接上報
- API 不可用時，事件會先緩存在本機狀態目錄，並在下次優先補發 backlog
- ingest 現在會回傳輕量的逐事件結果，adapter 可以只重試仍可重試的子集，而不是整批反覆重送
- partial delivery outcome 現在會優先按穩定 `event_id` 對回應結果回配，再退回批次順序，因此未確認結果會保留為可重試子集，而不是被誤判；API 端在回退產生 `event_id` 時，也會先規範化等價 UTC 時間表示，避免同一事件只因 `Z` / `+00:00` 寫法不同就被拆成兩條
- `Claude Code` 轉接器會用本機 transcript cursor 增量解析新紀錄，避免每個 hook 都全量重掃 transcript
- `Claude Code` 現在也會在 compact / transcript 回退後重建本機基線，抑制空的 `PreToolUse` 噪音事件，過濾零行變更 patch，並在 `stop` / `stop_failure` / `session_end` / `pre_compact` 時清理同一 session 下不同 transcript 路徑的狀態
- `Claude Code` 在 `UserPromptSubmit` 沒有檔案變更時，也會保留一次 project-level activity
- `Claude Code` 與 `Codex` 都會嘗試從本機 Git 上下文補齊更穩定的 `project_root`、`project_name` 與 `git_branch`
- FastAPI + SQLite 已提供 overview、timeseries、language/model/host breakdown、`projects/top`、`sessions/recent`、`sessions/{session_id}`、`projects/{project_ref}`、`projects/{project_ref}/sessions` 與多個 badge / README snippet
- FastAPI 現在也提供 `GET /api/v1/status`，方便快速查看自託管場景下的 API / DB / 本機 spool 狀態，包括隊列計數、占用位元組數與 backlog / quarantine 的最老年齡
- 最近 session 清單與 project session 清單現在會按邏輯 session 聚合，因此同一 session 中途切換 host / model 時不再被拆成多行
- project detail 現在會和 session detail 一樣提供緊湊 summary 欄位，包括 changed files、changed languages、line changes、top language 與 host-model mix
- dashboard 已展示總覽、今日/本週時長、語言、模型、主機、專案榜單、最近 session、7 日 activity，並支援 hash 驅動的 session / project detail、session branch context、breadcrumb 導航、heuristic 提示，以及緊湊的 changed files / changed languages / line changes 摘要
- dashboard detail 現在會優先依賴 dedicated detail endpoint，而不是把 `projects/top` / `sessions/recent` 當成前置條件；home 也會更明確提示 `/api/v1/status` 載入失敗
- `ready/processing` backlog 現在也會在本機按年齡與總大小做輕量約束；過舊或被 size cap 擠出的批次會進入 `spool/quarantine/`，並附上 sidecar metadata 供排障
- backlog sidecar metadata 現在也會保留 `first_seen_at`、`attempt_count` 與 `last_attempted_at`，避免 `processing -> ready` 恢復或本機隔離時把同一批次誤看成「全新問題」
- 本機 spool sidecar 現在也會盡量保留仍然有效的 lineage 欄位；孤兒 `.meta.json` bookkeeping 檔不會再把當前批次誤判成「還有 payload backlog 沒清完」
- `collector-core` 現在也帶一個極小的本機 operator CLI，且目前刻意只保留 `node packages/collector-core/dist/cli.js doctor` / `pending` 兩個只讀命令，可檢查 spool payload、orphan sidecar、quarantine reason，並更明確提示 processing-only / quarantine-only / orphan-only backlog，以及 `stale_backlog` / `spool_size_cap` 這類保留策略線索
- dashboard 啟動與切換 deep link 時，現在會把 loading 與 failure 文案分開；project 頁的 sessions 區域也會保持 project-scoped，不再回退顯示無關的全域 recent sessions；若只有 project sessions 子請求失敗，project detail 仍會保留顯示，unscoped session deep link 在 detail lookup 成功後也會規範化回 project-scoped hash，home detail 裡的 queue backlog 行會補充最老 quarantine 年齡，而 queue storage 也會更明確標示它展示的是 payload spool bytes
- session / project detail 現在也會更自然說明 `fingerprint` 是隱私安全識別，而不是實際路徑或原始碼片段；若 session 沒有 file delta，也會提示這可能只是 prompt-only activity、只讀命令，或 Codex 第一次 snapshot baseline 尚未產生 delta

## Alpha+ 正在對齊的實作目標
- 保持「自託管 + 本地狀態目錄 + 輕量 API」主線，不額外導入佇列服務
- 繼續收緊 Codex 檔案變更 heuristic，降低 snapshot diff 噪音與掃描範圍
- 持續擴充更有價值的 summary-first 報表，而不是直接走向複雜 BI
- 讓 `Gemini CLI` 維持 hooks-first、`OpenCode` 維持 plugin/event-first 的最小腳手架，避免在宿主契約尚未穩定前過度擴張

## 快速啟動
```bash
npm install
npm run build
uv sync --group dev
PYTHONPATH=apps/api uv run uvicorn clipulse_api.app:create_app --factory --reload
```

打開 `http://127.0.0.1:8000/` 查看 dashboard。

## 自託管與儲存
預設資料庫檔案是倉庫根目錄下的 `clipulse.sqlite3`。

更完整的長期運行、自託管接入、示例 payload 與排障說明見 [docs/self-hosting-and-integration.md](./docs/self-hosting-and-integration.md)。

常用環境變數：
- `CLIPULSE_API_URL`，例如 `http://127.0.0.1:8000`
- `CLIPULSE_STATE_DIR`，本機狀態目錄；未設定時會回退到 `XDG_STATE_HOME/clipulse` 或 `~/.local/state/clipulse`

建議先啟動 API，再接 hooks：

```bash
PYTHONPATH=apps/api uv run uvicorn clipulse_api.app:create_app --factory --host 0.0.0.0 --port 8000
```

本機排障時也可以直接執行：

```bash
node packages/collector-core/dist/cli.js doctor
node packages/collector-core/dist/cli.js pending
```

如果 `CLIPULSE_STATE_DIR` 對應路徑還不存在，這兩個命令也只會檢查該路徑，不會為了排障而建立目錄。

最小 smoke 流程：

```bash
curl -i http://127.0.0.1:8000/healthz
curl http://127.0.0.1:8000/api/v1/status
node packages/collector-core/dist/cli.js doctor
node packages/collector-core/dist/cli.js pending
```

- `/healthz` 只做 liveness，成功時應回傳 `204`
- `/api/v1/status` 才是自託管排障狀態面；目前沒有獨立的 readiness probe，也不建議把它當成高頻負載平衡 readiness 探針
- `doctor` / `pending` 都是只讀 smoke，不會建立缺失的狀態目錄，也不會改動 backlog

## 本機狀態目錄結構
目前 alpha+ 會在 `CLIPULSE_STATE_DIR` 下維護這些內容：

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

用途說明：
- `sessions/`: 保存 session timing 的本機中間狀態，用來估算 `active_ms` 與 `wait_ms`
- `snapshots/`: 保存按 session 劃分的專案文字快照，供 Codex 在 hook 中繼資料不足時做本機 diff fallback
- `claude-transcripts/`: 保存 Claude transcript cursor 的本機狀態
- `spool/`: 保存待補發事件批次；送出時會優先 flush `ready/` backlog
- backlog 在補發前會按穩定 `event_id` 做機會式去重，降低重複噪音
- `spool/quarantine/` 現在會同時保留不可自動重試或被本機 age/size cap 隔離的 payload 與同名 `.meta.json` 說明檔；可重試子集會繼續留在 `ready/`
- `ready/`、`processing/`、`quarantine/` 三個 spool 狀態目錄都可能出現同名 `.meta.json` sidecar，用來保留本地 lineage 與排障欄位
- `ready/` 與 `processing/` backlog 也會套用本機年齡與總大小約束；本地 sidecar metadata 會延續 `first_seen_at` / `attempt_count` / `last_attempted_at`，quarantine sidecar 則可能再補充 `source_state`、`approx_bytes` 等欄位
- 如果 sidecar 只有部分欄位損壞，Clipulse 現在會盡量保留仍然有效的 lineage 欄位，而不是把整批本機 backlog 重置成「全新問題」
- hooks 執行時會機會式清理舊的 `tmp` / `quarantine` / `sessions` / `snapshots` 狀態，並在 `stop` 後移除當前 session 的中間檔

## 隱私邊界
- 不上傳原始碼正文
- 不上傳原始 prompt / transcript 正文
- 檔案層只上傳標準化 delta 與 privacy-safe fingerprint，而不是完整路徑內容
- `snapshots/`、`sessions/`、`spool/` 只保存在本機狀態目錄，不會作為原始碼內容上傳
- `.clipulse-private/` 只用於本地研究與私有筆記，預設不提交

## 接入說明
### Claude Code
1. 在倉庫裡執行 `npm run build`
2. 將 `packages/adapter-claude/.claude-plugin/` 視為 Claude plugin 目錄
3. 該 plugin 根目錄中的 `plugin.json` 會引用 `./hooks/hooks.json`
4. 本地開發或驗證時，請按 plugin 目錄方式載入，例如 `claude --plugin-dir /abs/path/to/packages/adapter-claude`
5. 安裝或打包時，必須讓最終 `${CLAUDE_PLUGIN_ROOT}` 同時暴露 `hooks/` 與 `dist/cli.js`；倉庫中的 manifest 放在 `.claude-plugin/` 下，但真正安裝的 plugin root 必須包含執行所需檔案
6. 設定環境變數：

```bash
export CLIPULSE_API_URL="http://127.0.0.1:8000"
export CLIPULSE_STATE_DIR="$HOME/.local/state/clipulse"
```

### Codex
1. 在倉庫裡執行 `npm run build`
2. 參考 `packages/adapter-codex/examples/hooks.json`；這份 checked-in 範例就是目前的 canonical wiring source，其中至少接上了 `SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`Stop` 這組常見成功路徑 hooks，且同一份範例也保留了 `SessionEnd` 作為 cleanup / teardown 邊界
3. 如果宿主還提供 `PostToolUseFailure` / `StopFailure` 這類 failure-path hooks，也建議一併接上；Clipulse 會用它們更完整地結算 `wait_ms`
4. 將命令路徑指向 `packages/adapter-codex/dist/cli.js`
5. 同樣設定 `CLIPULSE_API_URL` 與可選的 `CLIPULSE_STATE_DIR`
- 對 Codex 而言，zero-delta 事件仍可能是正常情況，例如 prompt-only activity、只讀命令，或第一次 snapshot baseline 只建立本機基線但尚未產生 delta

### Gemini CLI / OpenCode
- `packages/adapter-gemini/dist/cli.js` 現已提供可試接入的 hooks-first 入口，目前以官方 `SessionStart`、`SessionEnd`、`BeforeTool`、`AfterTool`、`BeforeAgent`、`AfterAgent` surface 為主。
- `packages/adapter-gemini` 目前會復用共享 project context / timing，並把 `AfterAgent` 與 prompt submit 分開處理；只有在官方 `write_file` / `replace` payload 明確提供檔案路徑時才產出最小 file delta，也明確維持 `AfterModel` 不接入。`SessionEnd` 仍只是 best-effort 的 stop/cleanup fallback，不是可靠 barrier。`AfterToolFailure`、`UserPromptSubmit` 若被接受，也只是相容 alias，不是主契約，也不代表會得到與官方 hook surface 等價的 file-delta 行為。
- `packages/adapter-gemini/examples/.gemini/settings.json` 現在是包內 checked-in 的官方 Gemini hook wiring 範例來源，頂層文件以它為準，不再維護第二份 JSON 真相。
- `packages/adapter-opencode/dist/plugin.js` 目前仍是一個薄的 bridge 入口，而不是可直接落地的完整 plugin；推薦的可試接入方式仍是本地 wrapper，例如 `packages/adapter-opencode/examples/clipulse.ts`，用來按目前選定子集轉發 `session.created` / `session.deleted` / `session.idle` / `session.error`、命名 `tool.execute.before` / `tool.execute.after` / `tool.execute.error`，以及 `file.edited`。這份 checked-in wrapper 範例也是目前的 canonical wiring source。
- `packages/adapter-opencode` 目前仍只把顯式 `file.edited` 視為高置信 delta 來源；若官方 `file.edited` 只提供路徑，Clipulse 也只會先記錄 path-only delta，不抓 transcript、不接 server API，也不直接吞整條 message/TUI event 流。
- OpenCode 上游也提供 `session.diff`，但 Clipulse 目前預設不消費它，因為它是累積式 snapshot surface，並且帶有原始 `before` / `after` 文字；接入前需要額外的隱私剝離與去重策略。若你明確設定 `CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF=1`，倉庫內 wrapper 範例會做 wrapper-only 的 post-turn backfill，但仍只會轉發最小 `{ path, additions, deletions }`，並跳過同一緩衝階段中已由 `file.edited` 命中的路徑；目前 wrapper 也會先兼容上游 `file` / `path` 與 `added` / `removed`、`additions` / `deletions` 這些 shape alias，再統一歸一化成最小轉發形狀；只有在 wrapper 當前恰好只追蹤一個 live session 時，才允許無 `sessionID` 的 gated fallback。
- 這兩個轉接器目前都屬於「可試接入但仍實驗性」階段：已可建置、可跑 fixture / contract test，也已有最小自託管 wiring 說明，但仍未達到與 `Claude Code` / `Codex` 同級的穩定承諾。

## 專案 / Session 視圖現狀
目前 API 與 dashboard 已經提供輕量 drill-down：
- `GET /api/v1/projects/top`：回傳專案匯總與 `project_ref`
- `GET /api/v1/sessions/recent`：回傳最近 session 匯總與 `project_ref`
- `GET /api/v1/sessions/{session_id}`：回傳 session 基本資訊、active / wait 匯總、事件數、語言匯總、檔案變更摘要，以及 changed files / changed languages / line changes / top language 等緊湊摘要欄位
- `GET /api/v1/projects/{project_ref}`：回傳專案級 detail，和 session detail 一樣是 summary-first 視圖
- `GET /api/v1/projects/{project_ref}/sessions`：只回傳該專案下的緊湊 session 清單，不再混帶專案 detail 主體
- `GET /healthz`：只回傳 `204 No Content` 的活性探針，不攜帶 API / DB / spool 細節
- `GET /api/v1/status`：回傳 schema-backed 的最小 `api` / `db` / `spool` 自託管狀態，包括隊列計數、位元組數與最老 backlog / quarantine 年齡；計數與位元組數只統計 payload `.json`

目前 detail 仍是「summary-first」視圖，不是完整事件時間線。

相容性說明：
- `GET /api/v1/projects/{project_ref}/sessions` 已收斂為 compact session list；專案 detail 請改讀 `GET /api/v1/projects/{project_ref}`
- 三個 list endpoint 在 `limit <= 0` 時都會穩定回傳空 `items`
- 當同一個 `session_id` 同時命中多個專案時，`GET /api/v1/sessions/{session_id}` 必須帶 `?project_ref=...`，否則會回傳帶 `code` 與 `hint` 的 `409`
- session 聚合與查找實際上按 `(project_root, session_id)` scope 處理，因此 project-scoped 連結比裸 `session_id` 更穩定
- 同一個 `project_root` 即使後續上報了不同的 `project_name`，project 路由與 session detail 也會固定使用同一個 canonical `project_name`
- detail / list payload 現在也會區分 `host_model_primary` 與明確的 `last_*` host/model/branch 欄位，並在 preview 省略額外變更檔案時回傳 `file_preview_truncated_count`
- `sessions/recent` 與 `projects/{project_ref}/sessions` 的預設 payload 目前仍保留完整 `host_model_mix`，這是現階段的相容性契約；第一方 dashboard list 主要依賴 `host_model_primary` 與 `host_model_mix_count`，未來若要瘦身，會走明確的相容遷移，而不是靜默修改預設回應
- `sessions/recent?compact=true` 與 `projects/{project_ref}/sessions?compact=true` 現在就是顯式 opt-in 的 list 瘦身路徑；它們會省略 `host_model_mix`，但保留 `host_model_primary` 與 `host_model_mix_count`

`file_preview` 與 `fingerprint` 也是隱私邊界的一部分：
- `file_preview` 只顯示變更趨勢摘要，不顯示原始碼正文
- `fingerprint` 是穩定標識，不是專案內真實路徑回顯

探針角色說明：
- `GET /healthz` 只確認進程是否活著，成功時回傳 `204`
- `GET /api/v1/status` 才是 dashboard 與自託管排障使用的狀態面
- 目前沒有獨立的 readiness probe；如果 API 仍可回應，應優先查看 `/api/v1/status`，而不是把 `/healthz` 當成「資料庫與 spool 都已就緒」的證明

示例 `status` 回應：

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

示例歧義 session `409`：

```json
{
  "detail": {
    "code": "ambiguous_session",
    "message": "session_id matched multiple projects",
    "hint": "Retry with the matching project_ref from /api/v1/projects/top or /api/v1/sessions/recent."
  }
}
```

示例 batch payload：

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
- 同一邏輯 session 若只是 host 或 model 切換，最近 session 不應再拆行；若仍看到重複，請先確認事件是否其實來自不同的 `project_root`。
- Codex 第一次基於 snapshot 的捕捉若沒有回傳 file delta，這是預期行為，因為第一次只建立本機基線。
- 如果直連上報失敗，可檢查 `CLIPULSE_STATE_DIR/spool/ready`；Clipulse 會在下一次 hook 觸發時優先重試未確認完成的事件。
- 如果 `spool/quarantine/` 有內容，先看同名 `.meta.json`；被隔離的可能是不可自動重試子集，也可能是被本機 age/size cap 收口的 backlog。
- 常見 quarantine reason 目前包括 `http_error`、`invalid_results`、`recovery_failed`、`invalid_spool_payload`、`stale_backlog`、`spool_size_cap`；其中 `stale_backlog` / `spool_size_cap` 會保留原 backlog 的 `first_seen_at` 與 `attempt_count`。
- 如果 dashboard 提示 API / DB / spool 有異常，可直接查看 `GET /api/v1/status`，先確認本機 backlog 是否還堆在 `ready` / `processing` / `quarantine`，再結合位元組數與最老年齡判斷是暫時堆積還是已被本機隔離。
- 如果 `CLIPULSE_STATE_DIR` 還不存在，`GET /api/v1/status` 會回傳歸零的 spool 計數，而不是報錯。
- 如果你更習慣終端排障，也可以跑 `node packages/collector-core/dist/cli.js doctor` 或 `pending`；本機 operator surface 目前刻意只保留這兩個只讀命令；如果 state dir 還不存在，它們也只會檢查路徑而不會建立目錄。`doctor` 現在也會補充 quarantine-only、orphan-only，以及 `stale_backlog` / `spool_size_cap` 這類 retention 線索。
- 除了 `409 ambiguous_session`，錯誤的 project scope 也會穩定回傳 `404 project_not_found`；未知 session 會回傳 `404 session_not_found`。
- 如果 Claude 在 compact 或 transcript 輪換後看起來還殘留舊狀態，請確認安裝的是最新 build，這一版會清理同一 session 下不同 transcript 路徑的狀態檔；空的 `PreToolUse` 即使被抑制為無噪音事件，也仍可能已經隱式打開 wait，並在後續關閉事件裡結算。

## Dashboard Walkthrough
- 首先在首頁看總覽、專案榜單與最近 session。
- 點進專案會看到 project detail 與 breadcrumb 導航。
- 專案頁裡的 sessions 卡片現在會切到該專案自己的 compact session 清單，而不是繼續顯示全域 recent sessions。
- 再點最近 session 進入 session detail，查看 host / model / branch / changed files / languages / line changes。
- 頁面上的 `active`、`wait`、`line changes`、`host-model mix` 都是本機 summary/heuristic，適合日常觀察，不是精確審計流水。

## Badge 與 README 片段
目前 badge 介面包括：
- `GET /api/v1/badges/top-language.svg`
- `GET /api/v1/badges/today-time.svg`
- `GET /api/v1/badges/this-week-time.svg`

README 可直接嵌入：

```md
![Clipulse Top Language](https://your-domain.example/api/v1/badges/top-language.svg)
![Clipulse Today Time](https://your-domain.example/api/v1/badges/today-time.svg)
![Clipulse This Week Time](https://your-domain.example/api/v1/badges/this-week-time.svg)
```

目前公開片段介面包括：

```bash
curl https://your-domain.example/api/v1/public/readme/top-language
curl https://your-domain.example/api/v1/public/readme/today-time
curl https://your-domain.example/api/v1/public/readme/this-week-time
```

回傳格式：

```json
{"markdown":"![Clipulse Top Language](https://your-domain.example/api/v1/badges/top-language.svg)"}
```

## 目前 heuristic 與限制
- `active_ms` / `wait_ms` 是基於 hook-gap 的 heuristic，不是精準前景活動時間
- 非等待場景下，單次 `active_ms` 最多只計到 `15_000` ms
- `wait_ms` 會從 `pre_tool_use` 開始計時，並在匹配的 `post_tool_use`、`post_tool_use_failure`、`stop`、`stop_failure` 或 `session_end` 到來時結算
- Claude transcript 增量狀態只保存在本機 `CLIPULSE_STATE_DIR`，不會作為遠端資產暴露
- Codex 的 snapshot diff 第一次只建立基線，不會回傳檔案 delta
- 本機 snapshot 只掃描文字檔，並忽略 `.git`、`.clipulse-private`、`.venv`、`.worktrees`、`.pytest_cache`、`.ruff_cache`、`.mypy_cache`、`__pycache__`、`.next`、`coverage`、`dist`、`build`、`node_modules`，以及常見敏感檔案樣式如 `.env*`、`credentials*`、`*.pem`、`*.key`；大於 `256 KiB`、超長文字或帶有二進位位元組的檔案會跳過
- Codex 檔案變更統計目前是「最小可用 heuristic」：只有 Bash 足夠簡單、且能安全收窄 candidate path 時才會做窄範圍 snapshot；對 `env` / `command` / `builtin` / `noglob` / `bash -lc` / `/bin/zsh -lc` 這類簡單 wrapper，以及 `touch` / `cp` / `sed -i` / `tee` 這類常見寫命令，仍會保留輕量支援；遇到 pipe / redirection / subshell / semicolon chain / escaped-space path 等低信心 Bash，或 `git diff`、`git show`、`sort`、`awk`、`cut`、`uniq` 這類明顯只讀命令，以及 `.venv/bin/python -m ...`、`python -m ...`、`python3 -m ...`、`tar`、`unzip`、`rsync`、`sort -o`、`perl -pi*`、`cmd /c`、`powershell -Command`、`pwsh -Command`、`sh.exe -c`、遞迴 `cp -r` / `cp -R` 這類真實寫面較寬或語義隱藏較深的命令時，會保守回退到較廣的 snapshot 比較，但仍不是精確 VCS diff
- Codex 的 rename / move 目前明確按 remove + add 匯總，檔案級與目錄級 move 都不會作為獨立 rename 事件暴露
- session / project detail 目前是聚合摘要，不提供完整事件時間線
- 目前仍不做認證、多使用者隔離與遠端程式碼內容儲存

## 路線圖
- [x] 統一事件模型與批次上報
- [x] Claude Code plugin / hooks 首版適配
- [x] Codex hooks 首版適配
- [x] FastAPI ingest / overview / breakdown / badge API
- [x] 專案榜單與最近 session 匯總
- [x] 輕量 dashboard
- [x] session / project detail drill-down
- [x] 本地狀態目錄 pruning 策略
- [ ] 更細緻的時間估算與更低開銷的 Codex 檔案變更策略
- [ ] Gemini CLI / OpenCode 一等整合文檔、示例與更完整宿主契約

## 開發約定
- 私有研究、上游參考、競品分析放在 `.clipulse-private/`
- `.clipulse-private/` 永不提交到 GitHub
- 這份 README 應優先描述「已實作」與「alpha+ 下一步」，避免把規劃寫成既成事實
