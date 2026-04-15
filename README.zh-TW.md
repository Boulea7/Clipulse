# Clipulse

[简体中文](./README.md) | [English](./README.en.md) | [日本語](./README.ja.md)

[![Beta Checks](https://github.com/Boulea7/Clipulse/actions/workflows/beta-checks.yml/badge.svg)](https://github.com/Boulea7/Clipulse/actions/workflows/beta-checks.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-0f766e.svg)](./LICENSE)
[![Python 3.12+](https://img.shields.io/badge/python-3.12%2B-1d4ed8.svg)](./pyproject.toml)
[![Node 22+](https://img.shields.io/badge/node-22%2B-111827.svg)](./package.json)

Clipulse 是一個面向 coding-agent CLI 的自託管活動追蹤器。它把本地 hooks / plugin 事件整理成隱私友好的匯總報表、輕量 dashboard 與 README 可嵌入 badge，預設不上传原始碼正文與 raw prompt。

## 為什麼用 Clipulse

- API、SQLite 與 dashboard 都掌握在自己手上。
- 追蹤 active time、wait time、file delta、語言、模型與 host mix。
- 穩定支援 `Claude Code`、`Codex`。
- 以更窄的實驗邊界支援 `Gemini CLI`、`OpenCode`。
- 需要公開面時，只暴露 badge / README snippet，不公開整套私有 dashboard。

## 目前狀態

- 當前一等支援：`Claude Code`、`Codex`
- 當前實驗支援：`Gemini CLI`、`OpenCode`
- 部署形態：self-hosted、單使用者、SQLite
- 目前可寫部署邊界：一個 SQLite 檔案只配一個 Clipulse API 進程
- 診斷命令：`/healthz`、`/api/v1/status`、`doctor`、`pending`

## 快速開始

### 需求

- `Node.js 22+`
- `npm 10+`
- `Python 3.12+`
- `uv`

### 1. 安裝並建置

```bash
npm install
npm run build
uv sync --group dev
```

### 2. 啟動 Clipulse

```bash
export CLIPULSE_DATABASE_URL="sqlite+pysqlite:///$(pwd)/clipulse.sqlite3"
export CLIPULSE_STATE_DIR="/tmp/clipulse-state"
PYTHONPATH=apps/api uv run python -m clipulse_api.migrate upgrade "$CLIPULSE_DATABASE_URL"
PYTHONPATH=apps/api uv run uvicorn clipulse_api.app:create_app --factory --host 127.0.0.1 --port 8000
```

### 3. 打進第一筆真實事件

```bash
export CLIPULSE_API_URL="http://127.0.0.1:8000"
ROOT="$(pwd)"
sed "s|__CODEX_SMOKE_PROJECT_ROOT__|$ROOT|g" packages/adapter-codex/examples/smoke/session-start.json \
  | node packages/adapter-codex/dist/cli.js
```

### 4. 打開 dashboard

訪問 `http://127.0.0.1:8000/`。

- 沒設 `CLIPULSE_SERVER_TOKEN` 時，dashboard 直接打開。
- 設了 `CLIPULSE_SERVER_TOKEN` 時，瀏覽器會先看到登入頁。
- dashboard cookie 現在是只讀瀏覽器會話；寫入類 API 仍然必須使用 `Authorization: Bearer`。

## 部署面

### 原始碼 checkout

對開發者與大多數 operator，原始碼 checkout 仍然是最直接的路徑：

- 建置倉庫
- 先跑 `clipulse_api.migrate upgrade`
- 再啟動 `uvicorn`

### Python release artifact

`npm run check:py-build` 現在會構建帶完整 dashboard 資源的 Python `sdist` / `wheel`，其中包含：

- FastAPI backend
- `/static/*` 所需 dashboard 資源
- `/contracts/*` 所需相容契約

`npm run check:py-install-smoke` 會把 wheel 安裝進乾淨虛擬環境，拉起真實本地服務，並對它跑一遍 `smoke:deployment`。

### 公開 badge / README 路由

如果需要公開面，建議主實例繼續保持私有，只公開：

- `/api/v1/badges/*`
- `/api/v1/public/readme/*`

同時設定：

```bash
export CLIPULSE_ENABLE_PUBLIC_READS="1"
export CLIPULSE_PUBLIC_BASE_URL="https://clipulse.example"
```

`CLIPULSE_PUBLIC_BASE_URL` 現在是 README snippet 的硬條件；Clipulse 不再回退到請求 `Host` 去拼公開 markdown。

Gemini 基線接線示例：先建置 `packages/adapter-gemini/dist/cli.js`，再按 checked-in 示例接上 `SessionStart`、`BeforeTool`、`AfterTool`、`BeforeAgent`、`AfterAgent`、`SessionEnd`。

`BeforeAgent` 與相容 alias `UserPromptSubmit` 不應在同一套接線裡同時保留。

OpenCode guardrail：`session.diff` 繼續透過 `CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF=1` 顯式 opt-in。

## 驗證

### 倉庫級驗證

```bash
npm run smoke:stable
npm run smoke:experimental
```

### 執行中實例探針

對一台已經啟動好的實例：

```bash
export CLIPULSE_BASE_URL="http://127.0.0.1:8000"
export CLIPULSE_SERVER_TOKEN="$CLIPULSE_SERVER_TOKEN"
export CLIPULSE_PUBLIC_BASE_URL="http://127.0.0.1:8000"
export CLIPULSE_EXPECT_PUBLIC_READS=1
npm run smoke:deployment
```

受保護部署下，`smoke:deployment` 現在會同時驗證兩類邊界：

- 匿名存取 `/api/v1/status`、`/static/*`、`/contracts/*`、`/docs`、`/openapi.json` 會被擋住
- `/` 會先返回登入頁
- 登入後的簽名瀏覽器會話可以讀取私有 dashboard 路由

<details>
<summary>環境變數</summary>

- `CLIPULSE_API_URL`：adapter 投遞目標
- `CLIPULSE_API_BEARER_TOKEN`：受保護 ingest 的 bearer token
- `CLIPULSE_DATABASE_URL`：SQLite 資料庫 URL
- `CLIPULSE_STATE_DIR`：本地 spool、snapshot、timing 狀態目錄
- `CLIPULSE_STATE_RETENTION_DAYS`：本地保留期
- `CLIPULSE_STATE_MAX_FILES`：保留檔案上限
- `CLIPULSE_STATE_MAX_SPOOL_BYTES`：backlog 位元組上限
- `CLIPULSE_SERVER_TOKEN`：保護 dashboard、私有 API、docs 與 contracts
- `CLIPULSE_ENABLE_PUBLIC_READS=1`：允許匿名 badge / README 路由
- `CLIPULSE_PUBLIC_BASE_URL`：公開 README snippet 使用的規範 origin

</details>

<details>
<summary>Adapter 入口</summary>

穩定整合：

- [Claude adapter README](./packages/adapter-claude/README.md)
- [Claude canonical hooks](./packages/adapter-claude/hooks/hooks.json)
- [Codex adapter README](./packages/adapter-codex/README.md)
- [Codex canonical hooks](./packages/adapter-codex/examples/hooks.json)

實驗整合：

- [Gemini adapter README](./packages/adapter-gemini/README.md)
- [Gemini settings 示例](./packages/adapter-gemini/examples/.gemini/settings.json)
- [OpenCode adapter README](./packages/adapter-opencode/README.md)
- [OpenCode wrapper 示例](./packages/adapter-opencode/examples/clipulse.ts)

</details>

## 文件

- [自託管與接入指南](./docs/self-hosting-and-integration.md)
- [Release 與打包說明](./docs/release-and-packaging.md)
- `/contracts/dashboard-compat.v1.json`
- [Changelog](./CHANGELOG.md)
- [Security policy](./SECURITY.md)
- [Contributing](./CONTRIBUTING.md)
- [Support](./SUPPORT.md)

## 社群

- [Code of Conduct](./CODE_OF_CONDUCT.md)
- [Issue templates](https://github.com/Boulea7/Clipulse/issues/new/choose)
- [Security reporting path](https://github.com/Boulea7/Clipulse/security/policy)
