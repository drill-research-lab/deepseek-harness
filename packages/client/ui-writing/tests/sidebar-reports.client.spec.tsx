// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SidebarReports, type SidebarReportsProps } from '../src/client/SidebarReports.tsx'
import type { WritingReportsState } from '../src/client/reportStore.ts'
import type { ReportSummaryView, SidebarReportsInjected } from '../src/client/types.ts'

afterEach(() => { cleanup(); store = { reports: [], selectedReportId: undefined } })

const t = (key: string): string => key

let store: WritingReportsState = { reports: [], selectedReportId: undefined }
const listeners = new Set<() => void>()
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
const getSnapshot = (): WritingReportsState => store
const setStore = (updater: (state: WritingReportsState) => WritingReportsState): void => {
  store = updater(store)
  listeners.forEach(listener => listener())
}
const useStore = <S,>(selector: (state: WritingReportsState) => S): S => selector(useSyncExternalStore(subscribe, getSnapshot))

const storeActions = {
  setReports: (reports: ReportSummaryView[]) => setStore(state => ({ ...state, reports })),
  select: (reportId: string) => setStore(state => ({ ...state, selectedReportId: reportId })),
  renameReport: (reportId: string, title: string) => setStore(state => ({
    ...state,
    reports: state.reports.map(r => r.reportId === reportId ? { ...r, title } : r),
  })),
}

function inject(over: Partial<SidebarReportsInjected> = {}): SidebarReportsInjected {
  return {
    listReports: vi.fn().mockResolvedValue([{ reportId: 'r1', title: 'Paper', updatedAt: '2026-01-01' }]),
    createReport: vi.fn().mockResolvedValue(undefined),
    ...over,
  }
}

function props(face: SidebarReportsInjected): SidebarReportsProps {
  return { useStore, actions: storeActions, ...face, t, wide: true, expandSidebar: () => {} } as unknown as SidebarReportsProps
}

describe('SidebarReports', () => {
  it('loads the report list and selects the first report', async () => {
    render(<SidebarReports {...props(inject())} />)
    expect(await screen.findByText('Paper')).toBeTruthy()
    expect(store.selectedReportId).toBe('r1')
  })

  it('selects a report on click', async () => {
    const face = inject({ listReports: vi.fn().mockResolvedValue([
      { reportId: 'r1', title: 'One', updatedAt: 't1' },
      { reportId: 'r2', title: 'Two', updatedAt: 't2' },
    ]) })
    render(<SidebarReports {...props(face)} />)
    await waitFor(() => expect(store.selectedReportId).toBe('r1'))
    fireEvent.click(screen.getByText('Two'))
    expect(store.selectedReportId).toBe('r2')
  })

  it('creates a report from the trimmed title and selects the newest', async () => {
    const face = inject({
      listReports: vi.fn().mockResolvedValue([{ reportId: 'r9', title: 'New report', updatedAt: 't9' }]),
    })
    render(<SidebarReports {...props(face)} />)
    await waitFor(() => expect(store.selectedReportId).toBe('r9'))
    fireEvent.input(screen.getByPlaceholderText('newPlaceholder'), { target: { value: '  New report  ' } })
    fireEvent.click(screen.getByText('create'))
    await waitFor(() => expect(face.createReport).toHaveBeenCalledWith('New report'))
  })

  it('collapses and re-expands the report strip', async () => {
    render(<SidebarReports {...props(inject())} />)
    expect(await screen.findByText('Paper')).toBeTruthy()
    fireEvent.click(screen.getByText('−'))
    expect(screen.queryByText('Paper')).toBeNull()
    fireEvent.click(screen.getByText('+'))
    expect(await screen.findByText('Paper')).toBeTruthy()
  })
})
