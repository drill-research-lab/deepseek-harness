# library/

English | [简体中文](README.zh.md) | [繁體中文](README.zh-tw.md)

The Library capability family: a NotebookLM-shaped knowledge base (Drill product name **Library**) where uploaded documents are stored twice — original for human preview, converted Markdown for agent reading — and answered from with citations.

| Package | ctx key | Role |
|---|---|---|
| [`library`](library/README.md) | `ctx.librarian` | Service Definition: notebooks/resources domain, file store, conversion seam, the ingest-time index (`index.json`) serving structure/search, grounded `ask`, and the durable ask log |
| [`library-api`](library-api/README.md) | `ctx.library` | Browser gateway: the `library` Remote namespace plus the `/library` upload/preview/download routes |
| [`tool-library`](tool-library/README.md) | — | Consumer: the `library_*` model-facing tools (ask/structure/read/ingest); `library_ask` delegates to the `librarian` subagent when mounted |
| [`agent-librarian`](agent-librarian/README.md) | — | Provider: the `librarian` subagent on `ctx.subagents` (navigates with structure/read, answers with citations) |

Spec: drill-docs `docs/features/wiki/spec.md` (issue drill-research-lab/deepseek-harness#23).
