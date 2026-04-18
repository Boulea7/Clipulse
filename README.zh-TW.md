# Clipulse

[简体中文](./README.md) | [English](./README.en.md) | [日本語](./README.ja.md)

[![Beta Checks](https://github.com/Boulea7/Clipulse/actions/workflows/beta-checks.yml/badge.svg)](https://github.com/Boulea7/Clipulse/actions/workflows/beta-checks.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-0f766e.svg)](./LICENSE)
[![Python 3.12+](https://img.shields.io/badge/python-3.12%2B-1d4ed8.svg)](./pyproject.toml)
[![Node 22.12+](https://img.shields.io/badge/node-22.12%2B-111827.svg)](./package.json)

Clipulse 是面向 coding-agent CLI 的自託管活動追蹤器。它會把本地 hooks 與 plugin 事件整理成隱私友好的彙總、輕量 dashboard，以及可嵌入 README 的 badge，預設不上傳原始碼正文與 raw prompt。

## 為什麼是 Clipulse

- API、SQLite 與 dashboard 都留在你自己的基礎設施裡。
- 用一套受限事件契約追蹤 active time、wait time、file delta、語言、模型與 host mix。
- 需要公開展示時，只放 badge 和 README snippet，不必公開私有 dashboard。
- 現在可以先走原始碼 checkout，之後再切到更乾淨的 Python release artifact 部署路徑。

預設傳輸會保留彙總所需的有限活動中繼資料，例如雜湊化的 `project_root` scope key、host / model 名稱、時間戳、聚合語言統計與檔案增量計數；預設不會送出原始本地路徑、原始碼正文、raw prompt 或 raw transcript。

## 你會得到什麼

- 一個可直接部署的 FastAPI 執行面，位於 `apps/api`，並內建來自 `apps/web` 的 dashboard。
- 放在 `packages/collector-core` 的共享採集、緩衝與投遞邏輯。
- 穩定支援 `Claude Code` 與 `Codex`。
- 實驗支援 `Gemini CLI` 與 `OpenCode`。
- 一組第一方相容性工件，包括 `/contracts/dashboard-compat.v1.json`。

## 支援矩陣

- 當前一等支援：`Claude Code`、`Codex`
- 當前實驗支援：`Gemini CLI`、`OpenCode`
- 可以直接拿來排查的診斷入口：`/healthz`、`/api/v1/status`、`doctor`、`pending`

## 快速開始

執行前提：

- `Node.js 22.12+`
- `npm 10+`
- `Python 3.12+`
- `uv`

1. 建置倉庫並安裝 Python 依賴。

```bash
npm install
npm run build
uv sync --group dev
```

2. 以受保護模式啟動 Clipulse。

```bash
export CLIPULSE_DATABASE_URL="sqlite+pysqlite:///$(pwd)/clipulse.sqlite3"
export CLIPULSE_STATE_DIR="/tmp/clipulse-state"
export CLIPULSE_DASHBOARD_TOKEN="replace-with-a-random-dashboard-token"
export CLIPULSE_API_BEARER_TOKEN="replace-with-a-random-api-token"
export CLIPULSE_SESSION_SECRET="replace-with-a-long-random-session-secret"
PYTHONPATH=apps/api uv run python -m clipulse_api.migrate upgrade "$CLIPULSE_DATABASE_URL"
PYTHONPATH=apps/api uv run uvicorn clipulse_api.app:create_app --factory --host 127.0.0.1 --port 8000
```

只有在本地排查時明確需要跳過 dashboard 驗證，才設定 `CLIPULSE_ALLOW_INSECURE_NO_AUTH=1`。

3. 透過穩定的 `Codex` adapter 路徑送出一筆倉庫內建 smoke fixture。

```bash
export CLIPULSE_API_URL="http://127.0.0.1:8000"
export CLIPULSE_API_BEARER_TOKEN="$CLIPULSE_API_BEARER_TOKEN"
ROOT="$(pwd)"
sed "s|__CODEX_SMOKE_PROJECT_ROOT__|$ROOT|g" packages/adapter-codex/examples/smoke/session-start.json \
  | node packages/adapter-codex/dist/cli.js
```

4. 打開 `http://127.0.0.1:8000/`，使用 `CLIPULSE_DASHBOARD_TOKEN` 登入，確認第一筆 session 已出現。

更完整的部署分支與排查方式，繼續看 `docs/self-hosting-and-integration.md`。倉庫 smoke 故意拆成兩條：`npm run smoke:stable` 負責穩定面，`npm run smoke:experimental` 額外覆蓋實驗 host。

## 輸出範例

當你設定了 `CLIPULSE_ENABLE_PUBLIC_READS=1` 和 `CLIPULSE_PUBLIC_BASE_URL` 之後，`/api/v1/public/readme/top-language` 會回傳一段可以直接貼到其他專案 README 的內容：

```json
{
  "markdown": "![Clipulse Top Language](https://clipulse.example/api/v1/badges/top-language.svg)"
}
```

同一套 public 路由也提供 `today-time` 和 `this-week-time`。

## 文件入口

- [自託管與接入指南](./docs/self-hosting-and-integration.md)：部署模式、驗證、反向代理、探針與 adapter 接線
- [架構總覽](./docs/architecture.md)：資料流、信任邊界與執行面
- [Release 與打包總覽](./docs/release-and-packaging.md)：原始碼 checkout 與 Python artifact 的差異
- [Clipulse Python Package](./README.package.md)：如何安裝倉庫構建出的 `sdist` / `wheel`
- [Contributing](./CONTRIBUTING.md)：貢獻約定與公開文件路由規則
- [Support](./SUPPORT.md)：公開求助路徑，以及提問時該帶什麼資訊
- [Security policy](./SECURITY.md)：漏洞與隱私問題的私密回報方式
- [Changelog](./CHANGELOG.md)：面向發布的變更記錄

<details>
<summary>Adapter 入口與示例設定</summary>

- 穩定 adapter 文件：[packages/adapter-claude/README.md](./packages/adapter-claude/README.md)、[packages/adapter-codex/README.md](./packages/adapter-codex/README.md)
- 穩定示例設定：[packages/adapter-claude/hooks/hooks.json](./packages/adapter-claude/hooks/hooks.json)、[packages/adapter-codex/examples/hooks.json](./packages/adapter-codex/examples/hooks.json)
- 實驗 adapter 文件：[packages/adapter-gemini/README.md](./packages/adapter-gemini/README.md)、[packages/adapter-opencode/README.md](./packages/adapter-opencode/README.md)
- 實驗示例設定：[packages/adapter-gemini/examples/.gemini/settings.json](./packages/adapter-gemini/examples/.gemini/settings.json)、[packages/adapter-opencode/examples/clipulse.ts](./packages/adapter-opencode/examples/clipulse.ts)

</details>

<details>
<summary>打包與進階維運說明</summary>

- 對 contributor 和自託管 operator 來說，原始碼 checkout 仍然是最短路徑。
- 構建後的 Python artifact 說明見 [docs/release-and-packaging.md](./docs/release-and-packaging.md) 與 [README.package.md](./README.package.md)。它們會打包 API runtime、dashboard 資源與 `/contracts/*`。
- `npm run check:release:prep` 是穩定面的 release-ready 預檢，`npm run check:release:prep:full` 會把實驗 adapter 一起納入。
- 如果只想公開唯讀能力，發布 `/api/v1/badges/*` 和 `/api/v1/public/readme/*`，然後設定 `CLIPULSE_ENABLE_PUBLIC_READS=1` 與 `CLIPULSE_PUBLIC_BASE_URL`。
- 只有當 public outlet 位於獨立 origin 或代理路徑，才另外設定 `CLIPULSE_PUBLIC_PROBE_URL`，讓 `npm run smoke:deployment` 直接探測它。
- Gemini 的基線接線從 `packages/adapter-gemini/dist/cli.js` 和倉庫內建生命週期示例開始：`SessionStart`、`BeforeTool`、`AfterTool`、`BeforeAgent`、`AfterAgent`、`SessionEnd`。
- `BeforeAgent` 和相容別名 `UserPromptSubmit` 不應在同一套 Gemini 安裝裡同時保留。
- `OpenCode` 的 `session.diff` 仍然透過 `CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF=1` 顯式啟用。

</details>

## 支援與安全

- 公開且不敏感的問題，走 [SUPPORT.md](./SUPPORT.md) 裡的路徑。
- 漏洞、隱私洩露與任何需要私密處理的報告，走 [SECURITY.md](./SECURITY.md)。
- 公開 bug 或文件缺口，使用 [issue chooser](https://github.com/Boulea7/Clipulse/issues/new/choose)。
