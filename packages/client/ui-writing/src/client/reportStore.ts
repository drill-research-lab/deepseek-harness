/**
 * Shared report-selection store for the Writing feature. The sidebar report
 * panel (a `sidebar.reports` contribution) and the Writing editor view (the
 * `conversation.view` "writing" entry) both read the same handle, so picking a
 * report in the sidebar drives the editor and vice versa.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { ReportSummaryView } from './types.ts'

/** The report list + the currently selected report id. */
export interface WritingReportsState {
  reports: ReportSummaryView[]
  selectedReportId: string | undefined
}

/** Stackable report action shape (the store binds the state draft first). */
export type WritingReportsActions = {
  setReports: (draft: WritingReportsState, reports: ReportSummaryView[]) => void
  select: (draft: WritingReportsState, reportId: string) => void
  renameReport: (draft: WritingReportsState, reportId: string, title: string) => void
}

/** The shared report-selection store handle type, used for `PropsStore`. */
export type WritingReportsStore = EngineStoreHandle<WritingReportsState, WritingReportsActions>

/**
 * Declares the report-selection state and write surface.
 * @returns the store handle to share between the sidebar panel and the editor view.
 */
export function createWritingReportsStore(): WritingReportsStore {
  return defineStore({
    init: (): WritingReportsState => ({ reports: [], selectedReportId: undefined }),
    actions: {
      setReports: (d, reports) => {
        d.reports = reports
      },
      select: (d, reportId) => {
        d.selectedReportId = reportId
      },
      renameReport: (d, reportId, title) => {
        d.reports = d.reports.map(report => report.reportId === reportId ? { ...report, title } : report)
      },
    },
  })
}
