# Agent Note: Library — NotebookLM-shaped knowledge base with a librarian agent face

Status: implemented

## Problem

Drill needs its Library surface (drill-docs `features/wiki/spec.md`, issue #23): research material uploaded once must serve both humans (preview, download) and agents (retrieval, grounded answers), across multiple independent notebooks, without pulling whole documents into a conversation context. DSH ships no knowledge-base primitive — skills and session-query are the nearest neighbors and neither stores nor converts user documents.

## Decision

A new `packages/library/` capability family plus a browser surface, all additive plugins (no core change):

- `library/` (`ctx.librarian`) — durable notebooks/resources over `storage-domain`; files under `<DSH_HOME>/library/v1/<notebookId>/{original,markdown}` so every document exists twice: the original for preview/download, the Markdown twin for agents. Conversion is a seam (`registerConverter`): a markitdown Python subprocess (Office/PDF/EPUB/HTML, config-toggleable) above a dependency-free text fallback; a failure keeps the original and lands `status: error` on the record. Retrieval is query-time TF-IDF over heading-scoped chunks with CJK-bigram tokenization (mixed zh/en corpora match without a segmenter). `ask()` retrieves, then answers through `ctx.llm` on the config route falling back to `ctx.agentDefaultModel`, returning citations; a question no keyword matches falls back to each document's leading content (overview asks still answer), and only a notebook with no readable content declines without a model call. `ingest()` is the single programmatic entry point (UI upload, tools, future pipeline destinations) and carries the spec's content classes (`source`/`result`/`deliverable`).
- `library-api/` (`ctx.library`) — the browser gateway: the `library` Remote namespace (notebook CRUD, resources, pasted-text ingest, Markdown payloads, `ask`), mounted in `api/remotes` as `ctx.remote.library.*`, plus the `/library` data plane the JSON-only `/api` cannot carry: raw-body `POST /library/upload`, inline `GET /library/<id>/raw` (the PDF/text preview source), and `GET /library/<id>/download`. Auth mirrors the writing PDF route (`ctx.auth` when mounted, per-request).
- `tool-library/` — model-facing `library_ask` (primary; DeepWiki-MCP-shaped question-first face), `library_structure`, `library_read`, `library_ingest`. Notebook parameters accept id or exact title and error with the live listing for self-correction.
- `agent-librarian/` — a `librarian` `SubagentProvider` (fresh in-process child, forced persona working through the `library_*` tools), matching the spec's orchestrator→librarian delegation shape.
- `client/ui-library/` — a `sidebar.section` entry (notebook list below the session browser) and a `shell.overlay` full-page view (notebook column, upload + paste-text intake, Markdown/PDF preview, grounded ask panel). The two share one closure-scoped page-state observable; mutations bump a revision counter peers refetch on.
- `ui-sidebar` gains the `sidebar.section` list hole (SlotMap + children + one renderSlot between the browsing region and the foot) — the only touched shipped package, an additive extension point.

## Alternatives considered

- Reusing `ctx.attachments` for uploads: rejected — the attachment seam is images-only by contract (decoded raster, width/height in the ref).
- A conversation.view tab (the ui-writing shape): rejected — the spec requires upload and browsing without entering a chat, and conversation.view is session-scoped.
- Ingest-time persistent index (FTS5/vector): deferred — query-time scoring is enough for demo-scale corpora and keeps the seam open for `session-query`-style backends.

## Verification

- 26 unit tests over chunking/scoring, the built-in converter, `safeFileName`, and the librarian service on the real storage hub/domain/JSON backend (temp `dshHome`).
- Live smoke against `dsh web`: notebook create, pasted-text ingest (`ready`, builtin), HTML upload through `/library/upload` (converted), resource listing, Markdown payload, inline raw and attachment download headers, and `ask` returning a grounded answer with correct chunk provenance against the mock LLM server.

## Deferred

- llm-wiki-style concept pages/backlinks, retrieval-engine selection, and Scheduled Search import (spec open questions; follow-up issues).
- Background conversion (ingest currently settles inline), host push for list refresh, rich Markdown preview, drag-and-drop upload.
- Per-user notebooks (the file root and records anticipate an ownership rebase via `dshHome`).
- Keyless snapshot transcript coverage and full gate verification (coverage/doc-sync/i18n quads/module-graph regeneration) for the new packages.
