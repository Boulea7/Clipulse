# Clipulse

[繁體中文](./README.zh-TW.md) | [English](./README.en.md) | [日本語](./README.ja.md)

Clipulse 是一个面向 `Claude Code`、`Codex` 等 coding agent CLI 的轻量活动追踪器，当前 alpha+ 版本优先服务自托管、隐私敏感、终端优先的使用场景。

它不是 WakaTime 的 API 复刻，也不打算把 agent 工作流包装成复杂 SaaS。当前实现目标更务实：
- 自托管部署一个自己的 API、SQLite 和 dashboard
- 用插件 / hooks 采集 session、项目、语言、模型、主机与文件变更摘要
- 在不上报源码正文和 prompt 正文的前提下生成 README badge 与轻量汇总视图

## Alpha+ 范围
- 首批正式支持：`Claude Code`、`Codex`
- 当前可试接入但仍实验性：`Gemini CLI`、`OpenCode`
- 后续再推进到一等稳定支持：`Gemini CLI`、`OpenCode`
- 部署方式：self-hosting first
- 数据边界：默认只上传归一化事件和文件变更摘要，不上传源码正文与 raw prompt
- 产品边界：先做好单用户、本地优先、轻量汇总；不在 alpha+ 阶段引入复杂认证、多租户或远程代码存储

## 当前已经可用的部分
- `Claude Code` 与 `Codex` 适配器都可构建出真实的 `dist/cli.js`
- 仓库现在还带有可试接入的实验性 `Gemini CLI` hooks-first 适配器（`packages/adapter-gemini/dist/cli.js`）和 `OpenCode` plugin/event-first 桥接入口（`packages/adapter-opencode/dist/plugin.js`）；两者都已纳入构建与 fixture / contract 验证，但仍未达到 `Claude Code` / `Codex` 同级的稳定承诺
- 支持 `CLIPULSE_API_URL` 直连上报
- API 不可用时，事件会先缓存在本机状态目录，后续优先补发 backlog 再发送当前批次
- ingest 现在会返回轻量的逐事件结果，适配器可以只重试仍可重试的子集，而不是整批无限回放
- partial delivery outcome 现在会优先按稳定 `event_id` 回配，再退回批次顺序，因此未确认结果会继续保留为可重试子集，而不是被误判；API 端在回退生成 `event_id` 时也会先规范化等价 UTC 时间表达，避免同一事件因 `Z` / `+00:00` 写法不同而被误判成两条
- `Claude Code` 适配器会按本地 transcript cursor 增量解析新记录，避免每个 hook 都全量重扫 transcript
- `Claude Code` 现在也会在 compact / transcript 回退后重建本地基线，抑制空的 `PreToolUse` 噪音事件，过滤零行变更 patch，并在 `stop` / `stop_failure` / `session_end` / `pre_compact` 时清理同一 session 下不同 transcript 路径的状态
- `Claude Code` 在无文件变更的 `UserPromptSubmit` 场景下，也会保留一次 project-level activity
- `Claude Code` 与 `Codex` 都会尝试从本地 Git 上下文补齐更稳的 `project_root`、`project_name` 与 `git_branch`
- FastAPI + SQLite 已提供 overview、timeseries、language/model/host breakdown、`projects/top`、`sessions/recent`、`sessions/{session_id}`、`projects/{project_ref}`、`projects/{project_ref}/sessions` 与多个 badge / README snippet
- FastAPI 现在也提供 `GET /api/v1/status`，可直接查看自托管场景下的 API / DB / 本地 spool 状态，包括队列计数、占用字节数，以及 backlog / quarantine 的最老年龄
- 最近 session 列表和 project session 列表现在会按逻辑 session 聚合，因此同一 session 中途切换 host / model 时不再被拆成多行
- project detail 现在会和 session detail 一样提供紧凑 summary 字段，包括 changed files、changed languages、line changes、top language 与 host-model mix
- dashboard 已展示总览、今日/本周时长、语言、模型、主机、项目榜单、最近 session、7 日 activity，并支持 hash 驱动的 session / project detail、session branch context、breadcrumb 导航、heuristic 提示，以及紧凑的 changed files / changed languages / line changes 摘要
- dashboard detail 现在会优先依赖 dedicated detail endpoint，而不是把 `projects/top` / `sessions/recent` 当成前置条件；home 也会更明确提示 `/api/v1/status` 的加载失败
- `ready/processing` backlog 现在会在本地按年龄与总大小做轻量约束；过旧或被 size cap 挤出的批次会进入 `spool/quarantine/`，并带上 sidecar metadata 便于排障
- backlog sidecar metadata 现在也会继承 `first_seen_at`、`attempt_count` 与 `last_attempted_at`，避免 `processing -> ready` 恢复或本地隔离时把同一批次误写成“全新问题”
- 本地 spool sidecar 现在也会尽量保留仍然有效的 lineage 字段；孤儿 `.meta.json` bookkeeping 文件不会再把当前批次误判成“还有 payload backlog 未清空”
- `collector-core` 现在还带一个极小的本地 operator CLI，当前刻意只保留 `node packages/collector-core/dist/cli.js doctor` / `pending` 两个只读命令，用于排查本机 spool payload、orphan sidecar、quarantine reason，并更明确地提示 processing-only / quarantine-only / orphan-only backlog，以及 `stale_backlog` / `spool_size_cap` 这类保留策略提示
- dashboard 启动/切页时现在会把 loading 和 failure 文案分开；project 页里的 sessions 区域也明确变成 project-scoped，不再在 detail loading/error 时回退显示全局 recent sessions；若只有 project sessions 子请求失败，project detail 仍会继续显示，unscoped session deep link 在 detail lookup 成功后也会规范化回 project-scoped hash，home detail 里的 queue backlog 行会补充最老 quarantine 年龄，而 queue storage 文案会明确表示它展示的是 payload spool bytes
- session / project detail 现在也会把 zero-delta 解释得更明确：除了 prompt-only activity 和第一次 Codex snapshot baseline 之外，只读命令或本次没有实际文件变更也可能是正常情况
- session / project detail 现在也会更明确说明 `fingerprint` 是隐私安全标识，而不是真实路径或源码片段；当 session 没有 file delta 时，也会提示这可能只是 prompt-only activity、只读命令，或 Codex 第一次 snapshot baseline 尚未产生 delta

## Alpha+ 正在对齐的实现目标
- 保持“自托管 + 本地状态目录 + 轻量 API”这条主线，不额外引入队列服务
- 继续收紧 Codex 文件变更 heuristic，减少本地 snapshot diff 的误差和扫描范围
- 继续扩展更有价值的 session 报表，而不是直接跳到复杂 BI
- 继续让 `Gemini CLI` 保持 hooks-first、`OpenCode` 保持 plugin/event-first 的最小脚手架，而不是过早扩张成更重的集成面

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

更完整的长期运行、自托管接入、示例 payload 与排障说明见 [docs/self-hosting-and-integration.md](./docs/self-hosting-and-integration.md)。

常用环境变量：
- `CLIPULSE_API_URL`: 例如 `http://127.0.0.1:8000`
- `CLIPULSE_STATE_DIR`: 本地状态目录；未设置时默认走 `XDG_STATE_HOME/clipulse` 或 `~/.local/state/clipulse`

建议先启动 API，再接入 hooks：

```bash
PYTHONPATH=apps/api uv run uvicorn clipulse_api.app:create_app --factory --host 0.0.0.0 --port 8000
```

本地排障时也可以直接运行：

```bash
node packages/collector-core/dist/cli.js doctor
node packages/collector-core/dist/cli.js pending
```

如果 `CLIPULSE_STATE_DIR` 对应路径还不存在，这两个命令也只会检查该路径，不会为了排障而创建目录。

最小 smoke 流程：

```bash
curl -i http://127.0.0.1:8000/healthz
curl http://127.0.0.1:8000/api/v1/status
node packages/collector-core/dist/cli.js doctor
node packages/collector-core/dist/cli.js pending
```

- `/healthz` 只做 liveness，成功时应返回 `204`
- `/api/v1/status` 才是自托管排障状态面；当前没有单独的 readiness probe，也不建议把它当成高频负载均衡 readiness 探针
- `doctor` / `pending` 都是只读 smoke，不会创建缺失的状态目录，也不会改动 backlog

## 本地状态目录结构
当前 alpha+ 会在 `CLIPULSE_STATE_DIR` 下维护这些内容：

```text
clipulse-state/
  sessions/
    <host>-<scoped-session-hash>.json
  snapshots/
    <host>-<scoped-session-hash>.json
  claude-transcripts/
    <session-scope>.json
  spool/
    tmp/
    ready/
      <batch>.json
      <batch>.meta.json
    processing/
      <batch>.json
      <batch>.meta.json
    quarantine/
      <batch>.json
      <batch>.meta.json
```

用途说明：
- `sessions/`: 保存 session timing 的本地中间状态，用于估算 `active_ms` 和 `wait_ms`
- `snapshots/`: 保存按 session 划分的项目文本快照，供 Codex 在 hook 元数据不足时做本地 diff fallback
- `claude-transcripts/`: 保存 Claude transcript cursor 的本地状态
- `spool/`: 保存待补发事件批次；发送顺序会优先 flush `ready/` 中的 backlog
- backlog 在发送前会按稳定 `event_id` 做机会式去重，降低重复补发噪音
- `spool/quarantine/` 现在会同时保留不可自动重试或被本地 age/size cap 隔离的 payload 和同名 `.meta.json` 说明文件；可重试子集会继续留在 `ready/`
- `ready/`、`processing/`、`quarantine/` 三个 spool 状态目录都可能出现同名 `.meta.json` sidecar，用来保留本地 lineage 和排障字段
- `ready/` 与 `processing/` backlog 现在也会按年龄与总大小做轻量约束；本地 sidecar metadata 会延续 `first_seen_at` / `attempt_count` / `last_attempted_at`，被隔离时会再补充 `source_state`、`approx_bytes` 等排障字段
- 如果 sidecar 只有部分字段损坏，Clipulse 现在会尽量保留仍然有效的 lineage 字段，而不是把整批本地 backlog 重置成“全新问题”
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
5. 安装或打包时，需要让最终 `${CLAUDE_PLUGIN_ROOT}` 同时暴露 `hooks/` 与 `dist/cli.js`；仓库里把 manifest 放在 `.claude-plugin/` 下，但真正安装的插件根目录必须包含运行时文件
6. 设置环境变量：

```bash
export CLIPULSE_API_URL="http://127.0.0.1:8000"
export CLIPULSE_STATE_DIR="$HOME/.local/state/clipulse"
```

### Codex
1. 在仓库里执行 `npm run build`
2. 参考 `packages/adapter-codex/examples/hooks.json`；这个 checked-in 示例就是当前的 canonical wiring source，其中至少接上了 `SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`Stop` 这组常见成功路径 hooks，且示例本身也保留了 `SessionEnd` 作为 cleanup / teardown 边界
3. 如果宿主还提供 `PostToolUseFailure` / `StopFailure` 这类 failure-path hooks，也建议一并接上；Clipulse 会用它们更完整地结算 `wait_ms`
4. 将命令路径指向仓库中的 `packages/adapter-codex/dist/cli.js`
5. 同样设置 `CLIPULSE_API_URL` 与可选的 `CLIPULSE_STATE_DIR`
- 对 Codex 来说，zero-delta 事件仍可能是正常情况，例如 prompt-only activity、只读命令，或第一次 snapshot baseline 只建立本地基线但尚未产生 delta

### Gemini CLI / OpenCode
- `packages/adapter-gemini/dist/cli.js` 现已提供可试接入的 hooks-first 入口，当前以官方 `SessionStart`、`SessionEnd`、`BeforeTool`、`AfterTool`、`BeforeAgent`、`AfterAgent` surface 为主。
- `packages/adapter-gemini` 当前复用共享 project context / timing，会把 `AfterAgent` 与 prompt submit 区分开，只在官方 `write_file` / `replace` payload 明确给出文件路径时产出最小 file delta，并明确保持 `AfterModel` 不接入。`SessionEnd` 仍只作为 best-effort 的 stop/cleanup fallback，而不是可靠 barrier。`AfterToolFailure`、`UserPromptSubmit` 这类输入若被接受，也只是兼容 alias，不是主契约，也不意味着会获得与官方 hook surface 等价的 file-delta 语义。
- `packages/adapter-gemini/examples/.gemini/settings.json` 现在是包内 checked-in 的官方 Gemini hook wiring 示例来源，顶层文档以它为准，不再重复维护第二份 JSON 真相。
- `packages/adapter-opencode/dist/plugin.js` 当前仍是一个薄的 bridge 入口，而不是可直接落地的完整 plugin；推荐的可试接入方式仍是本地 wrapper，例如 `packages/adapter-opencode/examples/clipulse.ts`，用于按当前选定子集转发 `session.created` / `session.deleted` / `session.idle` / `session.error`、命名 `tool.execute.before` / `tool.execute.after` / `tool.execute.error`，以及 `file.edited`。这个 checked-in wrapper 示例也是当前的 canonical wiring source。
- `packages/adapter-opencode` 当前只把显式 `file.edited` 当作高置信 delta 来源；官方 `file.edited` 若只给路径，也会先记录 path-only delta，不抓 transcript、不接 server API，也不吞整条 message/TUI event 流。
- OpenCode 上游也提供 `session.diff`，但 Clipulse 当前默认不消费它，因为它是累计式 snapshot surface，还带有原始 `before` / `after` 文本，接入前需要额外的隐私剥离与去重策略。如果你显式设置 `CLIPULSE_OPENCODE_ENABLE_SESSION_DIFF=1`，仓库内 wrapper 示例会做 wrapper-only 的 post-turn backfill，但仍只会转发最小 `{ path, additions, deletions }`，并跳过同一缓冲阶段里已由 `file.edited` 命中的路径；当前 wrapper 也会兼容上游 `file` / `path` 与 `added` / `removed`、`additions` / `deletions` 这几种 shape alias，再统一归一化成最小转发形状。
- 这两个适配器当前都属于“可试接入但仍实验性”的阶段：构建、fixture / contract test、自托管 wiring 说明已具备，但仍未达到 `Claude Code` / `Codex` 同级的稳定承诺。

## 项目 / Session 视图现状
当前 API 和 dashboard 已经提供轻量 drill-down：
- `GET /api/v1/projects/top`: 返回项目汇总与 `project_ref`
- `GET /api/v1/sessions/recent`: 返回最近 session 汇总与 `project_ref`
- `GET /api/v1/sessions/{session_id}`: 返回 session 基本信息、active / wait 汇总、事件数、语言汇总、文件变更摘要，以及 changed files / changed languages / line changes / top language 等紧凑摘要字段
- `GET /api/v1/projects/{project_ref}`: 返回项目级 detail，与 session detail 一样是 summary-first 视图
- `GET /api/v1/projects/{project_ref}/sessions`: 只返回该项目下的紧凑 session 列表，不再混带项目 detail 主体
- `GET /healthz`: 只返回 `204 No Content` 的活性探针，不携带 API / DB / spool 细节
- `GET /api/v1/status`: 返回 schema-backed 的最小 `api` / `db` / `spool` 自托管状态，包括队列计数、占用字节数、最老 backlog / quarantine 年龄；计数和字节数只统计 payload `.json`

当前 detail 仍是“summary-first”视图，不是完整事件时间线。

兼容性说明：
- `GET /api/v1/projects/{project_ref}/sessions` 已收敛为 compact session list；项目 detail 请改读 `GET /api/v1/projects/{project_ref}`
- 三个 list endpoint 在 `limit <= 0` 时都会稳定返回空 `items`
- 当同一个 `session_id` 同时命中多个项目时，`GET /api/v1/sessions/{session_id}` 必须带 `?project_ref=...`，否则会返回带 `code` 与 `hint` 的 `409`
- session 聚合与查找实际按 `(project_root, session_id)` scope 处理；project-scoped 链接比裸 `session_id` 更稳定
- 同一个 `project_root` 即使后续上报了不同的 `project_name`，project 路由和 session detail 也会固定使用同一个 canonical `project_name`
- detail / list payload 现在也会区分 `host_model_primary` 与显式 `last_*` host/model/branch 字段，并在 preview 省略额外变更文件时返回 `file_preview_truncated_count`
- `sessions/recent` 与 `projects/{project_ref}/sessions` 的默认 payload 当前仍保留完整 `host_model_mix`，这是现阶段的兼容性契约；第一方 dashboard 主要依赖 `host_model_primary` 与 `host_model_mix_count`，如果未来要瘦身，会走显式兼容迁移而不是静默改默认值

`file_preview` 与 `fingerprint` 的设计是隐私边界的一部分：
- `file_preview` 只展示变化趋势摘要，不展示源码正文
- `fingerprint` 是稳定标识，不是文件路径回显，默认不暴露项目内真实路径

探针角色说明：
- `GET /healthz` 只确认进程是否活着，成功时返回 `204`
- `GET /api/v1/status` 才是 dashboard 和自托管排障使用的状态面
- 当前没有单独的 readiness probe；如果 API 仍可响应，应优先查看 `/api/v1/status`，而不是把 `/healthz` 当成“数据库和 spool 都正常”的证明

示例 `status` 响应：

```json
{
  "api": { "status": "ok", "version": "0.1.0" },
  "db": { "status": "ok", "events": 8, "projects": 2, "sessions": 3 },
  "spool": {
    "state_dir": "/srv/clipulse/state",
    "ready": 2,
    "processing": 1,
    "quarantine": 1,
    "ready_bytes": 2048,
    "processing_bytes": 512,
    "quarantine_bytes": 1024,
    "oldest_backlog_age_seconds": 3600,
    "oldest_quarantine_age_seconds": 7200
  }
}
```

示例歧义 session `409`：

```json
{
  "detail": {
    "code": "ambiguous_session",
    "message": "session_id matched multiple projects",
    "hint": "Retry with the matching project_ref from /api/v1/projects/top or /api/v1/sessions/recent."
  }
}
```

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
- 同一逻辑 session 里如果只是 host 或 model 切换，最近 session 不应再拆行；若仍看到重复，请先确认这些事件是否实际上落在不同的 `project_root` 上。
- Codex 在第一次基于 snapshot 的捕获中如果没有返回 file delta，这是预期行为，因为第一次只建立本地基线。
- 如果直连上报失败，可检查 `CLIPULSE_STATE_DIR/spool/ready`；Clipulse 会在下一次 hook 触发时优先重试未确认完成的事件。
- 如果 `spool/quarantine/` 有内容，优先看同名 `.meta.json`，里面会说明这批事件为什么被隔离；被隔离的可能是不可自动重试子集，也可能是被本地 age/size cap 收口的 backlog。
- 常见 quarantine reason 目前包括 `http_error`、`invalid_results`、`recovery_failed`、`invalid_spool_payload`、`stale_backlog`、`spool_size_cap`；其中 `stale_backlog` / `spool_size_cap` 会继承原 backlog 的 `first_seen_at` 与 `attempt_count`，便于判断是老问题还是新问题。
- 如果 dashboard 提示 API / DB / spool 有异常，可直接访问 `GET /api/v1/status`，先看本地 backlog 是否还堆在 `ready` / `processing` / `quarantine`，并结合 `*_bytes` 与 `oldest_*_age_seconds` 判断是 API 不通、长期积压还是本地隔离。
- 如果 `CLIPULSE_STATE_DIR` 还不存在，`GET /api/v1/status` 会返回归零的 spool 计数，而不是报错。
- 如果你更想直接在终端看本地状态，可以跑 `node packages/collector-core/dist/cli.js doctor` 或 `pending`；当前本地 operator surface 刻意只保留这两个只读命令，不会改动 backlog；如果 state dir 还不存在，它们也只会检查路径而不会创建目录。`doctor` 现在还会额外提示 quarantine-only、orphan-only，以及 `stale_backlog` / `spool_size_cap` 这类 retention 线索。
- 除了 `409 ambiguous_session`，错误的 project scope 还会稳定返回 `404 project_not_found`；未知 session 会返回 `404 session_not_found`。
- 如果 Claude 在 compact 或 transcript 轮换后看起来还残留旧状态，请确认你安装的是最新构建版本，这一版会清理同一 session 下不同 transcript 路径的状态文件；空的 `PreToolUse` 即使被抑制为无噪音事件，也仍可能已经隐式打开 wait，并在后续关闭事件里结算。

## Dashboard Walkthrough
- 主页先看总览、项目榜单和最近 session。
- 点项目进入 project detail，会看到这个项目的汇总统计和 breadcrumb。
- 项目页里的 sessions 卡片现在会切到该项目自己的 compact session 列表，而不是继续显示全局 recent sessions。
- 再点最近 session 进入 session detail，看 host / model / branch / changed files / languages / line changes。
- 页面里的 `active`、`wait`、`line changes`、`host-model mix` 都是本地 summary/heuristic，适合日常观察，不是精确审计流水。

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
- `wait_ms` 从 `pre_tool_use` 开始计时，并在匹配的 `post_tool_use`、`post_tool_use_failure`、`stop`、`stop_failure` 或 `session_end` 到来时结算
- Claude transcript 增量状态只保存在本机 `CLIPULSE_STATE_DIR`，不会作为远程资产暴露
- Codex 的 snapshot diff 首次建立基线时返回空 delta，后续才按变更生成增量
- 本地 snapshot 只扫描文本文件，并忽略 `.git`、`.clipulse-private`、`.venv`、`.worktrees`、`.pytest_cache`、`.ruff_cache`、`.mypy_cache`、`__pycache__`、`.next`、`coverage`、`dist`、`build`、`node_modules`，以及常见敏感文件模式如 `.env*`、`credentials*`、`*.pem`、`*.key`；大于 `256 KiB`、超长文本或含二进制字节的文件会跳过
- Codex 文件变更统计目前是“最小可用 heuristic”：只有在 Bash 足够简单、且能安全缩窄 candidate path 时才做窄范围 snapshot；对简单 `env` / `command` / `builtin` / `noglob` / `bash -lc` / `/bin/zsh -lc` 这类包裹，以及 `touch` / `cp` / `sed -i` / `tee` 这类常见写命令，会继续做轻量支持；遇到 pipe / redirection / subshell / semicolon chain / escaped-space path 等低信心 Bash，或 `git diff` / `git show` / `sort` / `awk` / `cut` / `uniq` 这类明显只读命令，以及 `.venv/bin/python -m ...`、`python -m ...`、`python3 -m ...`、`tar`、`unzip`、`rsync`、`sort -o`、`perl -pi*`、`cmd /c`、`powershell -Command`、`pwsh -Command`、`sh.exe -c`、递归 `cp -r` / `cp -R` 这类真实写面过宽或语义隐藏较深的命令时，会保守回退到更宽的 snapshot 比较，但仍不是精确 VCS diff
- Codex 的 rename / move 当前明确按 remove + add 汇总，文件级和目录级 move 都不会作为独立 rename 事件暴露
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
- [ ] Gemini CLI / OpenCode 一等集成文档、示例与更完整宿主契约

## 开发约定
- 私有调研、上游参考、竞品分析放在 `.clipulse-private/`
- `.clipulse-private/` 永不提交到 GitHub
- 这份 README 应优先描述“当前已实现”和“alpha+ 下一步”，避免把计划写成已交付事实
