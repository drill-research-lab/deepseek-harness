/**
 * Browser-facing library gateway (`ctx.library`): a Host Remote service that
 * projects the librarian service into a plain JSON wire contract, plus the
 * `/library` binary data plane — raw-body upload, inline original serving for
 * the PDF/text preview, and attachment download.
 * @module @deepseek-ai/dsh-library-api
 */

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { NotebookId, ResourceId } from '@deepseek-ai/dsh-library'
import type { AskResult, Notebook, Resource } from '@deepseek-ai/dsh-library'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-auth'
import type {
  AskRequest,
  AskView,
  CreateNotebookRequest,
  IngestTextRequest,
  MarkdownView,
  NotebookRequest,
  NotebookView,
  RenameNotebookRequest,
  ResourceRequest,
  ResourceView,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    library: LibraryGateway
  }
}

export type * from './types.ts'

/** URL prefix of the library data plane. */
const LIBRARY_PATH_PREFIX = '/library'

/** Content classes accepted from the wire. */
const WIRE_KINDS = new Set(['source', 'result', 'deliverable'])

/** Deployment configuration of the library gateway. */
export interface Config {
  /** Upload admission ceiling in bytes. */
  readonly maxUploadBytes: number
}

/** Schemastery configuration for the library gateway. */
export const Config: z<Config> = z.object({
  maxUploadBytes: z.number().step(1).min(1024).default(100 * 1024 * 1024),
})

/**
 * The browser-facing library contract. `static inject` lists only the service
 * the Remote methods read; the `/library` routes register through an optional
 * `webServer` injection, so a composition without the web server can mount
 * the gateway without serving files.
 */
export class LibraryGateway extends TypertRemoteService {
  static inject = ['librarian']

  static Config: z<Config> = Config

  /**
   * @param ctx - Host context carrying the librarian service.
   * @param config - validated upload admission configuration.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'library')
    ctx.inject(['webServer'], (webCtx) => {
      webCtx.effect(() => webCtx.webServer.register({
        kind: 'prefix',
        path: LIBRARY_PATH_PREFIX,
        handler: (req, res) => { void this.serve(req, res) },
      }), 'library-api: data-plane route')
    })
  }

  /**
   * All notebooks with their resource counts, newest first.
   * @returns projected notebook views.
   */
  @Remote('listNotebooks')
  listNotebooks(): NotebookView[] {
    return this.ctx.librarian.listNotebooks().map(notebook => this.notebookView(notebook))
  }

  /**
   * Create one notebook.
   * @param request - display title.
   * @returns the new notebook view.
   */
  @Remote('createNotebook')
  async createNotebook(request: CreateNotebookRequest): Promise<NotebookView> {
    return this.notebookView(await this.ctx.librarian.createNotebook(request.title))
  }

  /**
   * Rename one notebook.
   * @param request - notebook id and new title.
   * @returns the updated notebook view.
   */
  @Remote('renameNotebook')
  async renameNotebook(request: RenameNotebookRequest): Promise<NotebookView> {
    return this.notebookView(await this.ctx.librarian.renameNotebook(NotebookId(request.notebookId), request.title))
  }

  /**
   * Delete one notebook, its resources, and its files.
   * @param request - notebook id.
   * @returns whether the notebook existed.
   */
  @Remote('deleteNotebook')
  deleteNotebook(request: NotebookRequest): Promise<boolean> {
    return this.ctx.librarian.deleteNotebook(NotebookId(request.notebookId))
  }

  /**
   * All resources of one notebook, newest first.
   * @param request - notebook id.
   * @returns projected resource views.
   */
  @Remote('listResources')
  listResources(request: NotebookRequest): ResourceView[] {
    return this.ctx.librarian.listResources(NotebookId(request.notebookId)).map(resourceView)
  }

  /**
   * Delete one resource and its stored files.
   * @param request - resource id.
   * @returns whether the resource existed.
   */
  @Remote('deleteResource')
  deleteResource(request: ResourceRequest): Promise<boolean> {
    return this.ctx.librarian.deleteResource(ResourceId(request.resourceId))
  }

  /**
   * Ingest pasted text as a new resource (the NotebookLM paste-source flow).
   * @param request - notebook, display name, text, and content class.
   * @returns the settled resource view.
   */
  @Remote('ingestText')
  async ingestText(request: IngestTextRequest): Promise<ResourceView> {
    const resource = await this.ctx.librarian.ingest({
      notebookId: NotebookId(request.notebookId),
      name: request.name,
      ...(request.kind !== undefined && WIRE_KINDS.has(request.kind)
        ? { kind: request.kind as 'source' | 'result' | 'deliverable' }
        : {}),
      content: { text: request.text },
    })
    return resourceView(resource)
  }

  /**
   * Read the converted Markdown of one resource for the inline preview.
   * @param request - resource id.
   * @returns the Markdown payload.
   */
  @Remote('readMarkdown')
  async readMarkdown(request: ResourceRequest): Promise<MarkdownView> {
    return {
      resourceId: request.resourceId,
      content: await this.ctx.librarian.readMarkdown(ResourceId(request.resourceId)),
    }
  }

  /**
   * Answer one question grounded in a notebook's documents.
   * @param request - notebook id and question.
   * @param signal - cooperative cancellation from the browser.
   * @returns the grounded answer view.
   */
  @Remote('ask')
  async ask(request: AskRequest, signal: AbortSignal): Promise<AskView> {
    return askView(await this.ctx.librarian.ask(NotebookId(request.notebookId), request.question, signal))
  }

  /** Dispatch one `/library` data-plane request. */
  private async serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const user = await this.authOf(req)
    if (user === undefined) {
      res.writeHead(401, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ error: 'unauthorized' }))
      return
    }
    // A real HTTP request always carries a URL, so the fallback is unreachable.
    /* v8 ignore next -- req.url is always present on an HTTP request */
    const url = new URL(req.url ?? '/', 'http://localhost')
    const segments = url.pathname.split('/').filter(Boolean)
    try {
      if (req.method === 'POST' && segments.length === 2 && segments[0] === 'library' && segments[1] === 'upload') {
        await this.serveUpload(req, res, url)
        return
      }
      if (req.method === 'GET' && segments.length === 3 && segments[0] === 'library') {
        const resourceId = ResourceId(segments[1] as string)
        if (segments[2] === 'raw') {
          await this.serveOriginal(res, resourceId, 'inline')
          return
        }
        if (segments[2] === 'download') {
          await this.serveOriginal(res, resourceId, 'attachment')
          return
        }
      }
      res.writeHead(404)
      res.end('not found')
    } catch (error) {
      res.writeHead(400, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
    }
  }

  /** Admit one raw-body upload and ingest it into the target notebook. */
  private async serveUpload(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const notebookId = url.searchParams.get('notebook')
    const name = url.searchParams.get('name')
    if (notebookId === null || notebookId === '' || name === null || name === '') {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'notebook and name query parameters are required' }))
      return
    }
    const declared = Number(req.headers['content-length'] ?? '0')
    if (declared > this.config.maxUploadBytes) {
      res.writeHead(413, { 'content-type': 'application/json', connection: 'close' })
      res.end(JSON.stringify({ error: `upload exceeds ${this.config.maxUploadBytes} bytes` }))
      req.destroy()
      return
    }
    const chunks: Buffer[] = []
    let total = 0
    for await (const chunk of req) {
      const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
      total += piece.length
      if (total > this.config.maxUploadBytes) {
        res.writeHead(413, { 'content-type': 'application/json', connection: 'close' })
        res.end(JSON.stringify({ error: `upload exceeds ${this.config.maxUploadBytes} bytes` }))
        req.destroy()
        return
      }
      chunks.push(piece)
    }
    const kindParam = url.searchParams.get('kind')
    const resource = await this.ctx.librarian.ingest({
      notebookId: NotebookId(notebookId),
      name,
      ...(kindParam !== null && WIRE_KINDS.has(kindParam)
        ? { kind: kindParam as 'source' | 'result' | 'deliverable' }
        : {}),
      content: { data: new Uint8Array(Buffer.concat(chunks)) },
    })
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify(resourceView(resource)))
  }

  /** Stream one stored original file with the recorded media type. */
  private async serveOriginal(res: ServerResponse, id: ReturnType<typeof ResourceId>, disposition: 'inline' | 'attachment'): Promise<void> {
    const original = this.ctx.librarian.originalFileOf(id)
    const metadata = await stat(original.path)
    res.writeHead(200, {
      'content-type': original.mediaType === '' ? 'application/octet-stream' : original.mediaType,
      'content-length': String(metadata.size),
      'content-disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(original.name)}`,
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
    })
    createReadStream(original.path).pipe(res)
  }

  private async authOf(req: IncomingMessage): Promise<unknown | undefined> {
    const auth = this.ctx.get('auth')
    if (auth === undefined) return { userId: 'anonymous', username: 'anonymous' }
    return await auth.authenticateRequest(req)
  }

  /** Project a notebook entity to its wire view with its live resource count. */
  private notebookView(notebook: Notebook): NotebookView {
    return {
      notebookId: String(notebook.id),
      title: notebook.title,
      resourceCount: this.ctx.librarian.listResources(notebook.id).length,
      createdAt: notebook.createdAt,
      updatedAt: notebook.updatedAt,
    }
  }
}

/** Project a resource entity to its wire view. */
function resourceView(resource: Resource): ResourceView {
  return {
    resourceId: String(resource.id),
    notebookId: String(resource.notebookId),
    name: resource.name,
    kind: resource.kind,
    status: resource.status,
    mediaType: resource.mediaType,
    bytes: resource.bytes,
    ...(resource.error === undefined ? {} : { error: resource.error }),
    createdAt: resource.createdAt,
    updatedAt: resource.updatedAt,
  }
}

/** Project an ask result to its wire view. */
function askView(result: AskResult): AskView {
  return {
    answer: result.answer,
    sources: result.sources.map(source => ({
      resourceId: String(source.resourceId),
      name: source.name,
      heading: source.heading,
    })),
    grounded: result.grounded,
  }
}

export default LibraryGateway
