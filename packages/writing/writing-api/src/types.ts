/**
 * Public wire types of the writing gateway: plain JSON views and requests that
 * cross the Host Remote boundary. No branded types here — the wire contract is
 * explicit DTOs over the report/compile services.
 * @module @deepseek-ai/dsh-writing-api/src/types
 */

/** One report project, projected for the browser. */
export interface ReportView {
  readonly reportId: string
  readonly title: string
  readonly templateId: string
  readonly source: string
  readonly createdAt: string
  readonly updatedAt: string
}

/**
 * One git-backed version snapshot, projected for the browser. `versionId` is
 * the commit hash; `command` is the compile command recorded on the commit.
 */
export interface ReportVersionView {
  readonly versionId: string
  readonly reportId: string
  readonly label: string
  readonly command?: string
  readonly createdAt: string
}

/** One report template, projected for the browser. */
export interface ReportTemplateView {
  readonly templateId: string
  readonly name: string
  readonly source: string
  readonly builtIn: boolean
  readonly createdAt: string
}

/** A parsed compiler message crossing the wire. */
export interface CompileDiagnosticView {
  readonly severity: 'error' | 'warning'
  readonly line?: number
  readonly message: string
}

/** The browser-facing compile outcome. `pdfUrl` is a served path when `ok`. */
export interface CompileResultView {
  readonly ok: boolean
  readonly diagnostics: readonly CompileDiagnosticView[]
  readonly versionCreated: boolean
  readonly pdfUrl?: string
}

/** Request payload for a report read. */
export interface GetReportRequest {
  readonly reportId: string
}

/** Request payload for a report create. */
export interface CreateReportRequest {
  readonly title: string
  readonly templateId?: string
  readonly source?: string
}

/** Request payload for a content write. */
export interface UpdateContentRequest {
  readonly reportId: string
  readonly source: string
}

/** Request payload for a title rename. */
export interface RenameRequest {
  readonly reportId: string
  readonly title: string
}

/** Request payload for a delete. */
export interface DeleteRequest {
  readonly reportId: string
}

/** Request payload for a compile. */
export interface CompileRequest {
  readonly reportId: string
  /** When `false`, run the engine and refresh the PDF without snapshotting a version. */
  readonly snapshot?: boolean
}

/** Request payload for a version listing. */
export interface VersionsRequest {
  readonly reportId: string
}

/** Request payload for a version restore. */
export interface RestoreRequest {
  readonly reportId: string
  readonly versionId: string
  /** Name of the new branch created from the target version. */
  readonly branch: string
}

/** Request payload for a custom template add. */
export interface AddTemplateRequest {
  readonly name: string
  readonly source: string
}
