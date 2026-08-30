/**
 * Shared report-selection observable for the Writing feature. The sidebar
 * report panel (a `sidebar.reports` contribution) and the Writing editor view
 * (the `conversation.view` "writing" entry) read the SAME source through the
 * reserved `hooks` compartment, so picking a report in the sidebar drives the
 * editor. Unlike a slot store (pinned to one scope), a `HostObservable` source
 * is not scope-bound, so it can be shared across the root sidebar and a
 * session-scoped view.
 */
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { ReportSummaryView } from './types.ts'

/** The report list + the currently selected report id. */
export interface WritingReportsState {
  reports: ReportSummaryView[]
  selectedReportId: string | undefined
}

/** A shared mutable report-selection observable (read source + write actions). */
export interface WritingReportsSource extends HostObservable<WritingReportsState> {
  /** Replace the whole report list. */
  setReports(reports: ReportSummaryView[]): void
  /** Select the active report. */
  select(reportId: string): void
  /** Rename one report in the list in place. */
  renameReport(reportId: string, title: string): void
}

/** Create the shared source; call it once in `apply`. */
export function createWritingReportsSource(): WritingReportsSource {
  let state: WritingReportsState = { reports: [], selectedReportId: undefined }
  const listeners = new Set<() => void>()
  const update = (next: WritingReportsState): void => {
    state = next
    listeners.forEach(listener => listener())
  }
  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    setReports: reports => update({ ...state, reports }),
    select: reportId => update({ ...state, selectedReportId: reportId }),
    renameReport: (reportId, title) => update({
      ...state,
      reports: state.reports.map(report => report.reportId === reportId ? { ...report, title } : report),
    }),
  }
}
