# Library 知識庫

[English](library.md) | [简体中文](library.zh.md) | 繁體中文

[`packages/library`](../../packages/library/README.md) 家族擁有 Library：NotebookLM 形態的多知識庫系統（Drill 規格：drill-docs `features/wiki/spec.md`，issue #23），每份上傳文件都保存兩份 — 原始檔供人預覽與下載，轉換後的 Markdown 供 agent 閱讀與檢索。`ctx.librarian`（[`@deepseek-ai/dsh-library`](../../packages/library/library/README.md)）是 Service Definition；`ctx.library`（[`@deepseek-ai/dsh-library-api`](../../packages/library/library-api/README.md)）是瀏覽器閘道，把它投影成 `library` Remote 命名空間加上 `/library` 二進位資料通道。

## 儲存形態

知識庫與資源記錄放在 `library` 儲存領域（經 `ctx.storageDomain` 的 `notebooks`/`resources` 表）。檔案放在 `<DSH_HOME>/library/v1/<notebookId>/{original,markdown}`，記錄以相對於知識庫的檔名指向它們。旁邊由 librarian 維護兩個側車檔，讀取邊界都經 zod 驗證，且皆可重建而非承重：

- `index.json` — **入庫時索引**：每份資源的大綱（前導標題）、前導純文字摘要、以及帶預先統計詞頻的標題分段 chunk。每次內容變動（入庫落定、刪除資源）都會重新生成，所以 `structure()` 與 `search()` 只需一次檔案讀取加計分 — 查詢時不再讀文件、不再重新分詞。索引缺失、無法解析或過期（早於此功能的知識庫、被手改的檔案、只落在記錄上的改名）會在首次讀取時自我修復重建。
- `ask-log.json` — 持久的問答紀錄，保留最新 200 筆。`ask()` 把每次落定的問答附加進去；`recordAsk()` 讓工具呼叫端把 subagent 回答的問答記進同一份歷史，以來源（`ui`/`agent`）標記，所以 Library 頁的討論串也會顯示 agent 從聊天中問過什麼。

## 轉換

`ingest()` 是唯一的程式化入口（UI 上傳、`library_ingest`、未來的 pipeline 目的地）。先保存原始檔，再走轉換接縫：`registerConverter()` 供應者依優先度遞減嘗試 — markitdown Python 子行程（Office/PDF/EPUB/HTML，可由設定關閉）在上，無依賴的文字後援在下。轉換失敗會保留可預覽的原始檔並把記錄落在 `error`；內容類別（`source`/`result`/`deliverable`）依 Drill 規格隨記錄保存。

## 提問

`ask()` 以單一知識庫為根據回答：由索引供應的檢索挑出最佳 chunk（TF-IDF 加權關鍵詞，CJK 雙字組加拉丁詞），設定的模型（設定路由，其次 agent 預設選擇）僅根據這些摘錄回答並附引用；沒有關鍵詞命中的問題（總覽式提問）退回每份文件的前導內容，只有沒有可讀內容的知識庫才會不呼叫模型直接婉拒。

Agent 面是四個 `library_*` 工具（[`@deepseek-ai/dsh-tool-library`](../../packages/library/tool-library/README.md)），依 DeepWiki MCP 的介面形狀設計。當 `librarian` subagent 供應者（[`@deepseek-ai/dsh-agent-librarian`](../../packages/library/agent-librarian/README.md)）已掛載且呼叫者是 agent 時，`library_ask` 會委派給它：一個全新子代理用 `library_structure`/`library_read` 導覽（提問與寫入被工具過濾排除，因此絕不會遞迴），以行內 `[name]` 引用作答；否則走服務的直接路徑。兩條路徑的問答都會以 `agent` 來源記入問答紀錄。

## 瀏覽器介面

[`@deepseek-ai/dsh-client-ui-library`](../../packages/client/ui-library/README.md) 渲染側欄知識庫區塊與整頁視圖（來源欄、持久問答串、Markdown/原始檔預覽面板）。頁面狀態與 `#library/<notebookId>[/resource/<resourceId>]` URL hash 雙向鏡射，所以知識庫、文件與問答串都能從頁面外連結進來。`/library` 資料通道承載僅接受 JSON 的 `/api` 閘道載不動的部分：raw-body 上傳 `POST` 與原始檔的行內／附件串流，掛載驗證服務時每個請求重新驗證。

## 邊界與限制

- 檢索是對入庫時索引的關鍵詞計分；還沒有 embedding 或 FTS5 後端（接縫已預留）。索引每次變動整本重建而非增量，超大知識庫在入庫時付出成本。
- `ingest()` 行內落定轉換；大型 PDF 會讓呼叫端等待轉換完成。
- 知識庫屬於安裝而非使用者；檔案根目錄透過 `dshHome` 設定預留所有權移轉。
- 委派回答以資源名稱精確比對 `[name]` 回收引用；子代理改寫名稱會遺失該來源條目（回答文字仍保留行內引用）。
- llm-wiki 式概念頁、檢索引擎選型、Scheduled Search 匯入是 drill-docs 追蹤的規格開放問題。

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
