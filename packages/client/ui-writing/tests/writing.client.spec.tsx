// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { WritingView, type WritingViewProps } from '../src/client/WritingView.tsx'
import type { WritingReportsState } from '../src/client/reportStore.ts'
import type { ReportSummaryView, WritingViewInjected } from '../src/client/types.ts'

afterEach(() => { cleanup(); store = defaultStore() })

const conv = {} as unknown as ConvViewProps
const t = (key: string): string => key

const DEFAULT_REPORTS: ReportSummaryView[] = [
  { reportId: 'r1', title: 'Paper', updatedAt: '2026-01-01' },
  { reportId: 'r2', title: 'Another', updatedAt: '2026-01-02' },
]

function defaultStore(): WritingReportsState {
  return { reports: [...DEFAULT_REPORTS], selectedReportId: 'r1' }
}

let store: WritingReportsState = defaultStore()

const useStore = <S,>(selector: (state: WritingReportsState) => S): S => selector(store)

const storeActions = {
  setReports: (reports: ReportSummaryView[]) => { store = { ...store, reports } },
  select: (reportId: string) => { store = { ...store, selectedReportId: reportId } },
  renameReport: (reportId: string, title: string) => {
    store = { ...store, reports: store.reports.map(r => r.reportId === reportId ? { ...r, title } : r) }
  },
}

/** The editor inject face; selection flows through the shared store. */
function view(over: Partial<WritingViewInjected> = {}): WritingViewInjected {
  return {
    rename: vi.fn().mockResolvedValue(undefined),
    getSource: vi.fn().mockResolvedValue('\\documentclass{article}'),
    updateSource: vi.fn().mockResolvedValue(undefined),
    compile: vi.fn().mockResolvedValue({ ok: true, diagnostics: [], versionCreated: true, pdfUrl: '/writing/r1/pdf' }),
    versions: vi.fn().mockResolvedValue([]),
    restore: vi.fn().mockResolvedValue('\\documentclass{article}'),
    ...over,
  }
}

/** Assemble the component props with the store share, inject face, and locale. */
function props(injected: WritingViewInjected): WritingViewProps {
  return { ...conv, useStore, actions: storeActions, ...injected, t } as WritingViewProps
}

describe('WritingView', () => {
  it('loads the selected report source and compiles once when it has no version', async () => {
    const actions = view()
    render(<WritingView {...props(actions)} />)
    await waitFor(() => expect(actions.getSource).toHaveBeenCalledWith('r1'))
    await waitFor(() => expect(actions.compile).toHaveBeenCalledWith('r1'))
  })

  it('shows the latest compiled PDF without recompiling when a version exists', async () => {
    const actions = view({ versions: vi.fn().mockResolvedValue([{ versionId: 'g1', reportId: 'r1', label: 'l', createdAt: 't1' }]) })
    const { container } = render(<WritingView {...props(actions)} />)
    await waitFor(() => expect(actions.getSource).toHaveBeenCalledWith('r1'))
    expect(actions.compile).not.toHaveBeenCalled()
    expect(container.querySelector('[class*="frame"]')?.getAttribute('src')).toBe('/writing/r1/pdf')
  })

  it('surfaces each compile diagnostic', async () => {
    const actions = view({
      compile: vi.fn().mockResolvedValue({
        ok: false,
        diagnostics: [{ severity: 'error', line: 3, message: 'Undefined control sequence.' }],
        versionCreated: false,
      }),
    })
    render(<WritingView {...props(actions)} />)
    await waitFor(() => expect(actions.getSource).toHaveBeenCalledWith('r1'))
    fireEvent.click(screen.getByText('compile'))
    expect(await screen.findByText(/Undefined control sequence/)).toBeTruthy()
  })

  it('saves and compiles when the save button is pressed', async () => {
    const actions = view()
    const { container } = render(<WritingView {...props(actions)} />)
    await waitFor(() => expect(actions.getSource).toHaveBeenCalledWith('r1'))

    vi.useFakeTimers()
    const textarea = container.querySelector('textarea')
    fireEvent.change(textarea as Element, { target: { value: '\\documentclass{article}% save' } })
    fireEvent.click(screen.getByText('save'))
    await vi.advanceTimersByTimeAsync(0)
    expect(actions.updateSource).toHaveBeenCalledWith('r1', '\\documentclass{article}% save')
    expect(actions.compile).toHaveBeenCalledWith('r1')
    vi.useRealTimers()
  })

  it('auto-saves on an edit but does not recompile until a manual save', async () => {
    const actions = view()
    const { container } = render(<WritingView {...props(actions)} />)
    await waitFor(() => expect(actions.getSource).toHaveBeenCalledWith('r1'))
    const compileBefore = vi.mocked(actions.compile).mock.calls.length

    vi.useFakeTimers()
    const textarea = container.querySelector('textarea')
    fireEvent.change(textarea as Element, { target: { value: '\\documentclass{article}% edited' } })
    await vi.advanceTimersByTimeAsync(1000)
    expect(actions.updateSource).toHaveBeenCalledWith('r1', '\\documentclass{article}% edited')
    expect(vi.mocked(actions.compile).mock.calls.length).toBe(compileBefore)
    vi.useRealTimers()
  })

  it('compiles via Ctrl+S', async () => {
    const actions = view()
    render(<WritingView {...props(actions)} />)
    await waitFor(() => expect(actions.getSource).toHaveBeenCalledWith('r1'))
    const before = vi.mocked(actions.compile).mock.calls.length
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
    await waitFor(() => expect(vi.mocked(actions.compile).mock.calls.length).toBe(before + 1))
  })

  it('opens and closes the LaTeX preview window', async () => {
    const { container } = render(<WritingView {...props(view())} />)
    await waitFor(() => expect(screen.getByText('openPreview')).toBeTruthy())
    fireEvent.click(screen.getByText('openPreview'))
    expect(container.querySelector('[class*="modal"]')).toBeTruthy()
    fireEvent.click(screen.getByText('×'))
    expect(container.querySelector('[class*="modal"]')).toBeNull()
  })

  it('downloads the current source as a .tex file named after the report', async () => {
    const actions = view()
    render(<WritingView {...props(actions)} />)
    await waitFor(() => expect(actions.getSource).toHaveBeenCalledWith('r1'))

    let clickedLink: HTMLAnchorElement | undefined
    const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clickedLink = this
    })
    fireEvent.click(screen.getByText('download'))
    expect(clickedLink?.getAttribute('download')).toBe('Paper.tex')
    expect(clickedLink?.href).toContain('data:text/plain;charset=utf-8,')
    spy.mockRestore()
  })

  it('compiles and downloads from the full-screen preview toolbar', async () => {
    const actions = view()
    const { container } = render(<WritingView {...props(actions)} />)
    await waitFor(() => expect(actions.getSource).toHaveBeenCalledWith('r1'))
    fireEvent.click(screen.getByText('openPreview'))
    const header = container.querySelector('[class*="modalHeader"]') as HTMLElement
    const before = vi.mocked(actions.compile).mock.calls.length
    fireEvent.click(within(header).getByText('compile'))
    expect(vi.mocked(actions.compile).mock.calls.length).toBe(before + 1)
    let clickedLink: HTMLAnchorElement | undefined
    const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clickedLink = this
    })
    fireEvent.click(within(header).getByText('download'))
    expect(clickedLink?.getAttribute('download')).toBe('Paper.tex')
    spy.mockRestore()
  })

  it('lists the document outline and jumps to a heading', async () => {
    const actions = view({ getSource: vi.fn().mockResolvedValue('\\section{Intro}\nbody\n\\subsection{Setup}') })
    const { container } = render(<WritingView {...props(actions)} />)
    await waitFor(() => expect(actions.getSource).toHaveBeenCalledWith('r1'))
    fireEvent.click(screen.getByText(/outline/))
    expect(screen.getByText('Intro')).toBeTruthy()
    expect(screen.getByText('Setup')).toBeTruthy()
    const textarea = container.querySelector('textarea')
    fireEvent.click(screen.getByText('Intro'))
    expect(textarea).toBeTruthy()
  })

  it('restores a version onto a new branch by refreshing the PDF without snapshotting', async () => {
    const actions = view({ versions: vi.fn().mockResolvedValue([
      { versionId: 'g2', reportId: 'r1', label: 'successful compile #2', createdAt: 't2' },
      { versionId: 'g1', reportId: 'r1', label: 'successful compile #1', createdAt: 't1' },
    ]) })
    render(<WritingView {...props(actions)} />)
    await waitFor(() => expect(actions.getSource).toHaveBeenCalledWith('r1'))
    fireEvent.click(screen.getByText(/successful compile #2/))
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('restore-v1')
    fireEvent.click(screen.getByText(/successful compile #1/))
    await waitFor(() => expect(actions.restore).toHaveBeenCalledWith('r1', 'g1', 'restore-v1'))
    await waitFor(() => expect(actions.compile).toHaveBeenCalledWith('r1', { snapshot: false }))
    prompt.mockRestore()
  })
})
