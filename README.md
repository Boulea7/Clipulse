# Clipulse

[繁體中文](./README.zh-TW.md) | [English](./README.en.md) | [日本語](./README.ja.md)

[![Beta Checks](https://github.com/Boulea7/Clipulse/actions/workflows/beta-checks.yml/badge.svg)](https://github.com/Boulea7/Clipulse/actions/workflows/beta-checks.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-0f766e.svg)](./LICENSE)
[![Python 3.12+](https://img.shields.io/badge/python-3.12%2B-1d4ed8.svg)](./pyproject.toml)
[![Node 22.12+](https://img.shields.io/badge/node-22.12%2B-111827.svg)](./package.json)

Clipulse 是面向 coding-agent CLI 的自托管活动追踪器。它会把本地 hooks 和 plugin 事件整理成隐私友好的汇总、轻量 dashboard，以及可嵌入 README 的 badge，不默认上传源码正文和 raw prompt。

## 为什么是 Clipulse

- API、SQLite 和 dashboard 都留在你自己的基础设施里。
- 用一套受限事件契约追踪 active time、wait time、file delta、语言、模型和 host mix。
- 需要公开展示时，只放 badge 和 README snippet，不必公开私有 dashboard。
- 现在可以先走源码 checkout，后续再切到更干净的 Python release artifact 部署路径。

默认传输会保留汇总所需的有限活动元数据，例如哈希化的 `project_root` scope key、host / model 名称、时间戳、聚合语言统计和文件增量计数；默认不会发送原始本地路径、源码正文、raw prompt 或 raw transcript。

## 你会得到什么

- 一个可直接部署的 FastAPI 运行面，位于 `apps/api`，并内置来自 `apps/web` 的 dashboard。
- 放在 `packages/collector-core` 的共享采集、缓冲和投递逻辑。
- 稳定适配 `Claude Code` 与 `Codex`。
- 实验适配 `Gemini CLI` 与 `OpenCode`。
- 一组第一方兼容性工件，包括 `/contracts/dashboard-compat.v1.json`。

## 支持矩阵

- 当前一等支持：`Claude Code`、`Codex`
- 当前实验支持：`Gemini CLI`、`OpenCode`
- 可以直接用来排查的诊断入口：`/healthz`、`/api/v1/status`、`doctor`、`pending`

## 快速开始

运行前提：

- `Node.js 22.12+`
- `npm 10+`
- `Python 3.12+`
- `uv`

1. 构建仓库并安装 Python 依赖。

```bash
npm install
npm run build
uv sync --group dev
```

2. 以受保护模式启动 Clipulse。

```bash
export CLIPULSE_DATABASE_URL="sqlite+pysqlite:///$(pwd)/clipulse.sqlite3"
export CLIPULSE_STATE_DIR="/tmp/clipulse-state"
export CLIPULSE_DASHBOARD_TOKEN="replace-with-a-random-dashboard-token"
export CLIPULSE_API_BEARER_TOKEN="replace-with-a-random-api-token"
export CLIPULSE_SESSION_SECRET="replace-with-a-long-random-session-secret"
PYTHONPATH=apps/api uv run python -m clipulse_api.migrate upgrade "$CLIPULSE_DATABASE_URL"
PYTHONPATH=apps/api uv run uvicorn clipulse_api.app:create_app --factory --host 127.0.0.1 --port 8000
```

只有在本地排查时明确需要跳过 dashboard 鉴权，才设置 `CLIPULSE_ALLOW_INSECURE_NO_AUTH=1`。

3. 通过稳定的 `Codex` adapter 路径发送一条仓库内置 smoke fixture。

```bash
export CLIPULSE_API_URL="http://127.0.0.1:8000"
export CLIPULSE_API_BEARER_TOKEN="$CLIPULSE_API_BEARER_TOKEN"
ROOT="$(pwd)"
sed "s|__CODEX_SMOKE_PROJECT_ROOT__|$ROOT|g" packages/adapter-codex/examples/smoke/session-start.json \
  | node packages/adapter-codex/dist/cli.js
```

4. 打开 `http://127.0.0.1:8000/`，使用 `CLIPULSE_DASHBOARD_TOKEN` 登录，确认第一条 session 已出现。

更完整的部署分支和排查方式继续看 `docs/self-hosting-and-integration.md`。仓库 smoke 故意拆成两条：`npm run smoke:stable` 负责稳定面，`npm run smoke:experimental` 额外覆盖实验 host。

## 输出示例

当你设置了 `CLIPULSE_ENABLE_PUBLIC_READS=1` 和 `CLIPULSE_PUBLIC_BASE_URL` 之后，`/api/v1/public/readme/top-language` 会返回一段可以直接贴到其他项目 README 的内容：

```json
{
  "markdown": "![Clipulse Top Language](https://clipulse.example/api/v1/badges/top-language.svg)"
}
```

同一套 public 路由也提供 `today-time` 和 `this-week-time`。

## 文档入口

- [自托管与接入指南](./docs/self-hosting-and-integration.md)：部署模式、鉴权、反向代理、探针与 adapter 接线
- [架构总览](./docs/architecture.md)：数据流、信任边界和运行面
- [Release 与打包总览](./docs/release-and-packaging.md)：源码 checkout 与 Python artifact 的区别
- [Clipulse Python Package](./README.package.md)：如何安装仓库构建出的 `sdist` / `wheel`
- [Contributing](./CONTRIBUTING.md)：贡献约定和公开文档路由规则
- [Support](./SUPPORT.md)：公开求助路径以及提问时该带什么信息
- [Security policy](./SECURITY.md)：漏洞和隐私问题的私密上报方式
- [Changelog](./CHANGELOG.md)：面向发布的变更记录

<details>
<summary>Adapter 入口与示例配置</summary>

- 稳定 adapter 文档：[packages/adapter-claude/README.md](./packages/adapter-claude/README.md)、[packages/adapter-codex/README.md](./packages/adapter-codex/README.md)
- 稳定示例配置：[packages/adapter-claude/hooks/hooks.json](./packages/adapter-claude/hooks/hooks.json)、[packages/adapter-codex/examples/hooks.json](./packages/adapter-codex/examples/hooks.json)
- 实验 adapter 文档：[packages/adapter-gemini/README.md](./packages/adapter-gemini/README.md)、[packages/adapter-opencode/README.md](./packages/adapter-opencode/README.md)
- 实验示例配置：[packages/adapter-gemini/examples/.gemini/settings.json](./packages/adapter-gemini/examples/.gemini/settings.json)、[packages/adapter-opencode/examples/clipulse.ts](./packages/adapter-opencode/examples/clipulse.ts)

</details>

<details>
<summary>打包与进阶运维说明</summary>

- 对 contributor 和自托管 operator 来说，源码 checkout 仍然是最短路径。
- 构建后的 Python artifact 说明见 [docs/release-and-packaging.md](./docs/release-and-packaging.md) 和 [README.package.md](./README.package.md)。它们会打包 API runtime、dashboard 资源和 `/contracts/*`。
- `npm run check:release:prep` 是稳定面的 release-ready 预检，`npm run check:release:prep:full` 会把实验 adapter 一起纳入。
- 如果只想公开只读能力，发布 `/api/v1/badges/*` 和 `/api/v1/public/readme/*`，然后设置 `CLIPULSE_ENABLE_PUBLIC_READS=1` 与 `CLIPULSE_PUBLIC_BASE_URL`。
- 只有当 public outlet 位于独立 origin 或代理路径，才额外设置 `CLIPULSE_PUBLIC_PROBE_URL`，让 `npm run smoke:deployment` 直接探测它。
- Gemini 的基线接线从 `packages/adapter-gemini/dist/cli.js` 和仓库内置生命周期示例开始：`SessionStart`、`BeforeTool`、`AfterTool`、`BeforeAgent`、`AfterAgent`、`SessionEnd`。
- `BeforeAgent` 与兼容 alias `UserPromptSubmit` 不应在同一套接线里同时保留。
- `OpenCode` 的 `session.diff` 继续通过 `CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF=1` 显式启用。

</details>

## 支持与安全

- 公开且不敏感的问题，走 [SUPPORT.md](./SUPPORT.md) 里的路径。
- 漏洞、隐私泄露和任何需要私密处理的报告，走 [SECURITY.md](./SECURITY.md)。
- 公开 bug 或文档缺口，使用 [issue chooser](https://github.com/Boulea7/Clipulse/issues/new/choose)。
