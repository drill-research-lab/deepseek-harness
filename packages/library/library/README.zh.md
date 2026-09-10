# @deepseek-ai/dsh-library

[English](README.md) | 简体中文 | [繁體中文](README.zh-tw.md)

Librarian 服务（`ctx.librarian`）：NotebookLM 形态、可持久保存的多知识库系统。每本知识库把上传的文件保存两份 — 原始文件供人预览与下载、转换后的 Markdown 供 agent 阅读与检索 — 放在 `<DSH_HOME>/library/v1/<notebookId>/{original,markdown}` 下。记录存于 `library` 存储领域（`notebooks` 与 `resources` 表）。

转换走提供者接缝：`registerConverter()` 接受 `{ id, priority, accepts, convert }` 提供者，按优先级递减尝试。内置两个 — markitdown Python 子进程（`python -m markitdown`，Office/PDF/EPUB/HTML，可用 `markitdown: false` 关闭）与无依赖的文本后备（Markdown／纯文本／CSV／JSON／HTML）。转换失败会保留原始文件，并把资源连同失败摘要落在 `error`。

每次内容变动都会重新生成该知识库的**入库时索引**（文件旁的 `index.json`）：每份资源的大纲、前导纯文本摘要、以及带预先统计词频的标题分段 chunk。`structure()` 与 `search()` 由这份索引供应 — 一次文件读取加计分，查询时不读文件、不重新分词 — 缺失、无法解析或过期的索引（早于此功能的知识库、被手改的文件）会在首次读取时自我修复重建。`search()` 以 TF-IDF 加权关键词为 chunk 计分（CJK 双字组加拉丁词，中英混写的笔记不需分词器也能命中）。`ask()` 产生有据回答：检索最佳 chunk，连同问题送给配置的模型（先看 `provider`/`model` 配置，其次 agent 默认选择），返回附逐摘录出处的答案；没有关键词命中的问题（总览式提问）退回每份文件的前导内容，只有没有可读内容的知识库才会不调用模型直接婉拒（`grounded: false`）。`ingest()` 是共用的程序化入口（UI 上传、模型工具、未来的 pipeline 目的地），在解析前落定转换 — 含索引。

每次落定的问答都会追加到知识库的持久**问答记录**（`ask-log.json`，保留最新 200 条）：`askLog()` 由旧到新读取历史，`recordAsk()` 让工具调用端把 subagent 回答的问答记进同一份历史，以来源（`ui`/`agent`）标记，所以 Library 页的讨论串也会显示 agent 问过什么。

## 模型体验

本包自身不注册工具、提示词区段或会话事件；模型经 `@deepseek-ai/dsh-tool-library`（`library_*` 工具）与 `librarian` subagent 触及它。

#### KV 缓存影响

无：这里没有任何内容进入模型请求，各步骤间提示词前缀字节不变。

## 已知限制与推迟工作

- 检索是对入库时索引的关键词计分；还没有 embedding 或 FTS5 后端（接缝已预留），且索引每次变动整本重建而非增量。
- `ingest()` 行内落定转换，大型 PDF 会让调用端等待转换期间；后台转换（UI 轮询 `converting` 状态）推迟。
- markitdown 转换器需要主机上装有 `markitdown` 包的 Python；可用性只能靠实际执行探测，失败路径由文本后备承接。
- llm-wiki 式概念页、反向链接与定时搜索导入不在此范围（drill-docs 跟踪的规格开放问题）。
- 知识库属于安装而非用户；文件根目录通过 `dshHome` 配置预留所有权迁移。
