# Clipulse

[繁體中文](./README.zh-TW.md) | [English](./README.en.md) | [日本語](./README.ja.md)

Clipulse 是一个面向 `Claude Code`、`Codex`、`Gemini CLI`、`OpenCode` 等 coding agent CLI 的轻量活动追踪工具。

它的目标不是复制 WakaTime 的品牌或 API，而是做一个专门服务于 agentic CLI 工作流的独立开源项目：
- 自动统计活跃编码时间与等待时间
- 统计 AI 生成代码的新增/删减行数
- 聚合语言、模型、操作系统、CLI/IDE 使用分布
- 提供自托管 dashboard 与 README 徽章能力

## 当前范围
- 首批正式支持：`Claude Code`、`Codex`
- 第二阶段接入：`Gemini CLI`、`OpenCode`
- 部署方式：自托管优先
- 隐私默认：不上传源码正文、不上传 prompt 正文

## 设计原则
- 简洁优先
- 插件 / hooks 优先
- 统一事件模型
- 本地优先，自托管优先

## 当前状态
当前仓库已经进入可用的 `v1 alpha`：
- `Claude Code` 与 `Codex` 适配器都可以构建出真实的 `dist/cli.js`
- 支持 `CLIPULSE_API_URL` 直连上报
- 当 API 不可用时，事件会先缓存在本机状态目录，后续机会式补发
- API 已提供 overview、breakdown、timeseries、项目榜单、最近 session 与多个 badge
- dashboard 会展示总览、今日/本周时长、语言/模型/主机、项目榜单和最近 session

## 快速启动
```bash
npm install
npm run build
uv sync --group dev
PYTHONPATH=apps/api uv run uvicorn clipulse_api.app:create_app --factory --reload
```

打开 `http://127.0.0.1:8000/` 查看 dashboard。

## 自托管运行
默认数据库文件是仓库根目录下的 `clipulse.sqlite3`。

可选环境变量：
- `CLIPULSE_API_URL`: 例如 `http://127.0.0.1:8000`
- `CLIPULSE_STATE_DIR`: 本地状态目录，保存 spool、session timing 和 snapshot；未设置时默认走 `XDG_STATE_HOME/clipulse` 或 `~/.local/state/clipulse`

建议先启动 API，再接入 hooks：

```bash
PYTHONPATH=apps/api uv run uvicorn clipulse_api.app:create_app --factory --host 0.0.0.0 --port 8000
```

## 接入说明
### Claude Code
1. 在仓库里执行 `npm run build`
2. 将 `packages/adapter-claude/.claude-plugin/plugin.json` 作为插件入口
3. 确认 `packages/adapter-claude/hooks/hooks.json` 中的命令可访问到 `${CLAUDE_PLUGIN_ROOT}/dist/cli.js`
4. 设置环境变量：

```bash
export CLIPULSE_API_URL="http://127.0.0.1:8000"
export CLIPULSE_STATE_DIR="$HOME/.local/state/clipulse"
```

### Codex
1. 在仓库里执行 `npm run build`
2. 参考 `packages/adapter-codex/examples/hooks.json`
3. 将命令路径指向仓库内的 `packages/adapter-codex/dist/cli.js`
4. 同样设置 `CLIPULSE_API_URL` 与可选的 `CLIPULSE_STATE_DIR`

## README 徽章
当前提供的 badge 包括：

```md
![Clipulse Top Language](https://your-domain.example/api/v1/badges/top-language.svg)
![Clipulse Today Time](https://your-domain.example/api/v1/badges/today-time.svg)
![Clipulse This Week Time](https://your-domain.example/api/v1/badges/this-week-time.svg)
```

也可以调用公开片段接口：

```bash
curl https://your-domain.example/api/v1/public/readme/top-language
```

## 当前近似策略与限制
- `active_ms` / `wait_ms` 目前基于 hook 间隔做近似，不是精确前台计时
- Claude 的文件改动以 transcript patch 为主
- Codex 的文件改动在 hook 元数据不足时会回退到本地 snapshot diff
- 本地 snapshot 与 spool 只保存在用户机器，不会上报到 API
- 当前仍然不做多租户、复杂认证和远程代码内容存储

## 路线图
- [x] 统一事件模型与批量上报
- [x] Claude Code plugin / hooks 首版适配
- [x] Codex hooks 首版适配
- [x] FastAPI ingest / overview / breakdown / badge API
- [x] 轻量 dashboard
- [ ] Gemini CLI 与 OpenCode 适配
- [ ] 更精细的时间估算与更低开销的 Codex 文件变更策略

## 开发约定
- 私有调研、上游参考、竞品分析放在 `.clipulse-private/`
- `.clipulse-private/` 永不提交到 GitHub
- 小改动直接 commit，大阶段改动再开 PR
