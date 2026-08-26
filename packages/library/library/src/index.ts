/**
 * Librarian service (`ctx.librarian`): durable multi-notebook knowledge base
 * with document-to-Markdown conversion, keyword retrieval, and grounded
 * question answering. Uploads keep the original file for preview beside the
 * converted Markdown agents read; conversion runs on a provider seam
 * (markitdown subprocess, built-in text fallback) so deployments can swap
 * tools without touching this service.
 * @module @deepseek-ai/dsh-library
 */

import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
// Type-only: resolves ctx.agentDefaultModel for the ask-time route fallback.
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { chunkMarkdown, outlineOf, scoreChunks } from './chunk.ts'
import type { Chunk, ScoredChunk } from './chunk.ts'
import { builtinTextConverter } from './convert/builtin.ts'
import { markitdownConverter } from './convert/markitdown.ts'
import type { ConvertInput, LibraryConverter } from './convert/types.ts'
import { libraryDomainSpec } from './spec.ts'
import type { NotebookRecord, ResourceRecord } from './spec.ts'
import { mediaTypeOf } from './types.ts'
import type {
  AskResult,
  AskSource,
  IngestRequest,
  Notebook,
  NotebookId,
  NotebookStructure,
  Resource,
  ResourceId,
} from './types.ts'

export { chunkMarkdown, outlineOf, scoreChunks, termsOf } from './chunk.ts'
export type { Chunk, ScoredChunk } from './chunk.ts'
export { builtinTextConverter, htmlToMarkdown } from './convert/builtin.ts'
export { markitdownConverter } from './convert/markitdown.ts'
export type { ConvertInput, LibraryConverter } from './convert/types.ts'
export { libraryDomainSpec } from './spec.ts'
export type { NotebookRecord, ResourceRecord } from './spec.ts'
export * from './types.ts'

/**
 * Brand a string as a {@link NotebookId}.
 * @param id - Raw notebook id string.
 * @returns the same string, branded at compile time.
 */
export function NotebookId(id: string): NotebookId {
  return id as NotebookId
}

/**
 * Brand a string as a {@link ResourceId}.
 * @param id - Raw resource id string.
 * @returns the same string, branded at compile time.
 */
export function ResourceId(id: string): ResourceId {
  return id as ResourceId
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    librarian: LibrarianService
  }
}

/** Deployment configuration of the librarian service. */
export interface Config {
  /** Explicit harness home; omitted follows `DSH_HOME`, then `~/.dsh`. */
  readonly dshHome?: string
  /** Whether the markitdown subprocess converter registers at startup. */
  readonly markitdown: boolean
  /** Python executable used to run `python -m markitdown`. */
  readonly python: string
  /** Whole-conversion timeout in milliseconds. */
  readonly convertTimeoutMs: number
  /** Ask-time model provider; omitted follows the agent default selection. */
  readonly provider?: string
  /** Ask-time model; omitted follows the agent default selection. */
  readonly model?: string
  /** Maximum grounding excerpts retrieved for one question. */
  readonly searchLimit: number
  /** Output token bound of one grounded answer. */
  readonly maxAnswerTokens: number
  /** Whole-answer deadline in milliseconds. */
  readonly askTimeoutMs: number
}

/** Schemastery configuration for the librarian service. */
export const Config: z<Config> = z.object({
  dshHome: z.string(),
  markitdown: z.boolean().default(true),
  python: z.string().default('python'),
  convertTimeoutMs: z.number().step(1).min(1000).default(120_000),
  provider: z.string(),
  model: z.string(),
  searchLimit: z.number().step(1).min(1).default(8),
  maxAnswerTokens: z.number().step(1).min(64).default(2048),
  askTimeoutMs: z.number().step(1).min(1000).default(60_000),
})

const LIBRARIAN_SYSTEM_PROMPT =
  'You are the Librarian of a research knowledge base. Answer the question using ONLY the '
  + 'provided excerpts. Cite the excerpts you used inline as [name] after each claim. When the '
  + 'excerpts do not contain the answer, say so plainly instead of guessing. Answer in the same '
  + 'language as the question.'

const byCreatedDesc = <T extends { readonly createdAt: string; readonly id: string }>(
  left: T,
  right: T,
): number =>
  right.createdAt.localeCompare(left.createdAt) || String(left.id).localeCompare(String(right.id))

/** Directory holding original uploads inside one notebook directory. */
const ORIGINAL_DIR = 'original'

/** Directory holding converted Markdown inside one notebook directory. */
const MARKDOWN_DIR = 'markdown'

/** Longest stored file-name stem preserved from a display name. */
const MAX_SAFE_NAME = 120

/**
 * Reduce a display name to a safe file name: path separators and control
 * characters become `_`, and overlong names keep their extension.
 * @param name - Caller-supplied display name.
 * @returns a non-empty file-system-safe name.
 */
export function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim()
  if (cleaned === '' || cleaned === '.' || cleaned === '..') return 'document'
  if (cleaned.length <= MAX_SAFE_NAME) return cleaned
  const dot = cleaned.lastIndexOf('.')
  const extension = dot > 0 ? cleaned.slice(dot) : ''
  return cleaned.slice(0, MAX_SAFE_NAME - extension.length) + extension
}

/**
 * Durable notebook/resource registry plus the librarian behaviors on top of
 * it. Files live under `<home>/library/v1/<notebookId>/{original,markdown}`;
 * records point at them with notebook-relative names. Grounded answering
 * resolves its model at call time (`config.provider`/`model` first, then the
 * agent default selection), so the service composes without an LLM and only
 * `ask` requires one.
 */
export class LibrarianService extends Service {
  static inject = ['storageDomain']

  static Config: z<Config> = Config

  private notebooksTable?: KvTable<NotebookId, NotebookRecord>
  private resourcesTable?: KvTable<ResourceId, ResourceRecord>
  private readonly converters: LibraryConverter[] = []
  private readonly root: string

  /**
   * @param ctx - Host context carrying the storage-domain form.
   * @param config - validated deployment configuration.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'librarian')
    this.root = resolve(join(resolveDshHome(config.dshHome), 'library', 'v1'))
    this.registerConverter(builtinTextConverter)
    if (config.markitdown) {
      this.registerConverter(markitdownConverter({ python: config.python, timeoutMs: config.convertTimeoutMs }))
    }
  }

  /** Open and own the library domain and ensure the file root exists. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(libraryDomainSpec)
    this.ctx.effect(() => async () => { await domain.close() }, 'library.domainClose')
    this.notebooksTable = domain.table('notebooks')
    this.resourcesTable = domain.table('resources')
    await mkdir(this.root, { recursive: true })
  }

  /**
   * Register one converter on the conversion seam. Converters are tried in
   * descending priority until one accepts and succeeds.
   * @param converter - The converter to add.
   * @returns the disposer that removes it.
   */
  registerConverter(converter: LibraryConverter): () => void {
    return this.ctx.effect(() => {
      this.converters.push(converter)
      this.converters.sort((left, right) => right.priority - left.priority)
      return () => {
        const index = this.converters.indexOf(converter)
        if (index >= 0) this.converters.splice(index, 1)
      }
    }, `library.converter:${converter.id}`)
  }

  /**
   * All notebooks, newest first.
   * @returns frozen notebook snapshots.
   */
  listNotebooks(): Notebook[] {
    return [...this.requireNotebooks().entries()]
      .map(([id, record]) => snapshotNotebook(id, record))
      .sort(byCreatedDesc)
  }

  /**
   * Read one notebook.
   * @param id - Notebook id.
   * @returns the notebook snapshot, or `undefined` when unknown.
   */
  notebook(id: NotebookId): Notebook | undefined {
    const record = this.requireNotebooks().get(id)
    return record === undefined ? undefined : snapshotNotebook(id, record)
  }

  /**
   * Create one notebook.
   * @param title - Display title; duplicates are allowed.
   * @returns the new notebook snapshot.
   */
  async createNotebook(title: string): Promise<Notebook> {
    const id = NotebookId(randomUUID())
    const now = new Date().toISOString()
    const record: NotebookRecord = { title, createdAt: now, updatedAt: now }
    await this.requireNotebooks().put(id, record)
    await mkdir(join(this.root, id, ORIGINAL_DIR), { recursive: true })
    await mkdir(join(this.root, id, MARKDOWN_DIR), { recursive: true })
    return snapshotNotebook(id, record)
  }

  /**
   * Replace a notebook's display title durably.
   * @param id - Notebook id.
   * @param title - New display title.
   * @returns the updated notebook snapshot.
   */
  async renameNotebook(id: NotebookId, title: string): Promise<Notebook> {
    const record = await this.requireNotebooks().update(id, current => ({
      ...current,
      title,
      updatedAt: new Date().toISOString(),
    }))
    return snapshotNotebook(id, record)
  }

  /**
   * Delete one notebook, its resource records, and its files.
   * @param id - Notebook id.
   * @returns `true` when the notebook existed, `false` when it was unknown.
   */
  async deleteNotebook(id: NotebookId): Promise<boolean> {
    const existing = this.requireNotebooks().get(id)
    if (existing === undefined) return false
    const resources = this.requireResources()
    for (const [resourceId, record] of resources.entries()) {
      if (record.notebookId === id) await resources.delete(resourceId)
    }
    await this.requireNotebooks().delete(id)
    await rm(join(this.root, id), { recursive: true, force: true })
    return true
  }

  /**
   * All resources of one notebook, newest first.
   * @param notebookId - Owning notebook.
   * @returns frozen resource snapshots.
   */
  listResources(notebookId: NotebookId): Resource[] {
    return [...this.requireResources().entries()]
      .filter(([, record]) => record.notebookId === notebookId)
      .map(([id, record]) => snapshotResource(id, record))
      .sort(byCreatedDesc)
  }

  /**
   * Read one resource.
   * @param id - Resource id.
   * @returns the resource snapshot, or `undefined` when unknown.
   */
  resource(id: ResourceId): Resource | undefined {
    const record = this.requireResources().get(id)
    return record === undefined ? undefined : snapshotResource(id, record)
  }

  /**
   * Delete one resource record and its stored files.
   * @param id - Resource id.
   * @returns `true` when the resource existed, `false` when it was unknown.
   */
  async deleteResource(id: ResourceId): Promise<boolean> {
    const record = this.requireResources().get(id)
    if (record === undefined) return false
    await this.requireResources().delete(id)
    await rm(join(this.root, record.notebookId, ORIGINAL_DIR, record.originalFile), { force: true })
    if (record.markdownFile !== undefined) {
      await rm(join(this.root, record.notebookId, MARKDOWN_DIR, record.markdownFile), { force: true })
    }
    return true
  }

  /**
   * Ingest one document: store the original file, then convert it to Markdown
   * through the converter seam. The record passes `converting` and lands on
   * `ready` or `error` before this call resolves; a conversion failure keeps
   * the original file previewable. This method is the programmatic content
   * entry point shared by UI upload, model tools, and future pipeline flows.
   * @param request - Target notebook, display name, content class, and content.
   * @returns the settled resource snapshot (`ready` or `error`).
   */
  async ingest(request: IngestRequest): Promise<Resource> {
    if (this.requireNotebooks().get(request.notebookId) === undefined) {
      throw new Error(`unknown notebook '${request.notebookId}'`)
    }
    const id = ResourceId(randomUUID())
    const name = safeFileName(request.name)
    const originalFile = `${id}__${name}`
    const originalPath = join(this.root, request.notebookId, ORIGINAL_DIR, originalFile)
    await mkdir(join(this.root, request.notebookId, ORIGINAL_DIR), { recursive: true })
    await mkdir(join(this.root, request.notebookId, MARKDOWN_DIR), { recursive: true })
    if ('data' in request.content) {
      await writeFile(originalPath, request.content.data)
    } else if ('text' in request.content) {
      await writeFile(originalPath, request.content.text, 'utf8')
    } else {
      await copyFile(request.content.path, originalPath)
    }
    const bytes = (await stat(originalPath)).size
    const now = new Date().toISOString()
    const record: ResourceRecord = {
      notebookId: request.notebookId,
      name,
      kind: request.kind ?? 'source',
      status: 'converting',
      mediaType: mediaTypeOf(name),
      bytes,
      originalFile,
      createdAt: now,
      updatedAt: now,
    }
    await this.requireResources().put(id, record)
    await this.touchNotebook(request.notebookId)
    return await this.convert(id, record, originalPath)
  }

  /**
   * Read the converted Markdown of one resource.
   * @param id - Resource id; the resource must be `ready`.
   * @returns the Markdown text.
   */
  async readMarkdown(id: ResourceId): Promise<string> {
    const record = this.requireResource(id)
    if (record.status !== 'ready' || record.markdownFile === undefined) {
      throw new Error(`resource '${id}' has no converted Markdown (status: ${record.status})`)
    }
    return await readFile(join(this.root, record.notebookId, MARKDOWN_DIR, record.markdownFile), 'utf8')
  }

  /**
   * Absolute path of one resource's stored original file, for host-side
   * serving. Never derived from client input beyond the resource id.
   * @param id - Resource id.
   * @returns the absolute path and the stored media type.
   */
  originalFileOf(id: ResourceId): { path: string; mediaType: string; name: string } {
    const record = this.requireResource(id)
    return {
      path: join(this.root, record.notebookId, ORIGINAL_DIR, record.originalFile),
      mediaType: record.mediaType,
      name: record.name,
    }
  }

  /**
   * Structure listing across notebooks: every notebook with its resources and
   * their leading Markdown headings — the librarian's navigation answer.
   * @param notebookId - Restrict to one notebook; omitted lists all.
   * @returns notebook structures, newest notebook first.
   */
  async structure(notebookId?: NotebookId): Promise<NotebookStructure[]> {
    const notebooks = notebookId === undefined
      ? this.listNotebooks()
      : this.listNotebooks().filter(notebook => notebook.id === notebookId)
    const structures: NotebookStructure[] = []
    for (const notebook of notebooks) {
      const resources = []
      for (const resource of this.listResources(notebook.id)) {
        resources.push({
          resourceId: resource.id,
          name: resource.name,
          kind: resource.kind,
          status: resource.status,
          outline: resource.status === 'ready' ? outlineOf(await this.readMarkdown(resource.id), 12) : [],
        })
      }
      structures.push({ notebookId: notebook.id, title: notebook.title, resources })
    }
    return structures
  }

  /**
   * Retrieve the most relevant converted-Markdown chunks of one notebook.
   * @param notebookId - Notebook to search.
   * @param query - Natural-language query.
   * @param limit - Maximum chunks returned.
   * @returns scored chunks, best first; empty when nothing matches.
   */
  async search(notebookId: NotebookId, query: string, limit: number): Promise<ScoredChunk[]> {
    const chunks: Chunk[] = []
    for (const resource of this.listResources(notebookId)) {
      if (resource.status !== 'ready') continue
      chunks.push(...chunkMarkdown(String(resource.id), resource.name, await this.readMarkdown(resource.id)))
    }
    return scoreChunks(chunks, query, limit)
  }

  /**
   * Answer one question grounded in a notebook's converted documents: retrieve
   * the best chunks, then ask the configured model to answer from them with
   * inline citations. Without any grounding excerpt the result declines
   * (`grounded: false`) instead of calling the model.
   * @param notebookId - Notebook to answer from.
   * @param question - Natural-language question.
   * @param signal - Optional caller cancellation.
   * @returns the grounded answer with its excerpt provenance.
   */
  async ask(notebookId: NotebookId, question: string, signal?: AbortSignal): Promise<AskResult> {
    if (this.requireNotebooks().get(notebookId) === undefined) {
      throw new Error(`unknown notebook '${notebookId}'`)
    }
    const excerpts = await this.search(notebookId, question, this.config.searchLimit)
    if (excerpts.length === 0) {
      return {
        answer: 'No matching content was found in this notebook for the question.',
        sources: [],
        grounded: false,
      }
    }
    const llm = this.ctx.get('llm')
    if (llm === undefined) throw new Error('librarian ask requires the llm service; none is mounted')
    const route = this.askRoute()
    const excerptBlock = excerpts
      .map((excerpt, index) =>
        `[${index + 1}] ${excerpt.resourceName}${excerpt.heading === '' ? '' : ` — ${excerpt.heading}`}\n${excerpt.text}`)
      .join('\n\n---\n\n')
    const messages: Message[] = [createUserMessage({
      content: [{
        type: 'text',
        text: `Excerpts:\n\n${excerptBlock}\n\nQuestion: ${question}`,
      }],
      source: { kind: 'plugin', plugin: 'dsh-library' },
    })]
    const askSignal = signal === undefined
      ? AbortSignal.timeout(this.config.askTimeoutMs)
      : AbortSignal.any([signal, AbortSignal.timeout(this.config.askTimeoutMs)])
    const options: GenerateOptions = {
      provider: route.provider,
      model: route.model,
      messages,
      system: LIBRARIAN_SYSTEM_PROMPT,
      maxTokens: this.config.maxAnswerTokens,
      signal: askSignal,
    }
    const assembler = new BlockAssembler()
    for await (const chunk of llm.stream(options)) {
      askSignal.throwIfAborted()
      assembler.push(chunk)
    }
    const finish = assembler.finish
    if (finish.kind !== 'stop' && finish.kind !== 'max-tokens') {
      throw new Error(`librarian ask ended with '${finish.kind}' instead of an answer`)
    }
    const answer = assembler.blocks()
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n')
      .trim()
    const sources: AskSource[] = []
    for (const excerpt of excerpts) {
      if (sources.some(source => String(source.resourceId) === excerpt.resourceId && source.heading === excerpt.heading)) continue
      sources.push({ resourceId: ResourceId(excerpt.resourceId), name: excerpt.resourceName, heading: excerpt.heading })
    }
    return { answer, sources, grounded: true }
  }

  /** Run the converter seam for one stored original and settle the record. */
  private async convert(id: ResourceId, record: ResourceRecord, originalPath: string): Promise<Resource> {
    const input: ConvertInput = { path: originalPath, name: record.name, mediaType: record.mediaType }
    const eligible = this.converters.filter(converter => converter.accepts(input))
    let failure = 'no converter accepts this file type'
    for (const converter of eligible) {
      try {
        const markdown = await converter.convert(input)
        const markdownFile = `${id}.md`
        await writeFile(join(this.root, record.notebookId, MARKDOWN_DIR, markdownFile), markdown, 'utf8')
        const settled = await this.requireResources().update(id, current => ({
          ...current,
          status: 'ready' as const,
          markdownFile,
          convertedBy: converter.id,
          updatedAt: new Date().toISOString(),
        }))
        return snapshotResource(id, settled)
      } catch (error) {
        failure = `${converter.id}: ${error instanceof Error ? error.message : String(error)}`
      }
    }
    const settled = await this.requireResources().update(id, current => ({
      ...current,
      status: 'error' as const,
      error: failure,
      updatedAt: new Date().toISOString(),
    }))
    return snapshotResource(id, settled)
  }

  /** Resolve the ask-time model route: explicit config first, then the agent default. */
  private askRoute(): { provider: string; model: string } {
    if (this.config.provider !== undefined && this.config.model !== undefined) {
      return { provider: this.config.provider, model: this.config.model }
    }
    const defaults = this.ctx.get('agentDefaultModel')
    if (defaults === undefined) {
      throw new Error('librarian ask has no model: configure provider and model together, or mount agent-default-model')
    }
    const selection = defaults.currentSelection()
    return { provider: selection.provider, model: selection.model }
  }

  /** Stamp the owning notebook's `updatedAt` after a resource mutation. */
  private async touchNotebook(id: NotebookId): Promise<void> {
    await this.requireNotebooks().update(id, current => ({ ...current, updatedAt: new Date().toISOString() }))
  }

  private requireResource(id: ResourceId): ResourceRecord {
    const record = this.requireResources().get(id)
    if (record === undefined) throw new Error(`unknown resource '${id}'`)
    return record
  }

  private requireNotebooks(): KvTable<NotebookId, NotebookRecord> {
    if (this.notebooksTable === undefined) throw new Error('the library is not started yet')
    return this.notebooksTable
  }

  private requireResources(): KvTable<ResourceId, ResourceRecord> {
    if (this.resourcesTable === undefined) throw new Error('the library is not started yet')
    return this.resourcesTable
  }
}

function snapshotNotebook(id: NotebookId, record: NotebookRecord): Notebook {
  return Object.freeze({
    id,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  })
}

function snapshotResource(id: ResourceId, record: ResourceRecord): Resource {
  return Object.freeze({
    id,
    notebookId: record.notebookId,
    name: record.name,
    kind: record.kind,
    status: record.status,
    mediaType: record.mediaType,
    bytes: record.bytes,
    ...(record.convertedBy === undefined ? {} : { convertedBy: record.convertedBy }),
    ...(record.error === undefined ? {} : { error: record.error }),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  })
}

export default LibrarianService
