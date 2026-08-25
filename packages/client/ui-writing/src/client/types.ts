/**
 * Writing view contract: the inject face the component receives, plus the
 * wire view types it reads. Types only.
 * @module @deepseek-ai/dsh-client-ui-writing/src/client/types
 */

import type { CompileResultView, ReportVersionView } from '@deepseek-ai/dsh-writing-api/types'

export type { CompileResultView, ReportTemplateView, ReportVersionView } from '@deepseek-ai/dsh-writing-api/types'

/** A report as shown in the Writing view list. */
export interface ReportSummaryView {
  readonly reportId: string
  readonly title: string
  readonly updatedAt: string
}

/** The business face the Writing view calls, closed over the client ctx. */
export interface WritingViewInjected {
  /** All reports, newest first. */
  listReports(): Promise<ReportSummaryView[]>
  /** Create a report from a title. */
  createReport(title: string): Promise<void>
  /** Rename a report. */
  rename(reportId: string, title: string): Promise<void>
  /** Read a report's current source. */
  getSource(reportId: string): Promise<string>
  /** Replace a report's current source (autosave). */
  updateSource(reportId: string, source: string): Promise<void>
  /** Compile a report and return diagnostics; snapshots a version on success unless `snapshot` is false. */
  compile(reportId: string, options?: { readonly snapshot?: boolean }): Promise<CompileResultView>
  /** A report's version snapshots, newest first. */
  versions(reportId: string): Promise<ReportVersionView[]>
  /** Restore a report to an earlier version; returns its source. */
  restore(reportId: string, versionId: string): Promise<string>
}
