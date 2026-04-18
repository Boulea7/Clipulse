# Clipulse

[繁體中文](./README.zh-TW.md) | [English](./README.en.md) | [日本語](./README.ja.md)

[![Beta Checks](https://github.com/Boulea7/Clipulse/actions/workflows/beta-checks.yml/badge.svg)](https://github.com/Boulea7/Clipulse/actions/workflows/beta-checks.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-0f766e.svg)](./LICENSE)
[![Python 3.12+](https://img.shields.io/badge/python-3.12%2B-1d4ed8.svg)](./pyproject.toml)
[![Node 22.12+](https://img.shields.io/badge/node-22.12%2B-111827.svg)](./package.json)

Clipulse 是一个面向 coding-agent CLI 的自托管活动追踪器。它把本地 hooks / plugin 事件整理成隐私友好的汇总报表、轻量 dashboard 和 README 可嵌入 badge，默认不上传源码正文和 raw prompt。

默认传输仍会包含建立汇总所需的有限活动元数据，例如哈希化后的 `project_root` scope key、host / model 名称、时间戳、聚合语言统计和文件增量计数；默认传输契约不发送原始本地路径、源码正文、raw prompt 或 raw transcript。精确边界见 `docs/self-hosting-and-integration.md` 和 `/contracts/events-batch.v1.json`。

## 为什么用 Clipulse

- API、SQLite 和 dashboard 都掌握在自己手里。
- 追踪 active time、wait time、file delta、语言、模型和 host mix。
- 稳定支持 `Claude Code`、`Codex`。
- 以更窄的实验边界支持 `Gemini CLI`、`OpenCode`。
- 需要公开面时，只暴露 badge / README snippet，不公开整套私有 dashboard。

## 当前状态

- 当前一等支持：`Claude Code`、`Codex`
- 当前实验支持：`Gemini CLI`、`OpenCode`
- 部署形态：self-hosted、单用户、SQLite
- 当前可写部署边界：一个 SQLite 文件只配一个 Clipulse API 进程
- 诊断命令：`/healthz`、`/api/v1/status`、`doctor`、`pending`

## 快速开始

### 运行前提

- `Node.js 22.12+`
- `npm 10+`
- `Python 3.12+`
- `uv`

### 1. 安装并构建

```bash
npm install
npm run build
uv sync --group dev
```

### 2. 启动 Clipulse

```bash
export CLIPULSE_DATABASE_URL="sqlite+pysqlite:///$(pwd)/clipulse.sqlite3"
export CLIPULSE_STATE_DIR="/tmp/clipulse-state"
export CLIPULSE_DASHBOARD_TOKEN="replace-with-a-random-dashboard-token"
export CLIPULSE_API_BEARER_TOKEN="replace-with-a-random-api-token"
export CLIPULSE_SESSION_SECRET="replace-with-a-long-random-session-secret"
PYTHONPATH=apps/api uv run python -m clipulse_api.migrate upgrade "$CLIPULSE_DATABASE_URL"
PYTHONPATH=apps/api uv run uvicorn clipulse_api.app:create_app --factory --host 127.0.0.1 --port 8000
```

本地临时无鉴权只用于开发排查时，才显式设置：

```bash
export CLIPULSE_ALLOW_INSECURE_NO_AUTH="1"
```

### 3. 发送一条 sample fixture

```bash
export CLIPULSE_API_URL="http://127.0.0.1:8000"
export CLIPULSE_API_BEARER_TOKEN="$CLIPULSE_API_BEARER_TOKEN"
ROOT="$(pwd)"
sed "s|__CODEX_SMOKE_PROJECT_ROOT__|$ROOT|g" packages/adapter-codex/examples/smoke/session-start.json \
  | node packages/adapter-codex/dist/cli.js
```

这一步用的是 checked-in smoke fixture，用来确认接线和 dashboard 通了，不是生产环境里的真实 host 事件。

### 4. 打开 dashboard

访问 `http://127.0.0.1:8000/`。

- 默认是受保护部署：浏览器先看到登录页。
- dashboard 登录用 `CLIPULSE_DASHBOARD_TOKEN`，写入类 API 用 `CLIPULSE_API_BEARER_TOKEN`，cookie 签名用 `CLIPULSE_SESSION_SECRET`。
- 只有显式设置 `CLIPULSE_ALLOW_INSECURE_NO_AUTH=1` 时，dashboard 才会直接打开。
- `CLIPULSE_SERVER_TOKEN` 仍可用作 legacy fallback，但新部署不再推荐；精确兼容边界见 `docs/self-hosting-and-integration.md`。

## 部署面

### 源码 checkout

对开发者和大多数 operator，源码 checkout 仍然是最直接的路径：

- 构建仓库
- 先跑 `clipulse_api.migrate upgrade`
- 再启动 `uvicorn`

### Python release artifact

`npm run check:py-build` 现在会构建带完整 dashboard 资源的 Python `sdist` / `wheel`，其中包含：

- FastAPI backend
- `/static/*` 所需 dashboard 资源
- `/contracts/*` 下的三个已发布契约

`npm run check:py-install-smoke` 会把构建出的 release artifacts 安装进干净虚拟环境，拉起真实本地服务，并对它们跑一遍 `smoke:deployment`。

### 公开 badge / README 路由

如果需要公开面，建议主实例继续私有，只公开：

- `/api/v1/badges/*`
- `/api/v1/public/readme/*`

同时设置：

```bash
export CLIPULSE_ENABLE_PUBLIC_READS="1"
export CLIPULSE_PUBLIC_BASE_URL="https://clipulse.example"
```

`CLIPULSE_PUBLIC_BASE_URL` 现在是 README snippet 的硬条件；Clipulse 不再回退到请求 `Host` 去拼公开 markdown。

Gemini 基线接线示例：先构建 `packages/adapter-gemini/dist/cli.js`，再按 checked-in 示例接上 `SessionStart`、`BeforeTool`、`AfterTool`、`BeforeAgent`、`AfterAgent`、`SessionEnd`。

`BeforeAgent` 与兼容 alias `UserPromptSubmit` 不应在同一套接线里同时保留。

OpenCode guardrail：`session.diff` 继续通过 `CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF=1` 显式 opt-in。

## 验证

### 仓库级验证

```bash
npm run smoke:stable
npm run smoke:experimental
```

需要走完整的本地 release-ready 预检时，运行：

```bash
npm run check:release:prep
```

### 运行中实例探针

对一台已经启动好的实例：

```bash
export CLIPULSE_BASE_URL="http://127.0.0.1:8000"
export CLIPULSE_DASHBOARD_TOKEN="$CLIPULSE_DASHBOARD_TOKEN"
export CLIPULSE_API_BEARER_TOKEN="$CLIPULSE_API_BEARER_TOKEN"
export CLIPULSE_PUBLIC_BASE_URL="http://127.0.0.1:8000"
export CLIPULSE_EXPECT_PUBLIC_READS=1
npm run smoke:deployment
```

只有当 public outlet 在独立 origin 或代理路径上时，才额外设置 `CLIPULSE_PUBLIC_PROBE_URL`。

受保护部署下，`smoke:deployment` 现在会同时验证两类边界：

- 匿名访问 `/api/v1/status`、`/static/*`、`/contracts/*`、`/docs`、`/openapi.json` 会被挡住
- `/` 会先返回登录页
- 登录后的签名浏览器会话可以读取私有 dashboard 路由
- 设了 `CLIPULSE_PUBLIC_PROBE_URL` 时，会直接探测独立 public outlet；不设时只覆盖 same-origin public route

<details>
<summary>环境变量</summary>

- `CLIPULSE_API_URL`：adapter 投递目标
- `CLIPULSE_DASHBOARD_TOKEN`：dashboard 登录 token
- `CLIPULSE_API_BEARER_TOKEN`：受保护 ingest / 私有 API 的 bearer token
- `CLIPULSE_SESSION_SECRET`：dashboard session cookie 签名 secret
- `CLIPULSE_DATABASE_URL`：SQLite 数据库 URL
- `CLIPULSE_STATE_DIR`：本地 spool、snapshot、timing 状态目录
- `CLIPULSE_STATE_RETENTION_DAYS`：本地保留期
- `CLIPULSE_STATE_MAX_FILES`：保留文件上限
- `CLIPULSE_STATE_MAX_SPOOL_BYTES`：backlog 字节上限
- `CLIPULSE_ALLOW_INSECURE_NO_AUTH=1`：仅本地开发时显式关闭鉴权
- `CLIPULSE_SERVER_TOKEN`：legacy single-token fallback；新部署不再推荐
- `CLIPULSE_ENABLE_PUBLIC_READS=1`：允许匿名 badge / README 路由
- `CLIPULSE_PUBLIC_BASE_URL`：公开 README snippet 使用的规范 origin
- `CLIPULSE_PUBLIC_PROBE_URL`：`smoke:deployment` 用来真实探测独立 public outlet 的 base URL

</details>

<details>
<summary>Adapter 入口</summary>

稳定集成：

- [Claude adapter README](./packages/adapter-claude/README.md)
- [Claude canonical hooks](./packages/adapter-claude/hooks/hooks.json)
- [Codex adapter README](./packages/adapter-codex/README.md)
- [Codex canonical hooks](./packages/adapter-codex/examples/hooks.json)

实验集成：

- [Gemini adapter README](./packages/adapter-gemini/README.md)
- [Gemini settings 示例](./packages/adapter-gemini/examples/.gemini/settings.json)
- [OpenCode adapter README](./packages/adapter-opencode/README.md)
- [OpenCode wrapper 示例](./packages/adapter-opencode/examples/clipulse.ts)

</details>

## 文档

- [自托管与接入指南](./docs/self-hosting-and-integration.md)
- [Release 与打包说明](./docs/release-and-packaging.md)
- `/contracts/dashboard-compat.v1.json`
- `/contracts/dashboard-login-copy.v1.json`
- `/contracts/events-batch.v1.json`
- [Changelog](./CHANGELOG.md)
- [Security policy](./SECURITY.md)
- [Contributing](./CONTRIBUTING.md)
- [Support](./SUPPORT.md)

## 社区

- [Code of Conduct](./CODE_OF_CONDUCT.md)
- [Issue templates](https://github.com/Boulea7/Clipulse/issues/new/choose)
- [Security reporting path](https://github.com/Boulea7/Clipulse/security/policy)
- 一般联系邮箱：<opensource@lnzai.com>
- 私密安全报告备用邮箱：<opensource@lnzai.com>
