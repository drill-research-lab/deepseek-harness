# Library

English | [简体中文](library.zh.md) | [繁體中文](library.zh-tw.md)

The [`packages/library`](../../packages/library/README.md) family owns the Library: a NotebookLM-shaped, multi-notebook knowledge base (Drill spec: drill-docs `features/wiki/spec.md`, issue #23) where every uploaded document is stored twice — the original file for human preview and download, and a converted Markdown twin for agent reading and retrieval. `ctx.librarian` ([`@deepseek-ai/dsh-library`](../../packages/library/library/README.md)) is the Service Definition; `ctx.library` ([`@deepseek-ai/dsh-library-api`](../../packages/library/library-api/README.md)) is the browser gateway projecting it onto the `library` Remote namespace plus the `/library` binary data plane.

## Storage shape

Notebook and resource records live in the `library` storage domain (`notebooks`/`resources` tables over `ctx.storageDomain`). Files live under `<DSH_HOME>/library/v1/<notebookId>/{original,markdown}`, addressed from records by notebook-relative names. Beside them the librarian maintains two sidecar files, both zod-validated at the read boundary and recoverable rather than load-bearing:

- `index.json` — the **ingest-time index**: per resource its outline (leading headings), a leading plain-text summary, and its heading-scoped chunks with precomputed term counts. Every content mutation (ingest settle, resource deletion) regenerates it, so `structure()` and `search()` cost one file read plus scoring — no document reads or re-tokenizing at query time. A missing, unreadable, or stale index (a notebook predating the feature, a hand-edited file, a rename that landed only in records) self-heals by rebuilding on first read.
- `ask-log.json` — the durable ask history, capped at its newest 200 entries. `ask()` appends every settled exchange; `recordAsk()` lets tool callers land subagent-answered exchanges in the same history, tagged by origin (`ui`/`agent`), so the Library page's thread also shows what agents asked from the chat.

## Conversion

`ingest()` is the single programmatic entry point (UI upload, `library_ingest`, future pipeline destinations). It stores the original, then runs the conversion seam: `registerConverter()` providers tried in descending priority — a markitdown Python subprocess (Office/PDF/EPUB/HTML, config-toggleable) above a dependency-free text fallback. A conversion failure keeps the original previewable and lands the record on `error`; content classes (`source`/`result`/`deliverable`) ride the record per the Drill spec.

## Asking

`ask()` grounds an answer in one notebook: index-served retrieval picks the best chunks (TF-IDF-weighted keywords, CJK bigrams plus Latin words), the configured model (config route, then the agent default selection) answers from those excerpts only, with citations; a question no keyword matches falls back to each document's leading content, and only a notebook with no readable content declines without a model call.

The agent face is the four `library_*` tools ([`@deepseek-ai/dsh-tool-library`](../../packages/library/tool-library/README.md)), shaped after the DeepWiki MCP face. `library_ask` delegates to the `librarian` subagent provider ([`@deepseek-ai/dsh-agent-librarian`](../../packages/library/agent-librarian/README.md)) when one is mounted and the caller is an agent: a fresh child navigates with `library_structure`/`library_read` (asking and filing are tool-filtered out, so it can never recurse) and answers with inline `[name]` citations; otherwise the direct service route answers. Either way the exchange lands in the ask log as an `agent` entry.

## Browser surface

[`@deepseek-ai/dsh-client-ui-library`](../../packages/client/ui-library/README.md) renders the sidebar notebook section and the full-page view (sources column, persistent ask thread, Markdown/original preview panel). The page state mirrors into the `#library/<notebookId>[/resource/<resourceId>]` URL hash both ways, so notebooks, documents, and the ask thread are linkable from outside the page. The `/library` data plane carries what the JSON-only `/api` gateway cannot: raw-body upload `POST` and inline/attachment original streaming, re-authenticated per request when an auth service is mounted.

## Boundaries and limitations

- Retrieval is keyword scoring over the ingest-time index; no embeddings or FTS5 backend yet (the seam anticipates one). The index rebuilds whole-notebook per mutation rather than incrementally, so very large notebooks pay at ingest.
- `ingest()` settles conversion inline; a large PDF holds its caller for the conversion's duration.
- Notebooks are per-install, not per-user; the file root anticipates an ownership rebase via the `dshHome` config.
- Delegated answers recover citations by exact `[name]` match against resource names; a child that paraphrases a name loses that source entry (the answer text keeps the inline citation).
- llm-wiki-style concept pages, retrieval-engine selection, and Scheduled Search import are spec open questions tracked in drill-docs.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxlibrarian--librarianservice"></a>

### `ctx.librarian` — `LibrarianService`

Durable notebook/resource registry plus the librarian behaviors on top of it. Files live under `<home>/library/v1/<notebookId>/{original,markdown}`; records point at them with notebook-relative names. Grounded answering resolves its model at call time (`config.provider`/`model` first, then the agent default selection), so the service composes without an LLM and only `ask` requires one.

```ts cordis-catalog
/**
 * Register one converter on the conversion seam. Converters are tried in
 * descending priority until one accepts and succeeds.
 * @param converter - The converter to add.
 * @returns the disposer that removes it.
 */
registerConverter(converter: LibraryConverter): () => void

/**
 * All notebooks, newest first.
 * @returns frozen notebook snapshots.
 */
listNotebooks(): Notebook[]

/**
 * Read one notebook.
 * @param id - Notebook id.
 * @returns the notebook snapshot, or `undefined` when unknown.
 */
notebook(id: NotebookId): Notebook | undefined

/**
 * Create one notebook.
 * @param title - Display title; duplicates are allowed.
 * @returns the new notebook snapshot.
 */
async createNotebook(title: string): Promise<Notebook>

/**
 * Replace a notebook's display title durably.
 * @param id - Notebook id.
 * @param title - New display title.
 * @returns the updated notebook snapshot.
 */
async renameNotebook(id: NotebookId, title: string): Promise<Notebook>

/**
 * Delete one notebook, its resource records, and its files.
 * @param id - Notebook id.
 * @returns `true` when the notebook existed, `false` when it was unknown.
 */
async deleteNotebook(id: NotebookId): Promise<boolean>

/**
 * All resources of one notebook, newest first.
 * @param notebookId - Owning notebook.
 * @returns frozen resource snapshots.
 */
listResources(notebookId: NotebookId): Resource[]

/**
 * Read one resource.
 * @param id - Resource id.
 * @returns the resource snapshot, or `undefined` when unknown.
 */
resource(id: ResourceId): Resource | undefined

/**
 * Delete one resource record and its stored files.
 * @param id - Resource id.
 * @returns `true` when the resource existed, `false` when it was unknown.
 */
async deleteResource(id: ResourceId): Promise<boolean>

/**
 * Ingest one document: store the original file, then convert it to Markdown
 * through the converter seam. The record passes `converting` and lands on
 * `ready` or `error` before this call resolves; a conversion failure keeps
 * the original file previewable. This method is the programmatic content
 * entry point shared by UI upload, model tools, and future pipeline flows.
 * @param request - Target notebook, display name, content class, and content.
 * @returns the settled resource snapshot (`ready` or `error`).
 */
async ingest(request: IngestRequest): Promise<Resource>

/**
 * Read the converted Markdown of one resource.
 * @param id - Resource id; the resource must be `ready`.
 * @returns the Markdown text.
 */
async readMarkdown(id: ResourceId): Promise<string>

/**
 * Absolute path of one resource's stored original file, for host-side
 * serving. Never derived from client input beyond the resource id.
 * @param id - Resource id.
 * @returns the absolute path and the stored media type.
 */
originalFileOf(id: ResourceId): { path: string; mediaType: string; name: string }

/**
 * Structure listing across notebooks: every notebook with its resources,
 * their leading Markdown headings, and a leading excerpt — the librarian's
 * navigation answer, read from the ingest-time index rather than the
 * documents.
 * @param notebookId - Restrict to one notebook; omitted lists all.
 * @returns notebook structures, newest notebook first.
 */
async structure(notebookId?: NotebookId): Promise<NotebookStructure[]>

/**
 * Retrieve the most relevant converted-Markdown chunks of one notebook.
 * Chunks and term counts come from the ingest-time index, so one search
 * costs one index read plus scoring — no document reads or re-tokenizing.
 * @param notebookId - Notebook to search.
 * @param query - Natural-language query.
 * @param limit - Maximum chunks returned.
 * @returns scored chunks, best first; empty when nothing matches.
 */
async search(notebookId: NotebookId, query: string, limit: number): Promise<ScoredChunk[]>

/**
 * Answer one question grounded in a notebook's converted documents: retrieve
 * the best chunks, then ask the configured model to answer from them with
 * inline citations. A question with no keyword match (an overview ask like
 * "introduce this") falls back to each document's leading content, so it
 * still answers grounded; only a notebook with no readable content declines
 * (`grounded: false`) without a model call. Every settled exchange is
 * appended to the notebook's durable ask log.
 * @param notebookId - Notebook to answer from.
 * @param question - Natural-language question.
 * @param signal - Optional caller cancellation.
 * @param origin - Who asked, recorded in the log; defaults to the page (`ui`).
 * @returns the grounded answer with its excerpt provenance.
 */
async ask(notebookId: NotebookId, question: string, signal?: AbortSignal, origin: AskOrigin = 'ui'): Promise<AskResult>

/**
 * Read one notebook's ask history, oldest first.
 * @param notebookId - Notebook whose log to read.
 * @returns recorded exchanges; empty for a notebook never asked.
 */
async askLog(notebookId: NotebookId): Promise<AskLogEntry[]>

/**
 * Append one settled exchange to a notebook's durable ask log. `ask` calls
 * this for the direct route; the `library_ask` tool calls it for
 * subagent-answered questions so agent asks land in the same history the
 * Library page shows.
 * @param notebookId - Notebook the question was asked of.
 * @param exchange - Origin, question, and the settled answer.
 * @returns the recorded entry with its id and instant.
 */
async recordAsk( notebookId: NotebookId, exchange: Omit<AskLogEntry, 'id' | 'createdAt'>, ): Promise<AskLogEntry>
```

Source: [`packages/library/library/src/index.ts:175`](../../packages/library/library/src/index.ts)

<a id="ctxlibrary--librarygateway"></a>

### `ctx.library` — `LibraryGateway`

The browser-facing library contract. `static inject` lists only the service the Remote methods read; the `/library` routes register through an optional `webServer` injection, so a composition without the web server can mount the gateway without serving files.

```ts cordis-catalog
/**
 * All notebooks with their resource counts, newest first.
 * @returns projected notebook views.
 */
@Remote('listNotebooks') listNotebooks(): NotebookView[]

/**
 * Create one notebook.
 * @param request - display title.
 * @returns the new notebook view.
 */
@Remote('createNotebook') async createNotebook(request: CreateNotebookRequest): Promise<NotebookView>

/**
 * Rename one notebook.
 * @param request - notebook id and new title.
 * @returns the updated notebook view.
 */
@Remote('renameNotebook') async renameNotebook(request: RenameNotebookRequest): Promise<NotebookView>

/**
 * Delete one notebook, its resources, and its files.
 * @param request - notebook id.
 * @returns whether the notebook existed.
 */
@Remote('deleteNotebook') deleteNotebook(request: NotebookRequest): Promise<boolean>

/**
 * All resources of one notebook, newest first.
 * @param request - notebook id.
 * @returns projected resource views.
 */
@Remote('listResources') listResources(request: NotebookRequest): ResourceView[]

/**
 * Delete one resource and its stored files.
 * @param request - resource id.
 * @returns whether the resource existed.
 */
@Remote('deleteResource') deleteResource(request: ResourceRequest): Promise<boolean>

/**
 * Ingest pasted text as a new resource (the NotebookLM paste-source flow).
 * @param request - notebook, display name, text, and content class.
 * @returns the settled resource view.
 */
@Remote('ingestText') async ingestText(request: IngestTextRequest): Promise<ResourceView>

/**
 * Read the converted Markdown of one resource for the inline preview.
 * @param request - resource id.
 * @returns the Markdown payload.
 */
@Remote('readMarkdown') async readMarkdown(request: ResourceRequest): Promise<MarkdownView>

/**
 * Answer one question grounded in a notebook's documents.
 * @param request - notebook id and question.
 * @param signal - cooperative cancellation from the browser.
 * @returns the grounded answer view.
 */
@Remote('ask') async ask(request: AskRequest, signal: AbortSignal): Promise<AskView>

/**
 * One notebook's durable ask history, oldest first — the Library page's
 * persistent thread, including exchanges agents asked from the chat.
 * @param request - notebook id.
 * @returns recorded exchanges.
 */
@Remote('askLog') async askLog(request: NotebookRequest): Promise<AskLogEntryView[]>
```

Source: [`packages/library/library-api/src/index.ts:64`](../../packages/library/library-api/src/index.ts)
<!-- END GENERATED cordis-surface -->
