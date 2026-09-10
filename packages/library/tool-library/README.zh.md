# @deepseek-ai/dsh-tool-library

[English](README.md) | 简体中文 | [繁體中文](README.zh-tw.md)

Library 知识库上面向模型的 librarian 工具，按 DeepWiki MCP 的接口形状设计：`library_ask` 是主要交互（问题进、附行内 `[来源]` 引用的有据回答出；没有相关内容时婉拒），`library_structure` 列出知识库、资源、前导标题与每份资源的前导摘录供导览 — 由入库时索引供应，`library_read` 返回一份资源转换后的 Markdown（受 `maxReadChars` 限制），`library_ingest` 把文字内容或可读文件经 UI 上传共用的入口归档进知识库。知识库参数接受 id 或精确标题（简繁不敏感）；未知的引用会连同当前知识库清单一起报告错误，让模型能自我修正。

`library_ask` 实现 issue #23 的委派工作流：当 `librarian` subagent 提供者已挂载且调用者是 agent 时，问题委派给一个全新的 librarian 子代理，由它以 `library_structure`/`library_read` 导览知识库（本工具与 `library_ingest` 被工具过滤排除在子代理之外，因此绝不会递归），以行内 `[name]` 引用作答；引用来源按知识库的资源名称回收。没有 subagent 运行时 — 或调用者不是 agent — 时，改由 librarian 服务的直接检索作答路径回答。两条路径都把问答以 `agent` 条目追加到知识库的持久问答记录，所以从聊天中问的问题会出现在 Library 页的讨论串。

## 模型体验

注册四个 `library_*` 工具；其 schema 进入组合中每个 agent 的工具组装。委派的 `library_ask` 花费一次 subagent 运行（它自己跑一轮 structure/read 的 agent 循环）；直接后备花费 librarian 配置路由上的一次辅助模型调用。

#### KV 缓存影响

工具 schema 跨步骤稳定，提示词前缀保持可缓存；只有工具结果会变。

## 已知限制与推迟工作

- 不支持 URL 入库；先用 `web_fetch` 抓网页内容，再 `library_ingest` 文字。
- `library_read` 在 `maxReadChars` 处直接截断，没有偏移分页。
- 工具是全局注册（每个 agent 都看得到）；按 preset 限制留给组合层。
- 委派回答以精确 `[name]` 比对回收引用；子代理改写资源名称会丢失该引用（回答文本仍保留行内引用）。
