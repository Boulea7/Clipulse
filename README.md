# Clipulse

[繁體中文](./README.zh-TW.md) | [English](./README.en.md) | [日本語](./README.ja.md)

Clipulse 是一个面向 coding-agent CLI 的自托管活动追踪器。它把本地 hooks / plugin 事件整理成隐私友好的汇总报表、轻量 dashboard 和可嵌入 badge，同时默认不上传源码正文和 raw prompt。

## 你会得到什么

- 自己掌控的 API、SQLite 和 dashboard
- session、项目、语言、模型、宿主和行变更摘要
- 对 `Claude Code`、`Codex` 的稳定支持
- 对 `Gemini CLI`、`OpenCode` 的可试实验支持
- 可公开嵌入的 badge / README snippet，而不是整个私有 dashboard

## 支持状态

- 当前一等支持：`Claude Code`、`Codex`
- 当前实验性：`Gemini CLI`、`OpenCode`
- 部署姿势：self-hosting first
- 产品边界：beta-ready 的单用户汇总，不做多租户分析平台

## 运行前提

- `Node.js 22+`
- `npm 10+`
- `Python 3.12+`
- `uv`
- 当前仍以源码 checkout + 本地 build 为主

## 5 分钟打进第一条真实数据

1. 安装依赖并构建：

```bash
npm install
npm run build
uv sync --group dev
```

2. 启动 API：

```bash
export CLIPULSE_DATABASE_URL="sqlite+pysqlite:///$(pwd)/clipulse.sqlite3"
export CLIPULSE_STATE_DIR="/tmp/clipulse-state"
PYTHONPATH=apps/api uv run uvicorn clipulse_api.app:create_app --factory --host 127.0.0.1 --port 8000
```

3. 在第二个终端里，把稳定 adapter 指向 API，并发送一条真实 hook 事件：

```bash
export CLIPULSE_API_URL="http://127.0.0.1:8000"
ROOT="$(pwd)"
sed "s|__CODEX_SMOKE_PROJECT_ROOT__|$ROOT|g" packages/adapter-codex/examples/smoke/session-start.json \
  | node packages/adapter-codex/dist/cli.js
```

4. 打开 `http://127.0.0.1:8000/`。

- 如果没有设置 `CLIPULSE_SERVER_TOKEN`，dashboard 会直接打开。
- 如果设置了 `CLIPULSE_SERVER_TOKEN`，浏览器会先看到一次性登录页。输入同一个 token 后，服务端只会保存签名 session cookie，不会把原始 API token 暴露给浏览器。
- smoke 事件成功入库后，dashboard 应该能看到至少一条 session / project 记录，而不是空白页。

## 核心环境变量

- `CLIPULSE_API_URL`：adapter 投递事件时使用的 API 地址
- `CLIPULSE_API_BEARER_TOKEN`：当 API 开启保护时，adapter 使用的 bearer token
- `CLIPULSE_DATABASE_URL`：API 使用的 SQLite 路径
- `CLIPULSE_STATE_DIR`：本地 spool、snapshot、session timing 状态目录
- `CLIPULSE_SERVER_TOKEN`：保护私有 dashboard 和 `/api/v1/*`
- `CLIPULSE_ENABLE_PUBLIC_READS=1`：显式允许匿名访问 badge / README snippet
- `CLIPULSE_PUBLIC_BASE_URL`：受保护部署生成公开 README snippet 时必须设置

## 部署模式

### 私有 dashboard + 私有 API

把完整 dashboard 和 `/api/v1/*` 都放在私有面。

```bash
export CLIPULSE_SERVER_TOKEN="replace-with-a-long-random-token"
export CLIPULSE_API_BEARER_TOKEN="$CLIPULSE_SERVER_TOKEN"
```

- adapter 进程必须同时继承 `CLIPULSE_API_URL` 和 `CLIPULSE_API_BEARER_TOKEN`
- 浏览器不会收到原始 API token；受保护 dashboard 通过一次性登录后换成服务端签名 cookie

### 公开 badge / README snippet

推荐做法：主实例保持私有，只把 badge/snippet 通过独立公开出口、反代路径分流，或者单独实例暴露出去。

- 公开面只需要 `/api/v1/badges/*` 和 `/api/v1/public/readme/*`
- 主实例上的 `/`、`/api/v1/*`、`/static/*`、`/contracts/*` 默认都应继续保持私有
- 公开 snippet 时至少同时设置：

```bash
export CLIPULSE_ENABLE_PUBLIC_READS="1"
export CLIPULSE_PUBLIC_BASE_URL="https://clipulse.example"
```

- 受保护实例如果缺少 `CLIPULSE_PUBLIC_BASE_URL`，README snippet 会返回 `503`
- 如果没开 `CLIPULSE_ENABLE_PUBLIC_READS`，匿名 badge / snippet 会返回 `401`

## 运维快速检查

先跑稳定面：

```bash
npm run smoke:stable
npm run smoke:experimental
```

下面这些命令用于诊断，不替代 smoke：

```bash
curl -i http://127.0.0.1:8000/healthz
curl http://127.0.0.1:8000/api/v1/status
node packages/collector-core/dist/cli.js doctor
node packages/collector-core/dist/cli.js pending
```

如果 dashboard 还是空白，需要证明 ingest 已经接通，可以再跑一次最小投递：

```bash
curl -X POST "http://127.0.0.1:8000/api/v1/events/batch" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CLIPULSE_SERVER_TOKEN" \
  -d '{"events":[{"host":"codex","host_version":"0.1.0","session_id":"manual-check","project_root":"/tmp/demo","project_name":"demo","git_branch":"main","event_name":"session_start","event_time":"2026-04-14T12:00:00Z","model_name":"gpt-5.4","os_name":"macos","editor_or_terminal":"terminal","active_ms":1000,"wait_ms":0,"privacy_mode":"hashed","language_stats":{},"file_deltas":[]}]}'
```

## Adapter 接线

首跑最常见的失败不是 hooks 没触发，而是 hooks / plugin 进程没有继承投递环境变量。Clipulse adapter 只有在宿主进程拿到下面两个变量时才会真正投到 API：

- `CLIPULSE_API_URL`
- 受保护部署下的 `CLIPULSE_API_BEARER_TOKEN`

稳定集成入口：

- [Claude adapter README](./packages/adapter-claude/README.md)
- [Claude canonical hooks](./packages/adapter-claude/hooks/hooks.json)
- [Codex adapter README](./packages/adapter-codex/README.md)
- [Codex canonical hooks](./packages/adapter-codex/examples/hooks.json)

实验集成入口：

- `packages/adapter-gemini/dist/cli.js` 当前以 `SessionStart`、`BeforeTool`、`AfterTool`、`BeforeAgent`、`AfterAgent`、`SessionEnd` 为主
- [Gemini adapter README](./packages/adapter-gemini/README.md)
- [Gemini settings 示例](./packages/adapter-gemini/examples/.gemini/settings.json)
- [OpenCode adapter README](./packages/adapter-opencode/README.md)
- [OpenCode wrapper 示例](./packages/adapter-opencode/examples/clipulse.ts)

Gemini guardrail：

- `BeforeAgent` 与兼容 alias `UserPromptSubmit` 不应在同一套接线里同时保留

OpenCode guardrail：

- `session.diff` 继续通过 `CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF=1` 显式 opt-in

## 隐私与安全

- 不上传源码正文
- 不上传 raw prompt / transcript 正文
- 公开 badge 暴露的是整套安装实例的汇总，不是单项目私密视图；决定公开前要明确接受这个边界
- `.clipulse-private/`、SQLite、`CLIPULSE_STATE_DIR`、`.env*`、`credentials*`、`*.pem`、`*.key`、`*.p12`、`*.pfx` 都不应进入 GitHub

更完整的安全与部署说明见：

- [Security policy](./SECURITY.md)
- [自托管与接入指南](./docs/self-hosting-and-integration.md)
- [Support](./SUPPORT.md)

## 社区

- [Contributing](./CONTRIBUTING.md) `[English]`
- [Code of Conduct](./CODE_OF_CONDUCT.md) `[English]`
- [Security policy](./SECURITY.md) `[English]`
- [Support](./SUPPORT.md) `[English]`
- [Changelog](./CHANGELOG.md)
- [Issue templates](https://github.com/Boulea7/Clipulse/issues/new/choose)

## 深入文档

- [自托管与接入指南](./docs/self-hosting-and-integration.md)
- `/contracts/dashboard-compat.v1.json`
- [Claude adapter README](./packages/adapter-claude/README.md)
- [Codex adapter README](./packages/adapter-codex/README.md)
- [Gemini adapter README](./packages/adapter-gemini/README.md)
- [OpenCode adapter README](./packages/adapter-opencode/README.md)
