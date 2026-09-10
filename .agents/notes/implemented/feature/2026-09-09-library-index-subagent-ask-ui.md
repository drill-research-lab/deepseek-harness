# Agent Note: Library — ingest-time index, librarian-delegated ask, durable ask log, NotebookLM-style page

Status: implemented

## Problem

Issue #23's demo review left four gaps on the first Library iteration (PR #45): the agent access tools did not follow the issue's three-tool split (`ask_question` was answered inline by the service instead of the librarian subagent; `read_wiki_structure` re-read every document per call), no structure/index file was generated at ingest so every structure read and search re-read and re-tokenized the whole notebook, Markdown and PDF had no separate preview modes, and the page UI (in-page notebook column duplicating the sidebar, `window.prompt` dialogs, `<pre>` previews) did not match the DSH design language. Ask exchanges were also view-local — gone on reload, unreachable from outside the page.

## Decision

All additive, inside the existing `packages/library/` + `client/ui-library/` families:

- **Ingest-time index** (`library/`): every content mutation regenerates `<notebook>/index.json` — per resource its outline, a leading plain-text summary, and heading-scoped chunks with precomputed term counts (`sidecars.ts` zod schemas at the read boundary). `structure()` and `search()` are served from the index (one file read + scoring; `scoreCountedChunks` is the query-time half of the existing TF-IDF), and a missing/invalid/stale index self-heals by rebuilding on first read, which migrates pre-index notebooks. This is the issue's write-side "librarian maintains the list at ingest" duty.
- **Durable ask log** (`library/`): `<notebook>/ask-log.json`, capped at the newest 200 entries; `ask()` appends every settled exchange, `recordAsk()` lets tool callers land subagent-answered exchanges tagged `origin: 'agent'`, `askLog()` reads oldest-first. Sidecar files rather than new domain tables because the domain contract rejects version drift without migration and both files are derived/append-only data the service can recover from.
- **Delegated `library_ask`** (`tool-library/`): with a `librarian` provider mounted and an agent caller, the question starts a fresh librarian child (`ctx.subagents.start`) whose tool filter denies `library_ask`/`library_ingest` (no recursion, no writes); the child navigates with `library_structure`/`library_read` and answers with inline `[name]` citations, recovered against resource names for the sources array. No subagent runtime or non-agent caller falls back to the service's direct route with `origin: 'agent'`. The librarian persona no longer instructs answering through `library_ask`.
- **Page redesign** (`ui-library/`): NotebookLM-shaped three-region layout — sources column (add-source modal with upload/paste tabs and drag-drop, type icons, hover actions, `Modal` confirms), the persistent ask thread as the main area (renders the durable log, agent entries tagged, `MarkdownText` answers, citation pills opening the cited document), and a collapsible preview panel with separate **Markdown** (rendered) and **original/PDF** (raw iframe) modes. The in-page notebook column is gone; the sidebar section is the only notebook switcher, and the header carries the title + actions menu.
- **Deep links** (`ui-library/`): the page state (notebook + preview resource) mirrors into `#library/<notebookId>[/resource/<resourceId>]` both ways (boot + `hashchange` in, `history.replaceState` out), so documents and the ask thread are linkable from outside the page.
- `library-api` gains the `askLog` Remote method; the regenerated typert client carries it.

## Alternatives considered

- Ask log/index as new `library` domain tables: rejected — the storage-domain contract rejects a version-stamped medium mismatch with no migration path, and a table addition is not contractually compatible; sidecar JSON files beside the documents match the "index 文件 in the workdir" ask and self-heal trivially.
- Structured subagent output (`outputSchema`) for sources: rejected for now — citation-by-name recovery is deterministic and keeps the child contract prompt-only; a schema capture that fails still costs the run.
- A custom `tool.call.toolview` chat card for `library_*` results: deferred — `ToolRow` is package-private to `ui-tool`, and hash deep links already make documents linkable from chat text.

## Consequences

- Structure reads and searches no longer scale with document count per query; ingest pays the whole-notebook index rebuild instead, so a very large notebook makes uploads slower, not reads.
- `library_ask` from chat now costs a subagent run (its own agent loop) instead of one auxiliary LLM call; compositions without a subagent runtime keep the old cost via the fallback.
- Ask history is durable and shared between the page and agents: anything asked through `library_ask` is visible to anyone opening the notebook's Library page.
- The `#library/…` hash is now an API of sorts — links written into chats or docs keep working only as long as the address grammar stays stable.

## Verification

- Library service: 32 unit tests (index written at ingest and serving structure/search with the documents clobbered on disk, missing-index self-heal, stale-title rebuild, ask-log recording/order/cap) on the real storage hub/domain/JSON backend.
- `tool-library`: 6 new tests driving the real plugin through `ctx.tools.execute` over a real `SubagentRuntime` with the scripted provider registered as `librarian` — delegation prompt/tool-filter contents, ask-log landing, abnormal-stop surfacing, both fallback routes, zh-Hans title tolerance.
- `ui-library`: 9 client tests (hash address round-trip incl. percent-encoding; jsdom renders of the header/sources/thread, preview modes for Markdown vs PDF, citation pill → preview address).
- Full `build:lib:host` + `build:lib:client` green; tool catalog regenerated.

## Deferred

- Incremental index maintenance (rebuild is whole-notebook per mutation) and embedding/FTS5 retrieval backends.
- Host push for list/thread refresh; citation scroll-to-heading in the preview.
- A `tool.call.toolview` chat card linking `library_ask` results into the page.
