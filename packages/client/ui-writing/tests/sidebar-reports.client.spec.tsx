// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SidebarReports, type SidebarReportsProps } from '../src/client/SidebarReports.tsx'
import type { WritingReportsState } from '../src/client/reportSelection.ts'
import type { ReportSummaryView, SidebarReportsInjected } from '../src/client/types.ts'

afterEach(() => { cleanup(); state = { reports: [], selectedReportId: undefined } })

const t = (key: string): string => key

let state: WritingReportsState = { reports: [], selectedReportId: undefined }
const listeners = new Set<() => void>()
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
const getSnapshot = (): WritingReportsState => state
const setState = (updater: (current: WritingReportsState) => WritingReportsState): void => {
  state = updater(state)
  listeners.forEach(listener => listener())
}
const useReportSelection = <S,>(selector: (current: WritingReportsState) => S): S => selector(useSyncExternalStore(subscribe, getSnapshot))

const setReports = (reports: ReportSummaryView[]): void => setState(current => ({ ...current, reports }))
const select = (reportId: string): void => setState(current => ({ ...current, selectedReportId: reportId }))

function inject(over: Partial<SidebarReportsInjected> = {}): SidebarReportsInjected {
  return {
    listReports: vi.fn().mockResolvedValue([{ reportId: 'r1', title: 'Paper', updatedAt: '2026-01-01' }]),
    createReport: vi.fn().mockResolvedValue(undefined),
    setReports,
    select,
    hooks: { reportSelection: { getSnapshot, subscribe } },
    ...over,
  }
}

function props(face: SidebarReportsInjected): SidebarReportsProps {
  return { useReportSelection, ...face, t, wide: true, expandSidebar: () => {} } as unknown as SidebarReportsProps
}

describe('SidebarReports', () => {
  it('loads the report list and selects the first report', async () => {
    render(<SidebarReports {...props(inject())} />)
    expect(await screen.findByText('Paper')).toBeTruthy()
    expect(state.selectedReportId).toBe('r1')
  })

  it('selects a report on click', async () => {
    const face = inject({ listReports: vi.fn().mockResolvedValue([
      { reportId: 'r1', title: 'One', updatedAt: 't1' },
      { reportId: 'r2', title: 'Two', updatedAt: 't2' },
    ]) })
    render(<SidebarReports {...props(face)} />)
    await waitFor(() => expect(state.selectedReportId).toBe('r1'))
    fireEvent.click(screen.getByText('Two'))
    expect(state.selectedReportId).toBe('r2')
  })

  it('creates a report from the trimmed title and selects the newest', async () => {
    const face = inject({
      listReports: vi.fn().mockResolvedValue([{ reportId: 'r9', title: 'New report', updatedAt: 't9' }]),
    })
    render(<SidebarReports {...props(face)} />)
    await waitFor(() => expect(state.selectedReportId).toBe('r9'))
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

  it('resizes the report strip by dragging its handle', async () => {
    const { container } = render(<SidebarReports {...props(inject())} />)
    await screen.findByText('Paper')
    const list = container.querySelector('[class*="list"]') as HTMLElement
    const handle = container.querySelector('[class*="dragHandle"]') as HTMLElement
    expect(list.style.height).toBe('220px')
    fireEvent.pointerDown(handle, { clientY: 100 })
    fireEvent.pointerMove(window, { clientY: 200 })
    fireEvent.pointerUp(window)
    expect(parseInt(list.style.height, 10)).toBe(120)
  })
})
