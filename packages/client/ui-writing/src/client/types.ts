/**
 * Writing view contract: the inject face the component receives, plus the
 * wire view types it reads. Types only.
 * @module @deepseek-ai/dsh-client-ui-writing/src/client/types
 */

import type { CompileResultView, ReportVersionView } from '@deepseek-ai/dsh-writing-api/types'
import type { HostObservable, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { WritingReportsState } from './reportSelection.ts'

export type { CompileResultView, ReportTemplateView, ReportVersionView } from '@deepseek-ai/dsh-writing-api/types'
export type { WritingReportsState } from './reportSelection.ts'

/** A report as shown in the Writing view list. */
export interface ReportSummaryView {
  readonly reportId: string
  readonly title: string
  readonly updatedAt: string
}

/** The editor-facing business face the Writing view calls, closed over the client ctx. */
export interface WritingViewInjected {
  /** Rename a report. */
  rename(reportId: string, title: string): Promise<void>
  /** Read a report's current source. */
  getSource(reportId: string): Promise<string>
  /** Replace a report's current source (autosave). */
  updateSource(reportId: string, source: string): Promise<void>
  /** Compile a report and return diagnostics; snapshots a version unless `snapshot` is false. */
  compile(reportId: string, options?: { readonly snapshot?: boolean }): Promise<CompileResultView>
  /** A report's git-backed version snapshots, newest first. */
  versions(reportId: string): Promise<ReportVersionView[]>
  /**
   * Branch from an earlier version and switch the report to it, keeping the
   * original branch intact; returns the restored source.
   */
  restore(reportId: string, versionId: string, branch: string): Promise<string>
  /** Write the selected report id into the shared report-selection source; `undefined` clears it. */
  select(reportId: string | undefined): void
  /** Rename one report in the shared list in place. */
  renameReport(reportId: string, title: string): void
  /** Open the agent conversation (switch to the chat view). */
  openConversation(): void
  /** Report list + selection observable, bound to `useReportSelection`. */
  hooks: { readonly reportSelection: HostObservable<WritingReportsState> }
}

/** Component-facing view of the shared report selection: the bound selector hook. */
export type WritingReportsHooks = {
  /** Selector hook over the shared report list + selected id. */
  useReportSelection: SnapshotSelectorHook<WritingReportsState>
}

/** The sidebar-facing face the report panel calls: listing, creation, and selection writes. */
export interface SidebarReportsInjected {
  /** All reports, newest first. */
  listReports(): Promise<ReportSummaryView[]>
  /** Create a report from a title. */
  createReport(title: string): Promise<void>
  /** Write the report list into the shared source. */
  setReports(reports: ReportSummaryView[]): void
  /** Write the selected report id into the shared source. */
  select(reportId: string): void
  /** Report list + selection observable, bound to `useReportSelection`. */
  hooks: { readonly reportSelection: HostObservable<WritingReportsState> }
}
