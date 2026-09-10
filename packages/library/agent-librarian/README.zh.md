# @deepseek-ai/dsh-agent-librarian

[English](README.md) | 简体中文 | [繁體中文](README.zh-tw.md)

Librarian subagent 提供者：在 `ctx.subagents` 上注册 `librarian`，每次委派都以全新的进程内子代理启动，带着通过 `library_*` 工具工作的 librarian 角色 — 用 `library_structure` 探索（入库时索引供应的大纲与摘要）、用 `library_read` 读取原文字句、用 `library_ingest` 归档素材，并根据读到的内容自行作答、附行内 `[name]` 引用（绝不回头调用 `library_ask`，那是调用者进入它的入口：`library_ask` 委派到「这里」，子代理若再提问回去就会递归）。一般 agent（Chat 协调者）把知识库工作委派给 `librarian`，而不是把整份文件拉进自己的上下文，符合 Drill 规格的 orchestrator／librarian 分工。角色与提供者名称是部署配置。

## 模型体验

提供者本身不给父代理增加工具或提示词文字；被委派的子代理以强制的 librarian 角色（前置于任何调用者角色）运行，外加委派要求的工具过滤。

#### KV 缓存影响

对父代理的提示词前缀无影响；每个子代理都是全新上下文。

## 已知限制与推迟工作

- 子代理是全新上下文（`inheritsParentContext: false`）；Drill 规格的 `shared-project` 上下文模式推迟到 subagent 接缝。
- 还没有专属的 Web UI preset 行；委派经标准 subagent 工具进行。
