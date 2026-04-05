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

## 仓库状态
当前仓库正在从空仓库逐步实现中，优先完成：
1. 统一采集内核
2. FastAPI + SQLite 后端
3. 轻量 dashboard
4. Claude Code / Codex 首批适配器

## 快速启动
```bash
npm install
uv sync --group dev
PYTHONPATH=apps/api uv run uvicorn clipulse_api.app:create_app --factory --reload
```

打开 `http://127.0.0.1:8000/` 查看 dashboard。

## 接入说明
- `Claude Code`: 参考 `packages/adapter-claude/.claude-plugin/plugin.json` 与 `packages/adapter-claude/hooks/hooks.json`
- `Codex`: 参考 `packages/adapter-codex/examples/hooks.json`
- 通过环境变量 `CLIPULSE_API_URL` 指向你的 Clipulse API 地址

## README 徽章
当前已提供一个可直接使用的 SVG badge：

```md
![Clipulse Top Language](https://your-domain.example/api/v1/badges/top-language.svg)
```

也可以调用公开片段接口：

```bash
curl https://your-domain.example/api/v1/public/readme/top-language
```

## 路线图
- [ ] 统一事件模型与聚合逻辑
- [ ] Claude Code plugin 适配器
- [ ] Codex hooks 适配器
- [ ] FastAPI ingest / overview / breakdown / badge API
- [ ] 静态 dashboard
- [ ] README / GitHub 主页徽章集成说明

## 开发约定
- 私有调研、上游参考、竞品分析放在 `.clipulse-private/`
- `.clipulse-private/` 永不提交到 GitHub
- 小改动直接 commit，大阶段改动再开 PR
