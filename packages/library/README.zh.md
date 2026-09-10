# library/

[English](README.md) | 简体中文 | [繁體中文](README.zh-tw.md)

Library 能力家族：NotebookLM 形态的知识库（Drill 产品名 **Library**），上传的文件保存两份 — 原始文件供人预览、转换后的 Markdown 供 agent 阅读 — 并能据以回答问题、附上引用。

| 包 | ctx 键 | 角色 |
|---|---|---|
| [`library`](library/README.md) | `ctx.librarian` | Service Definition：知识库／资源领域、文件存储、转换接缝、供应 structure/search 的入库时索引（`index.json`）、有据 `ask` 与持久问答记录 |
| [`library-api`](library-api/README.md) | `ctx.library` | 浏览器网关：`library` Remote 命名空间加上 `/library` 上传／预览／下载路由 |
| [`tool-library`](tool-library/README.md) | — | 消费者：面向模型的 `library_*` 工具（ask/structure/read/ingest）；`librarian` subagent 挂载时 `library_ask` 委派给它 |
| [`agent-librarian`](agent-librarian/README.md) | — | 提供者：`ctx.subagents` 上的 `librarian` subagent（以 structure/read 导览、以引用作答） |

规格：drill-docs `docs/features/wiki/spec.md`（issue drill-research-lab/deepseek-harness#23）。
