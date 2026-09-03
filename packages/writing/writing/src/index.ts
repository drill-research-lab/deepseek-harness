/**
 * Report project registry (`ctx.reports`): durable report projects, immutable
 * version snapshots, and the template library over the storage-domain form.
 * @module @deepseek-ai/dsh-writing
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { writingDomainSpec } from './spec.ts'
import type { ReportRecord, ReportTemplateRecord, ReportVersionRecord } from './spec.ts'
import type {
  AddTemplateRequest,
  CreateReportRequest,
  Report,
  ReportId,
  ReportTemplate,
  ReportVersion,
  TemplateId,
  VersionId,
} from './types.ts'

export { writingDomainSpec } from './spec.ts'
export type { ReportRecord, ReportTemplateRecord, ReportVersionRecord } from './spec.ts'
export type * from './types.ts'

/**
 * Brand a string as a {@link ReportId}.
 * @param id - Raw report id string.
 * @returns the same string, branded at compile time.
 */
export function ReportId(id: string): ReportId {
  return id as ReportId
}

/**
 * Brand a string as a {@link VersionId}.
 * @param id - Raw version id string.
 * @returns the same string, branded at compile time.
 */
export function VersionId(id: string): VersionId {
  return id as VersionId
}

/**
 * Brand a string as a {@link TemplateId}.
 * @param id - Raw template id string.
 * @returns the same string, branded at compile time.
 */
export function TemplateId(id: string): TemplateId {
  return id as TemplateId
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    reports: ReportService
  }
}

interface BuiltInTemplate {
  readonly name: string
  readonly source: string
}

/** Ship three minimal report templates: a generic article, an academic proposal, and a report. */
export const BUILTIN_TEMPLATES: readonly BuiltInTemplate[] = Object.freeze([
  Object.freeze({
    name: 'article',
    source: [
      '\\documentclass[11pt]{article}',
      '\\usepackage[utf8]{inputenc}',
      '\\usepackage[margin=1in]{geometry}',
      '\\usepackage{amsmath,amssymb}',
      '\\usepackage{graphicx}',
      '\\usepackage{hyperref}',
      '',
      '\\title{%%TITLE%%}',
      '\\author{%%AUTHOR%%}',
      '\\date{%%DATE%%}',
      '',
      '\\begin{document}',
      '\\maketitle',
      '',
      '\\section{Introduction}',
      '%%CONTENT%%',
      '',
      '\\end{document}',
      '',
    ].join('\n'),
  }),
  Object.freeze({
    name: 'academic-proposal',
    source: [
      '\\documentclass[11pt]{article}',
      '\\usepackage[utf8]{inputenc}',
      '\\usepackage[margin=1in]{geometry}',
      '\\usepackage{booktabs}',
      '\\usepackage[hidelinks]{hyperref}',
      '',
      '\\title{%%TITLE%%}',
      '\\author{%%AUTHOR%%}',
      '\\date{%%DATE%%}',
      '',
      '\\begin{document}',
      '\\maketitle',
      '',
      '\\section{Abstract}',
      '%%ABSTRACT%%',
      '',
      '\\section{Background and Motivation}',
      '%%BACKGROUND%%',
      '',
      '\\section{Proposed Method}',
      '%%METHOD%%',
      '',
      '\\section{Evaluation Plan}',
      '%%EVALUATION%%',
      '',
      '\\section{Timeline}',
      '%%TIMELINE%%',
      '',
      '\\end{document}',
      '',
    ].join('\n'),
  }),
  Object.freeze({
    name: 'report',
    source: [
      '\\documentclass[12pt]{report}',
      '\\usepackage[utf8]{inputenc}',
      '\\usepackage[margin=1in]{geometry}',
      '\\usepackage{amsmath,amssymb}',
      '',
      '\\title{%%TITLE%%}',
      '\\author{%%AUTHOR%%}',
      '\\date{%%DATE%%}',
      '',
      '\\begin{document}',
      '\\maketitle',
      '',
      '\\chapter{Introduction}',
      '%%CONTENT%%',
      '',
      '\\end{document}',
      '',
    ].join('\n'),
  }),
])

const DEFAULT_BUILTIN_NAME = 'article'

const builtinId = (name: string): TemplateId => TemplateId(`builtin:${name}`)

const byCreatedDesc = <T extends { readonly createdAt: string; readonly id: string }>(
  left: T,
  right: T,
): number =>
  right.createdAt.localeCompare(left.createdAt) || String(left.id).localeCompare(String(right.id))

/**
 * Scoped to one open domain. `reportsTable` and `templatesTable` back the
 * registry's public contract; every response is a frozen snapshot so callers
 * never see a mutable alias of durable state.
 */
export class ReportService extends TypertRemoteService {
  static inject = ['storageDomain']

  private reportsTable?: KvTable<ReportId, ReportRecord>
  private versionsTable?: KvTable<VersionId, ReportVersionRecord>
  private templatesTable?: KvTable<TemplateId, ReportTemplateRecord>

  /**
   * @param ctx - Host context carrying the storage-domain form.
   */
  constructor(ctx: Context) {
    super(ctx, 'reports')
  }

  /** Open and own the one writing domain, seeding built-in templates once. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(writingDomainSpec)
    this.ctx.effect(() => async () => { await domain.close() }, 'writing.domainClose')
    this.reportsTable = domain.table('reports')
    this.versionsTable = domain.table('versions')
    this.templatesTable = domain.table('templates')
    await this.seedBuiltInTemplates()
  }

  /**
   * All report projects in display order (newest first).
   * @returns frozen, ordered report snapshots.
   */
  @Remote('list')
  list(): Report[] {
    return [...this.requireReports().entries()]
      .map(([id, record]) => snapshotReport(id, record))
      .sort(byCreatedDesc)
  }

  /**
   * Create one report from a display title, an optional template, and an
   * optional initial source. When `source` is omitted the template source is
   * used; a provided `source` wins over it. A named template that does not
   * exist rejects without writing.
   * @param request - Title, optional template, optional initial source.
   * @returns the new report snapshot.
   */
  @Remote('create')
  async create(request: CreateReportRequest): Promise<Report> {
    const templateId = request.templateId ?? this.defaultTemplateId()
    const template = this.requireTemplates().get(templateId)
    if (template === undefined) {
      throw new Error(`cannot create report: unknown template '${templateId}'`)
    }
    const source = request.source ?? template.source
    const id = ReportId(randomUUID())
    const now = new Date().toISOString()
    const record = { title: request.title, templateId, source, workspaceDir: request.workspaceDir ?? '', createdAt: now, updatedAt: now }
    await this.requireReports().put(id, record)
    return snapshotReport(id, record)
  }

  /**
   * Read one report by id.
   * @param id - Report id.
   * @returns the report snapshot, or `undefined` when unknown.
   */
  @Remote('get')
  get(id: ReportId): Report | undefined {
    const record = this.requireReports().get(id)
    return record === undefined ? undefined : snapshotReport(id, record)
  }

  /**
   * Replace the display title durably.
   * @param id - Report id.
   * @param title - New display title.
   * @returns the updated report snapshot.
   */
  @Remote('rename')
  async rename(id: ReportId, title: string): Promise<Report> {
    const record = await this.requireReports().update(id, current => ({
      ...current,
      title,
      updatedAt: new Date().toISOString(),
    }))
    return snapshotReport(id, record)
  }

  /**
   * Replace the current LaTeX source durably (autosave). Never creates a
   * version snapshot; call {@link snapshot} for that.
   * @param id - Report id.
   * @param source - New LaTeX source.
   * @returns the updated report snapshot.
   */
  @Remote('updateContent')
  async updateContent(id: ReportId, source: string): Promise<Report> {
    const record = await this.requireReports().update(id, current => ({
      ...current,
      source,
      updatedAt: new Date().toISOString(),
    }))
    return snapshotReport(id, record)
  }

  /**
   * Delete one report and its version snapshots durably.
   * @param id - Report id.
   * @returns `true` when the report existed, `false` when it was unknown.
   */
  @Remote('delete')
  async delete(id: ReportId): Promise<boolean> {
    const existing = this.requireReports().get(id)
    if (existing === undefined) return false
    await this.requireReports().delete(id)
    const versions = this.requireVersions()
    for (const [versionId, record] of versions.entries()) {
      if (record.reportId === id) await versions.delete(versionId)
    }
    return true
  }

  /**
   * Capture an immutable version snapshot of a report's current source.
   * @param id - Report id.
   * @param label - Human-readable snapshot label; defaults to a numbered label.
   * @returns the new version snapshot.
   */
  @Remote('snapshot')
  async snapshot(id: ReportId, label?: string): Promise<ReportVersion> {
    const report = this.requireReport(id)
    const versionId = VersionId(randomUUID())
    const now = new Date().toISOString()
    const resolvedLabel = label ?? `snapshot #${this.requireVersions().size + 1}`
    await this.requireVersions().put(versionId, {
      reportId: id,
      label: resolvedLabel,
      source: report.source,
      createdAt: now,
    })
    return snapshotVersion(versionId, { reportId: id, label: resolvedLabel, source: report.source, createdAt: now })
  }

  /**
   * All version snapshots for one report, newest first.
   * @param id - Report id.
   * @returns frozen, ordered version snapshots.
   */
  @Remote('listVersions')
  listVersions(id: ReportId): ReportVersion[] {
    return [...this.requireVersions().entries()]
      .filter(([, record]) => record.reportId === id)
      .map(([versionId, record]) => snapshotVersion(versionId, record))
      .sort(byCreatedDesc)
  }

  /**
   * Restore a report's current source from an earlier version snapshot.
   * @param id - Report id.
   * @param versionId - Version snapshot to restore.
   * @returns the updated report snapshot.
   */
  @Remote('restoreVersion')
  async restoreVersion(id: ReportId, versionId: VersionId): Promise<Report> {
    const version = this.requireVersions().get(versionId)
    if (version === undefined || version.reportId !== id) {
      throw new Error(`cannot restore version '${versionId}': unknown version for report '${id}'`)
    }
    const record = await this.requireReports().update(id, current => ({
      ...current,
      source: version.source,
      updatedAt: new Date().toISOString(),
    }))
    return snapshotReport(id, record)
  }

  /**
   * All templates: built-in templates first (in shipped order), then custom
   * templates (newest first).
   * @returns frozen, ordered template snapshots.
   */
  @Remote('listTemplates')
  listTemplates(): ReportTemplate[] {
    return [...this.requireTemplates().entries()]
      .map(([id, record]) => snapshotTemplate(id, record))
      .sort((left, right) => {
        // Built-in templates are seeded before any custom one, so a comparison
        // with a custom `left` and a built-in `right` never occurs.
        /* v8 ignore next -- unreachable: built-ins always precede customs in the table */
        if (left.builtIn !== right.builtIn) return left.builtIn ? -1 : 1
        if (left.builtIn && right.builtIn) {
          return String(left.id).localeCompare(String(right.id))
        }
        return byCreatedDesc(left, right)
      })
  }

  /**
   * Read one template by id.
   * @param id - Template id.
   * @returns the template snapshot, or `undefined` when unknown.
   */
  @Remote('template')
  template(id: TemplateId): ReportTemplate | undefined {
    const record = this.requireTemplates().get(id)
    return record === undefined ? undefined : snapshotTemplate(id, record)
  }

  /**
   * Add a custom template. A duplicate display name rejects without writing.
   * @param request - Display name and template source.
   * @returns the new template snapshot.
   */
  @Remote('addTemplate')
  async addTemplate(request: AddTemplateRequest): Promise<ReportTemplate> {
    const templates = this.requireTemplates()
    const nameTaken = [...templates.entries()].some(([, record]) => record.name === request.name)
    if (nameTaken) throw new Error(`cannot add template '${request.name}': the name already exists`)
    const id = TemplateId(randomUUID())
    const now = new Date().toISOString()
    await templates.put(id, { name: request.name, source: request.source, builtIn: false, createdAt: now })
    return snapshotTemplate(id, { name: request.name, source: request.source, builtIn: false, createdAt: now })
  }

  /**
   * Delete a custom template. Built-in templates are never deletable.
   * @param id - Template id.
   * @returns `true` when the template was deleted, `false` when it was unknown.
   */
  @Remote('deleteTemplate')
  async deleteTemplate(id: TemplateId): Promise<boolean> {
    const record = this.requireTemplates().get(id)
    if (record === undefined) return false
    if (record.builtIn) {
      throw new Error(`cannot delete template '${id}': built-in templates are not deletable`)
    }
    return await this.requireTemplates().delete(id)
  }

  private async seedBuiltInTemplates(): Promise<void> {
    const templates = this.requireTemplates()
    if (templates.size > 0) return
    const now = new Date().toISOString()
    for (const builtIn of BUILTIN_TEMPLATES) {
      await templates.put(builtinId(builtIn.name), {
        name: builtIn.name,
        source: builtIn.source,
        builtIn: true,
        createdAt: now,
      })
    }
  }

  private defaultTemplateId(): TemplateId {
    return builtinId(DEFAULT_BUILTIN_NAME)
  }

  private requireReport(id: ReportId): ReportRecord {
    const record = this.requireReports().get(id)
    if (record === undefined) throw new Error(`unknown report '${id}'`)
    return record
  }

  private requireReports(): KvTable<ReportId, ReportRecord> {
    if (this.reportsTable === undefined) throw new Error('report registry is not started yet')
    return this.reportsTable
  }

  private requireVersions(): KvTable<VersionId, ReportVersionRecord> {
    if (this.versionsTable === undefined) throw new Error('report registry is not started yet')
    return this.versionsTable
  }

  private requireTemplates(): KvTable<TemplateId, ReportTemplateRecord> {
    if (this.templatesTable === undefined) throw new Error('report registry is not started yet')
    return this.templatesTable
  }
}

function snapshotReport(id: ReportId, record: ReportRecord): Report {
  return Object.freeze({
    id,
    title: record.title,
    templateId: record.templateId,
    source: record.source,
    workspaceDir: record.workspaceDir,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  })
}

function snapshotVersion(id: VersionId, record: ReportVersionRecord): ReportVersion {
  return Object.freeze({
    id,
    reportId: record.reportId,
    label: record.label,
    source: record.source,
    createdAt: record.createdAt,
  })
}

function snapshotTemplate(id: TemplateId, record: ReportTemplateRecord): ReportTemplate {
  return Object.freeze({
    id,
    name: record.name,
    source: record.source,
    builtIn: record.builtIn,
    createdAt: record.createdAt,
  })
}

export default ReportService
