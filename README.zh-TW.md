# Clipulse

[简体中文](./README.md) | [English](./README.en.md) | [日本語](./README.ja.md)

Clipulse 是一個面向 coding-agent CLI 的自託管活動追蹤器。它把本地 hooks / plugin 事件整理成隱私友善的彙總報表、輕量 dashboard 和可嵌入 badge，同時預設不會上傳原始碼正文與 raw prompt。

## 你會得到什麼

- 自己掌控的 API、SQLite 與 dashboard
- session、專案、語言、模型、宿主與行變更摘要
- 對 `Claude Code`、`Codex` 的穩定支援
- 對 `Gemini CLI`、`OpenCode` 的可試實驗支援
- 可公開嵌入的 badge / README snippet，而不是整個私有 dashboard

## 支援狀態

- 當前一等支援：`Claude Code`、`Codex`
- 當前實驗性：`Gemini CLI`、`OpenCode`
- 部署姿勢：self-hosting first
- 產品邊界：beta-ready 的單使用者彙總，不做多租戶分析平台

## 執行前提

- `Node.js 22+`
- `npm 10+`
- `Python 3.12+`
- `uv`
- 目前仍以原始碼 checkout + 本地 build 為主

## 5 分鐘打進第一筆真實資料

1. 安裝依賴並建置：

```bash
npm install
npm run build
uv sync --group dev
```

2. 啟動 API：

```bash
export CLIPULSE_DATABASE_URL="sqlite+pysqlite:///$(pwd)/clipulse.sqlite3"
export CLIPULSE_STATE_DIR="/tmp/clipulse-state"
PYTHONPATH=apps/api uv run uvicorn clipulse_api.app:create_app --factory --host 127.0.0.1 --port 8000
```

3. 在第二個終端把穩定 adapter 指向 API，送出一筆真實 hook 事件：

```bash
export CLIPULSE_API_URL="http://127.0.0.1:8000"
ROOT="$(pwd)"
sed "s|__CODEX_SMOKE_PROJECT_ROOT__|$ROOT|g" packages/adapter-codex/examples/smoke/session-start.json \
  | node packages/adapter-codex/dist/cli.js
```

4. 打開 `http://127.0.0.1:8000/`。

- 如果沒有設定 `CLIPULSE_SERVER_TOKEN`，dashboard 會直接開啟。
- 如果設定了 `CLIPULSE_SERVER_TOKEN`，瀏覽器會先看到一次性登入頁。輸入同一個 token 後，服務端只會保存簽名 session cookie，不會把原始 API token 暴露給瀏覽器。
- smoke 事件成功入庫後，dashboard 應該能看到至少一條 session / project 記錄，而不是空白頁。

## 核心環境變數

- `CLIPULSE_API_URL`：adapter 投遞事件時使用的 API 位址
- `CLIPULSE_API_BEARER_TOKEN`：當 API 開啟保護時，adapter 使用的 bearer token
- `CLIPULSE_DATABASE_URL`：API 使用的 SQLite 路徑
- `CLIPULSE_STATE_DIR`：本地 spool、snapshot、session timing 狀態目錄
- `CLIPULSE_SERVER_TOKEN`：保護私有 dashboard 與 `/api/v1/*`
- `CLIPULSE_ENABLE_PUBLIC_READS=1`：顯式允許匿名存取 badge / README snippet
- `CLIPULSE_PUBLIC_BASE_URL`：受保護部署產生公開 README snippet 時必須設定

## 部署模式

### 私有 dashboard + 私有 API

把完整 dashboard 與 `/api/v1/*` 都放在私有面。

```bash
export CLIPULSE_SERVER_TOKEN="replace-with-a-long-random-token"
export CLIPULSE_API_BEARER_TOKEN="$CLIPULSE_SERVER_TOKEN"
```

- adapter 行程必須同時繼承 `CLIPULSE_API_URL` 與 `CLIPULSE_API_BEARER_TOKEN`
- 瀏覽器不會收到原始 API token；受保護 dashboard 透過一次性登入後換成服務端簽名 cookie

### 公開 badge / README snippet

建議做法：主實例保持私有，只把 badge/snippet 透過獨立公開出口、反代路徑分流，或單獨實例暴露出去。

- 公開面只需要 `/api/v1/badges/*` 與 `/api/v1/public/readme/*`
- 主實例上的 `/`、`/api/v1/*`、`/static/*`、`/contracts/*` 預設都應繼續保持私有
- 公開 snippet 時至少同時設定：

```bash
export CLIPULSE_ENABLE_PUBLIC_READS="1"
export CLIPULSE_PUBLIC_BASE_URL="https://clipulse.example"
```

- 受保護實例若缺少 `CLIPULSE_PUBLIC_BASE_URL`，README snippet 會回傳 `503`
- 如果沒開 `CLIPULSE_ENABLE_PUBLIC_READS`，匿名 badge / snippet 會回傳 `401`

## 運維快速檢查

先跑穩定面：

```bash
npm run smoke:stable
npm run smoke:experimental
```

下面這些命令用於診斷，不替代 smoke：

```bash
curl -i http://127.0.0.1:8000/healthz
curl http://127.0.0.1:8000/api/v1/status
node packages/collector-core/dist/cli.js doctor
node packages/collector-core/dist/cli.js pending
```

如果 dashboard 仍然空白，需要證明 ingest 已接通，可以再跑一次最小投遞：

```bash
curl -X POST "http://127.0.0.1:8000/api/v1/events/batch" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CLIPULSE_SERVER_TOKEN" \
  -d '{"events":[{"host":"codex","host_version":"0.1.0","session_id":"manual-check","project_root":"/tmp/demo","project_name":"demo","git_branch":"main","event_name":"session_start","event_time":"2026-04-14T12:00:00Z","model_name":"gpt-5.4","os_name":"macos","editor_or_terminal":"terminal","active_ms":1000,"wait_ms":0,"privacy_mode":"hashed","language_stats":{},"file_deltas":[]}]}'
```

## Adapter 接線

首跑最常見的失敗不是 hooks 沒觸發，而是 hooks / plugin 行程沒有繼承投遞環境變數。Clipulse adapter 只有在宿主行程拿到下面兩個變數時才會真正投到 API：

- `CLIPULSE_API_URL`
- 受保護部署下的 `CLIPULSE_API_BEARER_TOKEN`

穩定整合入口：

- [Claude adapter README](./packages/adapter-claude/README.md)
- [Claude canonical hooks](./packages/adapter-claude/hooks/hooks.json)
- [Codex adapter README](./packages/adapter-codex/README.md)
- [Codex canonical hooks](./packages/adapter-codex/examples/hooks.json)

實驗整合入口：

- `packages/adapter-gemini/dist/cli.js` 目前以 `SessionStart`、`BeforeTool`、`AfterTool`、`BeforeAgent`、`AfterAgent`、`SessionEnd` 為主
- [Gemini adapter README](./packages/adapter-gemini/README.md)
- [Gemini settings 範例](./packages/adapter-gemini/examples/.gemini/settings.json)
- [OpenCode adapter README](./packages/adapter-opencode/README.md)
- [OpenCode wrapper 範例](./packages/adapter-opencode/examples/clipulse.ts)

Gemini guardrail：

- `BeforeAgent` 與相容 alias `UserPromptSubmit` 不應在同一套接線裡同時保留

OpenCode guardrail：

- `session.diff` 仍透過 `CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF=1` 顯式 opt-in

## 隱私與安全

- 不上傳原始碼正文
- 不上傳 raw prompt / transcript 正文
- 公開 badge 暴露的是整套安裝實例的彙總，不是單專案私密視圖；決定公開前要明確接受這個邊界
- `.clipulse-private/`、SQLite、`CLIPULSE_STATE_DIR`、`.env*`、`credentials*`、`*.pem`、`*.key`、`*.p12`、`*.pfx` 都不應進入 GitHub

更完整的安全與部署說明見：

- [Security policy](./SECURITY.md)
- [自託管與接入指南](./docs/self-hosting-and-integration.md)
- [Support](./SUPPORT.md)

## 社群

- [Contributing](./CONTRIBUTING.md) `[English]`
- [Code of Conduct](./CODE_OF_CONDUCT.md) `[English]`
- [Security policy](./SECURITY.md) `[English]`
- [Support](./SUPPORT.md) `[English]`
- [Changelog](./CHANGELOG.md)
- [Issue templates](https://github.com/Boulea7/Clipulse/issues/new/choose)

## 深入文件

- [自託管與接入指南](./docs/self-hosting-and-integration.md)
- `/contracts/dashboard-compat.v1.json`
- [Claude adapter README](./packages/adapter-claude/README.md)
- [Codex adapter README](./packages/adapter-codex/README.md)
- [Gemini adapter README](./packages/adapter-gemini/README.md)
- [OpenCode adapter README](./packages/adapter-opencode/README.md)
