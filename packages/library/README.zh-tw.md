# library/

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

Library 能力家族：NotebookLM 形態的知識庫（Drill 產品名 **Library**），上傳的文件保存兩份 — 原始檔供人預覽、轉換後的 Markdown 供 agent 閱讀 — 並能據以回答問題、附上引用。

| 套件 | ctx 鍵 | 角色 |
|---|---|---|
| [`library`](library/README.md) | `ctx.librarian` | Service Definition：知識庫／資源領域、檔案儲存、轉換接縫、供應 structure/search 的入庫時索引（`index.json`）、有據 `ask` 與持久問答紀錄 |
| [`library-api`](library-api/README.md) | `ctx.library` | 瀏覽器閘道：`library` Remote 命名空間加上 `/library` 上傳／預覽／下載路由 |
| [`tool-library`](tool-library/README.md) | — | 消費者：面向模型的 `library_*` 工具（ask/structure/read/ingest）；`librarian` subagent 掛載時 `library_ask` 委派給它 |
| [`agent-librarian`](agent-librarian/README.md) | — | 供應者：`ctx.subagents` 上的 `librarian` subagent（以 structure/read 導覽、以引用作答） |

規格：drill-docs `docs/features/wiki/spec.md`（issue drill-research-lab/deepseek-harness#23）。
