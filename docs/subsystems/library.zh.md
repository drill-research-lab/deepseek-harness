# Library 知识库

[English](library.md) | 简体中文 | [繁體中文](library.zh-tw.md)

[`packages/library`](../../packages/library/README.md) 家族拥有 Library：NotebookLM 形态的多知识库系统（Drill 规格：drill-docs `features/wiki/spec.md`，issue #23），每份上传文件都保存两份 — 原始文件供人预览与下载，转换后的 Markdown 供 agent 阅读与检索。`ctx.librarian`（[`@deepseek-ai/dsh-library`](../../packages/library/library/README.md)）是 Service Definition；`ctx.library`（[`@deepseek-ai/dsh-library-api`](../../packages/library/library-api/README.md)）是浏览器网关，把它投影成 `library` Remote 命名空间加上 `/library` 二进制数据通道。

## 存储形态

知识库与资源记录放在 `library` 存储领域（经 `ctx.storageDomain` 的 `notebooks`/`resources` 表）。文件放在 `<DSH_HOME>/library/v1/<notebookId>/{original,markdown}`，记录以相对于知识库的文件名指向它们。旁边由 librarian 维护两个边车文件，读取边界都经 zod 验证，且皆可重建而非承重：

- `index.json` — **入库时索引**：每份资源的大纲（前导标题）、前导纯文本摘要、以及带预先统计词频的标题分段 chunk。每次内容变动（入库落定、删除资源）都会重新生成，所以 `structure()` 与 `search()` 只需一次文件读取加计分 — 查询时不再读文件、不再重新分词。索引缺失、无法解析或过期（早于此功能的知识库、被手改的文件、只落在记录上的改名）会在首次读取时自我修复重建。
- `ask-log.json` — 持久的问答记录，保留最新 200 条。`ask()` 把每次落定的问答追加进去；`recordAsk()` 让工具调用端把 subagent 回答的问答记进同一份历史，以来源（`ui`/`agent`）标记，所以 Library 页的讨论串也会显示 agent 从聊天中问过什么。

## 转换

`ingest()` 是唯一的程序化入口（UI 上传、`library_ingest`、未来的 pipeline 目的地）。先保存原始文件，再走转换接缝：`registerConverter()` 提供者按优先级递减尝试 — markitdown Python 子进程（Office/PDF/EPUB/HTML，可由配置关闭）在上，无依赖的文本后备在下。转换失败会保留可预览的原始文件并把记录落在 `error`；内容类别（`source`/`result`/`deliverable`）按 Drill 规格随记录保存。

## 提问

`ask()` 以单一知识库为根据回答：由索引供应的检索挑出最佳 chunk（TF-IDF 加权关键词，CJK 双字组加拉丁词），配置的模型（配置路由，其次 agent 默认选择）仅根据这些摘录回答并附引用；没有关键词命中的问题（总览式提问）退回每份文件的前导内容，只有没有可读内容的知识库才会不调用模型直接婉拒。

Agent 面是四个 `library_*` 工具（[`@deepseek-ai/dsh-tool-library`](../../packages/library/tool-library/README.md)），按 DeepWiki MCP 的接口形状设计。当 `librarian` subagent 提供者（[`@deepseek-ai/dsh-agent-librarian`](../../packages/library/agent-librarian/README.md)）已挂载且调用者是 agent 时，`library_ask` 会委派给它：一个全新子代理用 `library_structure`/`library_read` 导览（提问与写入被工具过滤排除，因此绝不会递归），以行内 `[name]` 引用作答；否则走服务的直接路径。两条路径的问答都会以 `agent` 来源记入问答记录。

## 浏览器界面

[`@deepseek-ai/dsh-client-ui-library`](../../packages/client/ui-library/README.md) 渲染侧栏知识库区块与整页视图（来源栏、持久问答串、Markdown/原始文件预览面板）。页面状态与 `#library/<notebookId>[/resource/<resourceId>]` URL hash 双向镜像，所以知识库、文件与问答串都能从页面外链接进来。`/library` 数据通道承载仅接受 JSON 的 `/api` 网关载不动的部分：raw-body 上传 `POST` 与原始文件的行内／附件流式传输，挂载鉴权服务时每个请求重新鉴权。

## 边界与限制

- 检索是对入库时索引的关键词计分；还没有 embedding 或 FTS5 后端（接缝已预留）。索引每次变动整本重建而非增量，超大知识库在入库时付出成本。
- `ingest()` 行内落定转换；大型 PDF 会让调用端等待转换完成。
- 知识库属于安装而非用户；文件根目录通过 `dshHome` 配置预留所有权迁移。
- 委派回答以资源名称精确比对 `[name]` 回收引用；子代理改写名称会丢失该来源条目（回答文本仍保留行内引用）。
- llm-wiki 式概念页、检索引擎选型、Scheduled Search 导入是 drill-docs 跟踪的规格开放问题。

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
