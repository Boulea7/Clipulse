# Clipulse

[简体中文](./README.md) | [English](./README.en.md) | [日本語](./README.ja.md)

Clipulse 是一個面向 `Claude Code`、`Codex` 等 coding agent CLI 的輕量活動追蹤器，目前的 alpha+ 版本優先服務自託管、重隱私、終端優先的使用情境。

它不是要複刻 WakaTime API，也不打算把 agent 工作流包成大型 SaaS。現在更務實的實作目標是：
- 自己部署 API、SQLite 與 dashboard
- 透過 plugin / hooks 蒐集 session、專案、語言、模型、主機與檔案變更摘要
- 在不上傳原始碼正文與 raw prompt 的前提下提供 README badge 與輕量報表

## Alpha+ 範圍
- 首批正式支援：`Claude Code`、`Codex`
- 下一階段：`Gemini CLI`、`OpenCode`
- 部署方式：self-hosting first
- 資料邊界：預設只上傳標準化事件與檔案變更摘要，不上傳原始碼正文與 raw prompt
- 產品邊界：alpha+ 先聚焦單使用者、本地優先、輕量匯總，不引入複雜認證、多租戶或遠端程式碼儲存

## 目前已可用
- `Claude Code` 與 `Codex` 轉接器都能建出真實的 `dist/cli.js`
- 支援 `CLIPULSE_API_URL` 直接上報
- API 不可用時，事件會先緩存在本機狀態目錄，並在下次優先補發 backlog
- ingest 現在會回傳輕量的逐事件結果，adapter 可以只重試仍可重試的子集，而不是整批反覆重送
- partial delivery outcome 現在會優先按穩定 `event_id` 對回應結果回配，再退回批次順序，因此未確認結果會保留為可重試子集，而不是被誤判
- `Claude Code` 轉接器會用本機 transcript cursor 增量解析新紀錄，避免每個 hook 都全量重掃 transcript
- `Claude Code` 現在也會在 compact / transcript 回退後重建本機基線，抑制空的 `PreToolUse` 噪音事件，過濾零行變更 patch，並在 `stop` / `session_end` / `pre_compact` 時清理同一 session 下不同 transcript 路徑的狀態
- `Claude Code` 在 `UserPromptSubmit` 沒有檔案變更時，也會保留一次 project-level activity
- `Claude Code` 與 `Codex` 都會嘗試從本機 Git 上下文補齊更穩定的 `project_root`、`project_name` 與 `git_branch`
- FastAPI + SQLite 已提供 overview、timeseries、language/model/host breakdown、`projects/top`、`sessions/recent`、`sessions/{session_id}`、`projects/{project_ref}/sessions` 與多個 badge / README snippet
- 最近 session 清單與 project session 清單現在會按邏輯 session 聚合，因此同一 session 中途切換 host / model 時不再被拆成多行
- project detail 現在會和 session detail 一樣提供緊湊 summary 欄位，包括 changed files、changed languages、line changes、top language 與 host-model mix
- dashboard 已展示總覽、今日/本週時長、語言、模型、主機、專案榜單、最近 session、7 日 activity，並支援 hash 驅動的 session / project detail、branch context，以及緊湊的 changed files / changed languages / line changes 摘要

## Alpha+ 正在對齊的實作目標
- 保持「自託管 + 本地狀態目錄 + 輕量 API」主線，不額外導入佇列服務
- 繼續收緊 Codex 檔案變更 heuristic，降低 snapshot diff 噪音與掃描範圍
- 持續擴充更有價值的 summary-first 報表，而不是直接走向複雜 BI

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

常用環境變數：
- `CLIPULSE_API_URL`，例如 `http://127.0.0.1:8000`
- `CLIPULSE_STATE_DIR`，本機狀態目錄；未設定時會回退到 `XDG_STATE_HOME/clipulse` 或 `~/.local/state/clipulse`

建議先啟動 API，再接 hooks：

```bash
PYTHONPATH=apps/api uv run uvicorn clipulse_api.app:create_app --factory --host 0.0.0.0 --port 8000
```

## 本機狀態目錄結構
目前 alpha+ 會在 `CLIPULSE_STATE_DIR` 下維護這些內容：

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

用途說明：
- `sessions/`: 保存 session timing 的本機中間狀態，用來估算 `active_ms` 與 `wait_ms`
- `snapshots/`: 保存按 session 劃分的專案文字快照，供 Codex 在 hook 中繼資料不足時做本機 diff fallback
- `spool/`: 保存待補發事件批次；送出時會優先 flush `ready/` backlog
- backlog 在補發前會按穩定 `event_id` 做機會式去重，降低重複噪音
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
5. 安裝或打包時，必須讓 `${CLAUDE_PLUGIN_ROOT}/dist/cli.js` 可用；也就是 `dist/cli.js` 要位於最終 plugin 根目錄下
6. 設定環境變數：

```bash
export CLIPULSE_API_URL="http://127.0.0.1:8000"
export CLIPULSE_STATE_DIR="$HOME/.local/state/clipulse"
```

### Codex
1. 在倉庫裡執行 `npm run build`
2. 參考 `packages/adapter-codex/examples/hooks.json`
3. 將命令路徑指向 `packages/adapter-codex/dist/cli.js`
4. 同樣設定 `CLIPULSE_API_URL` 與可選的 `CLIPULSE_STATE_DIR`

## 專案 / Session 視圖現狀
目前 API 與 dashboard 已經提供輕量 drill-down：
- `GET /api/v1/projects/top`：回傳專案匯總與 `project_ref`
- `GET /api/v1/sessions/recent`：回傳最近 session 匯總與 `project_ref`
- `GET /api/v1/sessions/{session_id}`：回傳 session 基本資訊、active / wait 匯總、事件數、語言匯總、檔案變更摘要，以及 changed files / changed languages / line changes / top language 等緊湊摘要欄位
- `GET /api/v1/projects/{project_ref}/sessions`：回傳專案最近 session 清單與專案級匯總

目前 detail 仍是「summary-first」視圖，不是完整事件時間線。

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
- 如果 Claude 在 compact 或 transcript 輪換後看起來還殘留舊狀態，請確認安裝的是最新 build，這一版會清理同一 session 下不同 transcript 路徑的狀態檔。

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
- `wait_ms` 只在 `pre_tool_use -> post_tool_use` 之間按時間差計算
- Claude transcript 增量狀態只保存在本機 `CLIPULSE_STATE_DIR`，不會作為遠端資產暴露
- Codex 的 snapshot diff 第一次只建立基線，不會回傳檔案 delta
- 本機 snapshot 只掃描文字檔，並忽略 `.git`、`.clipulse-private`、`.venv`、`.worktrees`、`.pytest_cache`、`.ruff_cache`、`.mypy_cache`、`coverage`、`dist`、`build`、`node_modules`；大於 `256 KiB`、超長文字或帶有二進位位元組的檔案會跳過
- Codex 檔案變更統計目前是「最小可用 heuristic」，會優先利用 Bash 命令中的候選路徑收窄範圍，但不是精確 VCS diff
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
- [ ] Gemini CLI 與 OpenCode 適配

## 開發約定
- 私有研究、上游參考、競品分析放在 `.clipulse-private/`
- `.clipulse-private/` 永不提交到 GitHub
- 這份 README 應優先描述「已實作」與「alpha+ 下一步」，避免把規劃寫成既成事實
