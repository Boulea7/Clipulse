# Clipulse

[简体中文](./README.md) | [English](./README.en.md) | [日本語](./README.ja.md)

[![Beta Checks](https://github.com/Boulea7/Clipulse/actions/workflows/beta-checks.yml/badge.svg)](https://github.com/Boulea7/Clipulse/actions/workflows/beta-checks.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-0f766e.svg)](./LICENSE)
[![Python 3.12+](https://img.shields.io/badge/python-3.12%2B-1d4ed8.svg)](./pyproject.toml)
[![Node 22.12+](https://img.shields.io/badge/node-22.12%2B-111827.svg)](./package.json)

Clipulse 是一個面向 coding-agent CLI 的自託管活動追蹤器。它把本地 hooks / plugin 事件整理成隱私友好的匯總報表、輕量 dashboard 與 README 可嵌入 badge，預設不上傳原始碼正文與 raw prompt。

預設傳輸仍會包含建立匯總所需的有限活動中繼資料，例如雜湊化的 `project_root` scope key、host / model 名稱、時間戳、聚合語言統計與檔案增量計數；預設傳輸契約不會送出原始本地路徑、原始碼正文、raw prompt 或 raw transcript。精確邊界請看 `docs/self-hosting-and-integration.md` 與 `/contracts/events-batch.v1.json`。

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

## 選路入口

- Self-hosting operator：先看 [自託管與接入指南](./docs/self-hosting-and-integration.md)
- Adapter integrator：按 host 進入 [`adapter-claude`](./packages/adapter-claude/README.md)、[`adapter-codex`](./packages/adapter-codex/README.md)、[`adapter-gemini`](./packages/adapter-gemini/README.md)、[`adapter-opencode`](./packages/adapter-opencode/README.md)
- Python package user：看 [Clipulse Python Package](./README.package.md)
- Contributor：看 [Contributing](./CONTRIBUTING.md) 與 [Architecture overview](./docs/architecture.md)
- Security / support：看 [Security policy](./SECURITY.md) 與 [Support](./SUPPORT.md)

## 快速開始

### 需求

- `Node.js 22.12+`
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
export CLIPULSE_DASHBOARD_TOKEN="replace-with-a-random-dashboard-token"
export CLIPULSE_API_BEARER_TOKEN="replace-with-a-random-api-token"
export CLIPULSE_SESSION_SECRET="replace-with-a-long-random-session-secret"
PYTHONPATH=apps/api uv run python -m clipulse_api.migrate upgrade "$CLIPULSE_DATABASE_URL"
PYTHONPATH=apps/api uv run uvicorn clipulse_api.app:create_app --factory --host 127.0.0.1 --port 8000
```

如需本地暫時無鑑權，只能顯式設定：

```bash
export CLIPULSE_ALLOW_INSECURE_NO_AUTH="1"
```

### 3. 發送一筆 sample fixture

```bash
export CLIPULSE_API_URL="http://127.0.0.1:8000"
export CLIPULSE_API_BEARER_TOKEN="$CLIPULSE_API_BEARER_TOKEN"
ROOT="$(pwd)"
sed "s|__CODEX_SMOKE_PROJECT_ROOT__|$ROOT|g" packages/adapter-codex/examples/smoke/session-start.json \
  | node packages/adapter-codex/dist/cli.js
```

這一步使用 checked-in smoke fixture，只用來驗證接線與 dashboard 路徑，不代表生產環境的真實 host 事件。

### 4. 打開 dashboard

訪問 `http://127.0.0.1:8000/`。

- 現在預設就是受保護部署：瀏覽器會先看到登入頁。
- dashboard 登入使用 `CLIPULSE_DASHBOARD_TOKEN`，寫入 API 使用 `CLIPULSE_API_BEARER_TOKEN`，cookie 簽名使用 `CLIPULSE_SESSION_SECRET`。
- 只有顯式設 `CLIPULSE_ALLOW_INSECURE_NO_AUTH=1` 時，dashboard 才會直接打開。
- `CLIPULSE_SERVER_TOKEN` 仍可作為 legacy fallback，但不再建議新部署使用；精確相容邊界見 `docs/self-hosting-and-integration.md`。

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
- `/contracts/*` 下的三個已發布契約

`npm run check:py-install-smoke` 會把構建出的 release artifacts 安裝進乾淨虛擬環境，拉起真實本地服務，並對它們跑一遍 `smoke:deployment`。

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

需要走穩定首發面的本地 release-ready 預檢時，執行：

```bash
npm run check:release:prep
```

如果還想把實驗 adapter 一起納入同一輪本地預檢，再執行：

```bash
npm run check:release:prep:full
```

### 執行中實例探針

對一台已經啟動好的實例：

```bash
export CLIPULSE_BASE_URL="http://127.0.0.1:8000"
export CLIPULSE_DASHBOARD_TOKEN="$CLIPULSE_DASHBOARD_TOKEN"
export CLIPULSE_API_BEARER_TOKEN="$CLIPULSE_API_BEARER_TOKEN"
export CLIPULSE_PUBLIC_BASE_URL="http://127.0.0.1:8000"
export CLIPULSE_EXPECT_PUBLIC_READS=1
npm run smoke:deployment
```

只有當 public outlet 位於獨立 origin 或代理路徑時，才另外設定 `CLIPULSE_PUBLIC_PROBE_URL`。

受保護部署下，`smoke:deployment` 現在會同時驗證兩類邊界：

- 匿名存取 `/api/v1/status`、`/static/*`、`/contracts/*`、`/docs`、`/openapi.json` 會被擋住
- `/` 會先返回登入頁
- 登入後的簽名瀏覽器會話可以讀取私有 dashboard 路由
- 設了 `CLIPULSE_PUBLIC_PROBE_URL` 時，probe 會直接探測獨立 public outlet；不設時只覆蓋 same-origin public route

<details>
<summary>環境變數</summary>

- `CLIPULSE_API_URL`：adapter 投遞目標
- `CLIPULSE_DASHBOARD_TOKEN`：dashboard 登入 token
- `CLIPULSE_API_BEARER_TOKEN`：受保護 ingest / 私有 API 的 bearer token
- `CLIPULSE_SESSION_SECRET`：dashboard session cookie 簽名 secret
- `CLIPULSE_DATABASE_URL`：SQLite 資料庫 URL
- `CLIPULSE_STATE_DIR`：本地 spool、snapshot、timing 狀態目錄
- `CLIPULSE_STATE_RETENTION_DAYS`：本地保留期
- `CLIPULSE_STATE_MAX_FILES`：保留檔案上限
- `CLIPULSE_STATE_MAX_SPOOL_BYTES`：backlog 位元組上限
- `CLIPULSE_ALLOW_INSECURE_NO_AUTH=1`：只供本地開發顯式關閉鑑權
- `CLIPULSE_SERVER_TOKEN`：legacy single-token fallback；不再建議新部署使用
- `CLIPULSE_ENABLE_PUBLIC_READS=1`：允許匿名 badge / README 路由
- `CLIPULSE_PUBLIC_BASE_URL`：公開 README snippet 使用的規範 origin
- `CLIPULSE_PUBLIC_PROBE_URL`：`smoke:deployment` 用來直接探測獨立 public outlet 的 base URL

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
- [Architecture overview](./docs/architecture.md)
- [Release 與打包說明](./docs/release-and-packaging.md)
- [Clipulse Python Package](./README.package.md)
- `/contracts/dashboard-compat.v1.json`
- `/contracts/dashboard-login-copy.v1.json`
- `/contracts/events-batch.v1.json`
- [Changelog](./CHANGELOG.md)
- [Security policy](./SECURITY.md)
- [Contributing](./CONTRIBUTING.md)
- [Support](./SUPPORT.md)

## 社群

- [Code of Conduct](./CODE_OF_CONDUCT.md)
- [Issue templates](https://github.com/Boulea7/Clipulse/issues/new/choose)
- [Security reporting path](https://github.com/Boulea7/Clipulse/security/policy)
- 一般聯絡信箱：<opensource@lnzai.com>
- 私密安全回報備援信箱：<opensource@lnzai.com>
