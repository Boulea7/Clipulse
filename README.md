# Clipulse

[繁體中文](./README.zh-TW.md) | [English](./README.en.md) | [日本語](./README.ja.md)

Clipulse 是一个面向 `Claude Code`、`Codex` 等 coding agent CLI 的轻量活动追踪器，当前 alpha+ 版本优先服务自托管、隐私敏感、终端优先的使用场景。

它不是 WakaTime 的 API 复刻，也不打算把 agent 工作流包装成复杂 SaaS。当前实现目标更务实：
- 自托管部署一个自己的 API、SQLite 和 dashboard
- 用插件 / hooks 采集 session、项目、语言、模型、主机与文件变更摘要
- 在不上报源码正文和 prompt 正文的前提下生成 README badge 与轻量汇总视图

## Alpha+ 范围
- 首批正式支持：`Claude Code`、`Codex`
- 下一阶段适配：`Gemini CLI`、`OpenCode`
- 部署方式：self-hosting first
- 数据边界：默认只上传归一化事件和文件变更摘要，不上传源码正文与 raw prompt
- 产品边界：先做好单用户、本地优先、轻量汇总；不在 alpha+ 阶段引入复杂认证、多租户或远程代码存储

## 当前已经可用的部分
- `Claude Code` 与 `Codex` 适配器都可构建出真实的 `dist/cli.js`
- 支持 `CLIPULSE_API_URL` 直连上报
- API 不可用时，事件会先缓存在本机状态目录，后续优先补发 backlog 再发送当前批次
- FastAPI + SQLite 已提供 overview、timeseries、language/model/host breakdown、`projects/top`、`sessions/recent`、`sessions/{session_id}`、`projects/{project_ref}/sessions` 与多个 badge / README snippet
- dashboard 已展示总览、今日/本周时长、语言、模型、主机、项目榜单、最近 session、7 日 activity，并支持 hash 驱动的 session / project detail

## Alpha+ 正在对齐的实现目标
- 保持“自托管 + 本地状态目录 + 轻量 API”这条主线，不额外引入队列服务
- 继续收紧 Codex 文件变更 heuristic，减少本地 snapshot diff 的误差和扫描范围
- 继续扩展更有价值的 session 报表，而不是直接跳到复杂 BI

## 快速启动
```bash
npm install
npm run build
uv sync --group dev
PYTHONPATH=apps/api uv run uvicorn clipulse_api.app:create_app --factory --reload
```

打开 `http://127.0.0.1:8000/` 查看 dashboard。

## 自托管与存储
默认数据库文件是仓库根目录下的 `clipulse.sqlite3`。

常用环境变量：
- `CLIPULSE_API_URL`: 例如 `http://127.0.0.1:8000`
- `CLIPULSE_STATE_DIR`: 本地状态目录；未设置时默认走 `XDG_STATE_HOME/clipulse` 或 `~/.local/state/clipulse`

建议先启动 API，再接入 hooks：

```bash
PYTHONPATH=apps/api uv run uvicorn clipulse_api.app:create_app --factory --host 0.0.0.0 --port 8000
```

## 本地状态目录结构
当前 alpha+ 会在 `CLIPULSE_STATE_DIR` 下维护这些内容：

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

用途说明：
- `sessions/`: 保存 session timing 的本地中间状态，用于估算 `active_ms` 和 `wait_ms`
- `snapshots/`: 保存按 session 划分的项目文本快照，供 Codex 在 hook 元数据不足时做本地 diff fallback
- `spool/`: 保存待补发事件批次；发送顺序会优先 flush `ready/` 中的 backlog
- 运行 hooks 时会机会式清理旧的 `tmp` / `quarantine` / `sessions` / `snapshots` 状态，并在 `stop` 后移除当前 session 的中间状态

## 隐私边界
- 不上传源码正文
- 不上传原始 prompt / transcript 正文
- 文件层只上传归一化 delta 与 privacy-safe fingerprint，而不是绝对路径正文
- `snapshots/`、`sessions/`、`spool/` 只保存在本机状态目录，不会上报为源文件内容
- `.clipulse-private/` 只用于本地调研和私有笔记，默认不提交

## 接入说明
### Claude Code
1. 在仓库里执行 `npm run build`
2. 将 `packages/adapter-claude/.claude-plugin/` 视为 Claude 插件目录
3. 该插件目录里的 `plugin.json` 会引用 `./hooks/hooks.json`
4. 本地开发或验证时，按 Claude 官方插件目录方式加载，例如 `claude --plugin-dir /abs/path/to/packages/adapter-claude`
5. 安装或打包时，需要让 `${CLAUDE_PLUGIN_ROOT}/dist/cli.js` 可用；也就是 `dist/cli.js` 必须位于最终插件根目录下
6. 设置环境变量：

```bash
export CLIPULSE_API_URL="http://127.0.0.1:8000"
export CLIPULSE_STATE_DIR="$HOME/.local/state/clipulse"
```

### Codex
1. 在仓库里执行 `npm run build`
2. 参考 `packages/adapter-codex/examples/hooks.json`
3. 将命令路径指向仓库中的 `packages/adapter-codex/dist/cli.js`
4. 同样设置 `CLIPULSE_API_URL` 与可选的 `CLIPULSE_STATE_DIR`

## 项目 / Session 视图现状
当前 API 和 dashboard 已经提供轻量 drill-down：
- `GET /api/v1/projects/top`: 返回项目汇总与 `project_ref`
- `GET /api/v1/sessions/recent`: 返回最近 session 汇总与 `project_ref`
- `GET /api/v1/sessions/{session_id}`: 返回 session 基本信息、active / wait 汇总、事件数、语言汇总与文件变更摘要
- `GET /api/v1/projects/{project_ref}/sessions`: 返回项目最近 session 列表与项目级汇总

当前 detail 仍是“summary-first”视图，不是完整事件时间线。

## Badge 与 README 片段
当前 badge 接口包括：
- `GET /api/v1/badges/top-language.svg`
- `GET /api/v1/badges/today-time.svg`
- `GET /api/v1/badges/this-week-time.svg`

README 可直接嵌入：

```md
![Clipulse Top Language](https://your-domain.example/api/v1/badges/top-language.svg)
![Clipulse Today Time](https://your-domain.example/api/v1/badges/today-time.svg)
![Clipulse This Week Time](https://your-domain.example/api/v1/badges/this-week-time.svg)
```

当前公开片段接口包括：

```bash
curl https://your-domain.example/api/v1/public/readme/top-language
curl https://your-domain.example/api/v1/public/readme/today-time
curl https://your-domain.example/api/v1/public/readme/this-week-time
```

返回值是：

```json
{"markdown":"![Clipulse Top Language](https://your-domain.example/api/v1/badges/top-language.svg)"}
```

## 当前 heuristic 与限制
- `active_ms` / `wait_ms` 是 hook-gap heuristic，不是精确前台活动时长
- 非等待场景下的单次 `active_ms` 会被截断到最多 `15_000` ms
- `wait_ms` 只在 `pre_tool_use -> post_tool_use` 间按时间差计算
- Codex 的 snapshot diff 首次建立基线时返回空 delta，后续才按变更生成增量
- 本地 snapshot 只扫描文本文件，并忽略 `.git`、`.clipulse-private`、`.venv`、`.worktrees`、`.pytest_cache`、`.ruff_cache`、`.mypy_cache`、`coverage`、`dist`、`build`、`node_modules`；大于 `256 KiB`、超长文本或含二进制字节的文件会跳过
- Codex 文件变更统计目前是“最小可用 heuristic”，优先利用 Bash 命令里的候选路径收窄范围，不是精确 VCS diff
- session / project detail 目前只提供聚合摘要，不提供完整事件时间线
- 当前仍然不做认证、多用户隔离与远程代码存储

## 路线图
- [x] 统一事件模型与批量上报
- [x] Claude Code plugin / hooks 首版适配
- [x] Codex hooks 首版适配
- [x] FastAPI ingest / overview / breakdown / badge API
- [x] 项目榜单与最近 session 汇总
- [x] 轻量 dashboard
- [x] session / project detail drill-down
- [x] 本地状态目录 pruning 策略
- [ ] 更精细的时间估算与更低开销的 Codex 文件变更策略
- [ ] Gemini CLI 与 OpenCode 适配

## 开发约定
- 私有调研、上游参考、竞品分析放在 `.clipulse-private/`
- `.clipulse-private/` 永不提交到 GitHub
- 这份 README 应优先描述“当前已实现”和“alpha+ 下一步”，避免把计划写成已交付事实
