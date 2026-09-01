/**
 * Browser-facing writing gateway (`ctx.writing`): a Host Remote service that
 * projects the report/compile services into a plain JSON wire contract, and
 * serves a compiled report's PDF on `GET /writing/<reportId>/pdf`.
 * @module @deepseek-ai/dsh-writing-api
 */

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { ReportId, TemplateId } from '@deepseek-ai/dsh-writing'
import type { Report, ReportTemplate } from '@deepseek-ai/dsh-writing'
import type { CompileOutput, GitVersion } from '@deepseek-ai/dsh-writing-compile'
import type {} from '@deepseek-ai/dsh-writing-compile'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-auth'
import type {
  AddTemplateRequest,
  CompileRequest,
  CompileResultView,
  CreateReportRequest,
  DeleteRequest,
  GetReportRequest,
  RenameRequest,
  ReportTemplateView,
  ReportVersionView,
  ReportView,
  RestoreRequest,
  UpdateContentRequest,
  VersionsRequest,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    writing: WritingGateway
  }
}

export type * from './types.ts'

/** Static asset root prefix for a compiled report's PDF. */
const PDF_PATH_PREFIX = '/writing'

/**
 * The browser-facing writing contract. `static inject` lists only the
 * services the Remote methods read; the PDF route is registered through an
 * optional `webServer` injection, so a composition without the web server
 * (e.g. an agent process) can mount the gateway without serving files.
 */
export class WritingGateway extends TypertRemoteService {
  static inject = ['reports', 'latexCompile']

  /**
   * @param ctx - Host context carrying the report registry and compile service.
   */
  constructor(ctx: Context) {
    super(ctx, 'writing')
    ctx.inject(['webServer'], (webCtx) => {
      webCtx.effect(() => webCtx.webServer.register({
        kind: 'prefix',
        path: PDF_PATH_PREFIX,
        handler: (req, res) => { void this.servePdf(req, res) },
      }), 'writing-api: pdf route')
    })
  }

  /**
   * All reports in display order.
   * @returns projected report views.
   */
  @Remote('list')
  list(): ReportView[] {
    return this.ctx.reports.list().map(reportView)
  }

  /**
   * Read one report.
   * @param request - report id.
   * @returns the projected report, or `undefined` when unknown.
   */
  @Remote('get')
  get(request: GetReportRequest): ReportView | undefined {
    const report = this.ctx.reports.get(ReportId(request.reportId))
    return report === undefined ? undefined : reportView(report)
  }

  /**
   * Create one report from a title, optional template, and optional source.
   * @param request - create payload.
   * @returns the new report view.
   */
  @Remote('create')
  async create(request: CreateReportRequest): Promise<ReportView> {
    const report = await this.ctx.reports.create({
      title: request.title,
      ...(request.templateId === undefined ? {} : { templateId: TemplateId(request.templateId) }),
      ...(request.source === undefined ? {} : { source: request.source }),
    })
    return reportView(report)
  }

  /**
   * Replace a report's current source (autosave; no snapshot).
   * @param request - report id and replacement source.
   * @returns the updated report view.
   */
  @Remote('updateContent')
  async updateContent(request: UpdateContentRequest): Promise<ReportView> {
    return reportView(await this.ctx.reports.updateContent(ReportId(request.reportId), request.source))
  }

  /**
   * Rename a report.
   * @param request - report id and new title.
   * @returns the updated report view.
   */
  @Remote('rename')
  async rename(request: RenameRequest): Promise<ReportView> {
    return reportView(await this.ctx.reports.rename(ReportId(request.reportId), request.title))
  }

  /**
   * Delete a report and its versions.
   * @param request - report id.
   * @returns whether the report existed.
   */
  @Remote('deleteReport')
  deleteReport(request: DeleteRequest): Promise<boolean> {
    return this.ctx.reports.delete(ReportId(request.reportId))
  }

  /**
   * Compile a report, return diagnostics, and record a git version on success.
   * @param request - report id; pass `snapshot: false` to refresh the PDF only.
   * @returns the compile outcome with a served `pdfUrl` on success.
   */
  @Remote('compile')
  async compile(request: CompileRequest): Promise<CompileResultView> {
    const report = this.ctx.reports.get(ReportId(request.reportId))
    if (report === undefined) throw new Error(`unknown report '${request.reportId}'`)
    const output = await this.ctx.latexCompile.compile({ reportId: request.reportId, source: report.source })
    let versionCreated = false
    if (output.ok && request.snapshot !== false) {
      const count = (await this.ctx.latexCompile.listVersions(request.reportId)).length + 1
      await this.ctx.latexCompile.commitVersion(request.reportId, `successful compile #${count}`)
      versionCreated = true
    }
    const compilerMessage = output.ok ? undefined : compilerMessageOf(output)
    return {
      ok: output.ok,
      diagnostics: output.diagnostics.map(diagnostic => ({
        severity: diagnostic.severity,
        ...(diagnostic.line === undefined ? {} : { line: diagnostic.line }),
        message: diagnostic.message,
      })),
      ...(compilerMessage === undefined ? {} : { compilerMessage }),
      versionCreated,
      ...(output.ok ? { pdfUrl: `${PDF_PATH_PREFIX}/${request.reportId}/pdf` } : {}),
    }
  }

  /**
   * List a report's git-backed version snapshots, newest first.
   * @param request - report id.
   * @returns projected version views.
   */
  @Remote('versions')
  async versions(request: VersionsRequest): Promise<ReportVersionView[]> {
    return (await this.ctx.latexCompile.listVersions(request.reportId)).map(version => versionView(request.reportId, version))
  }

  /**
   * Branch from an earlier version and switch the report to it, keeping the
   * original branch intact.
   * @param request - report id, target version, and the new branch name.
   * @returns the updated report view.
   */
  @Remote('restore')
  async restore(request: RestoreRequest): Promise<ReportView> {
    const source = await this.ctx.latexCompile.restoreVersion(request.reportId, request.versionId, request.branch)
    return reportView(await this.ctx.reports.updateContent(ReportId(request.reportId), source))
  }

  /**
   * List templates (built-ins first, then custom).
   * @returns projected template views.
   */
  @Remote('templates')
  templates(): ReportTemplateView[] {
    return this.ctx.reports.listTemplates().map(templateView)
  }

  /**
   * Add a custom template.
   * @param request - name and template source.
   * @returns the new template view.
   */
  @Remote('addTemplate')
  async addTemplate(request: AddTemplateRequest): Promise<ReportTemplateView> {
    return templateView(await this.ctx.reports.addTemplate(request))
  }

  /** Serve a compiled report's PDF at `GET /writing/<reportId>/pdf`. */
  private async servePdf(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const user = await this.authOf(req)
    if (user === undefined) {
      res.writeHead(401, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ error: 'unauthorized' }))
      return
    }
    // A real HTTP request always carries a URL, so the fallback is unreachable.
    /* v8 ignore next -- req.url is always present on an HTTP request */
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    const segments = pathname.split('/').filter(Boolean)
    if (segments.length !== 3 || segments[0] !== 'writing' || segments[2] !== 'pdf') {
      res.writeHead(404)
      res.end('not found')
      return
    }
    try {
      const pdfPath = await this.ctx.latexCompile.pdfPath(segments[1] as string)
      if (pdfPath === undefined) {
        res.writeHead(404)
        res.end('not found')
        return
      }
      const metadata = await stat(pdfPath)
      res.writeHead(200, {
        'content-type': 'application/pdf',
        'content-length': String(metadata.size),
        'cache-control': 'no-store',
      })
      createReadStream(pdfPath).pipe(res)
    } catch {
      res.writeHead(404)
      res.end('not found')
    }
  }

  private async authOf(req: IncomingMessage): Promise<unknown | undefined> {
    const auth = this.ctx.get('auth')
    if (auth === undefined) return { userId: 'anonymous', username: 'anonymous' }
    return await auth.authenticateRequest(req)
  }
}

/** Project a report entity to its wire view. */
function reportView(report: Report): ReportView {
  return {
    reportId: String(report.id),
    title: report.title,
    templateId: String(report.templateId),
    source: report.source,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
  }
}

/** Project a git-backed version to its wire view. */
function versionView(reportId: string, version: GitVersion): ReportVersionView {
  return {
    versionId: version.versionId,
    reportId,
    label: version.label,
    ...(version.command === undefined ? {} : { command: version.command }),
    createdAt: version.createdAt,
  }
}

/** Trim and cap the raw compiler console output for forwarding to the agent. */
function compilerMessageOf(output: CompileOutput): string | undefined {
  const raw = output.stdout.trim() || output.stderr.trim()
  return raw.length === 0 ? undefined : raw.slice(0, 4000)
}

/** Project a template entity to its wire view. */
function templateView(template: ReportTemplate): ReportTemplateView {
  return {
    templateId: String(template.id),
    name: template.name,
    source: template.source,
    builtIn: template.builtIn,
    createdAt: template.createdAt,
  }
}

export default WritingGateway
