# Clipulse

[繁體中文](./README.zh-TW.md) | [English](./README.en.md) | [日本語](./README.ja.md)

[![Beta Checks](https://github.com/Boulea7/Clipulse/actions/workflows/beta-checks.yml/badge.svg)](https://github.com/Boulea7/Clipulse/actions/workflows/beta-checks.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-0f766e.svg)](./LICENSE)
[![Python 3.12+](https://img.shields.io/badge/python-3.12%2B-1d4ed8.svg)](./pyproject.toml)
[![Node 22+](https://img.shields.io/badge/node-22%2B-111827.svg)](./package.json)

Clipulse 是一个面向 coding-agent CLI 的自托管活动追踪器。它把本地 hooks / plugin 事件整理成隐私友好的汇总报表、轻量 dashboard 和 README 可嵌入 badge，默认不上传源码正文和 raw prompt。

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

- `Node.js 22+`
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
PYTHONPATH=apps/api uv run python -m clipulse_api.migrate upgrade "$CLIPULSE_DATABASE_URL"
PYTHONPATH=apps/api uv run uvicorn clipulse_api.app:create_app --factory --host 127.0.0.1 --port 8000
```

### 3. 打进第一条真实事件

```bash
export CLIPULSE_API_URL="http://127.0.0.1:8000"
ROOT="$(pwd)"
sed "s|__CODEX_SMOKE_PROJECT_ROOT__|$ROOT|g" packages/adapter-codex/examples/smoke/session-start.json \
  | node packages/adapter-codex/dist/cli.js
```

### 4. 打开 dashboard

访问 `http://127.0.0.1:8000/`。

- 没设 `CLIPULSE_SERVER_TOKEN` 时，dashboard 直接打开。
- 设了 `CLIPULSE_SERVER_TOKEN` 时，浏览器会先看到登录页。
- dashboard cookie 现在是只读浏览器会话；写入类 API 仍然必须走 `Authorization: Bearer`。

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
- `/contracts/*` 所需兼容契约

`npm run check:py-install-smoke` 会把 wheel 安装进干净虚拟环境，拉起真实本地服务，并对它跑一遍 `smoke:deployment`。

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

### 运行中实例探针

对一台已经启动好的实例：

```bash
export CLIPULSE_BASE_URL="http://127.0.0.1:8000"
export CLIPULSE_SERVER_TOKEN="$CLIPULSE_SERVER_TOKEN"
export CLIPULSE_PUBLIC_BASE_URL="http://127.0.0.1:8000"
export CLIPULSE_EXPECT_PUBLIC_READS=1
npm run smoke:deployment
```

受保护部署下，`smoke:deployment` 现在会同时验证两类边界：

- 匿名访问 `/api/v1/status`、`/static/*`、`/contracts/*`、`/docs`、`/openapi.json` 会被挡住
- `/` 会先返回登录页
- 登录后的签名浏览器会话可以读取私有 dashboard 路由

<details>
<summary>环境变量</summary>

- `CLIPULSE_API_URL`：adapter 投递目标
- `CLIPULSE_API_BEARER_TOKEN`：受保护 ingest 的 bearer token
- `CLIPULSE_DATABASE_URL`：SQLite 数据库 URL
- `CLIPULSE_STATE_DIR`：本地 spool、snapshot、timing 状态目录
- `CLIPULSE_STATE_RETENTION_DAYS`：本地保留期
- `CLIPULSE_STATE_MAX_FILES`：保留文件上限
- `CLIPULSE_STATE_MAX_SPOOL_BYTES`：backlog 字节上限
- `CLIPULSE_SERVER_TOKEN`：保护 dashboard、私有 API、docs 和 contracts
- `CLIPULSE_ENABLE_PUBLIC_READS=1`：允许匿名 badge / README 路由
- `CLIPULSE_PUBLIC_BASE_URL`：公开 README snippet 使用的规范 origin

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
- [Changelog](./CHANGELOG.md)
- [Security policy](./SECURITY.md)
- [Contributing](./CONTRIBUTING.md)
- [Support](./SUPPORT.md)

## 社区

- [Code of Conduct](./CODE_OF_CONDUCT.md)
- [Issue templates](https://github.com/Boulea7/Clipulse/issues/new/choose)
- [Security reporting path](https://github.com/Boulea7/Clipulse/security/policy)
