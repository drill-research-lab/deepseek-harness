// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { CompileResultView } from '@deepseek-ai/dsh-writing-api/types'
import { WritingView, type WritingViewProps } from '../src/client/WritingView.tsx'
import type { WritingViewInjected } from '../src/client/types.ts'

afterEach(() => cleanup())

const conv = {} as unknown as ConvViewProps

const t = (key: string): string => key

function view(over: Partial<WritingViewInjected> = {}): WritingViewInjected {
  return {
    listReports: vi.fn().mockResolvedValue([{ reportId: 'r1', title: 'Paper', updatedAt: '2026-01-01' }]),
    createReport: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    getSource: vi.fn().mockResolvedValue('\\documentclass{article}'),
    updateSource: vi.fn().mockResolvedValue(undefined),
    compile: vi.fn().mockResolvedValue({ ok: true, diagnostics: [], versionCreated: true, pdfUrl: '/writing/r1/pdf' }),
    versions: vi.fn().mockResolvedValue([]),
    restore: vi.fn().mockResolvedValue('\\documentclass{article}'),
    ...over,
  }
}

/** Assemble the component props with a framework-hook stub and cast to the props type. */
function props(actions: WritingViewInjected): WritingViewProps {
  return { ...conv, ...actions, t } as WritingViewProps
}

describe('WritingView', () => {
  it('renders the report list and the empty preview', async () => {
    render(<WritingView {...props(view())} />)
    expect(await screen.findByText('Paper')).toBeTruthy()
    expect(screen.getByText('noPreview')).toBeTruthy()
  })

  it('creates a report from the trimmed title', async () => {
    const actions = view()
    render(<WritingView {...props(actions)} />)
    fireEvent.input(screen.getByPlaceholderText('newPlaceholder'), { target: { value: '  New report  ' } })
    fireEvent.click(screen.getByText('create'))
    await waitFor(() => expect(actions.createReport).toHaveBeenCalledWith('New report'))
  })

  it('compiles the selected report and shows the success message', async () => {
    const actions = view()
    render(<WritingView {...props(actions)} />)
    fireEvent.click(await screen.findByText('Paper'))
    await waitFor(() => expect(actions.getSource).toHaveBeenCalledWith('r1'))
    fireEvent.click(screen.getByText('compile'))
    expect(await screen.findByText('compiledOk')).toBeTruthy()
    expect(actions.compile).toHaveBeenCalledWith('r1')
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
    fireEvent.click(await screen.findByText('Paper'))
    await waitFor(() => expect(actions.getSource).toHaveBeenCalledWith('r1'))
    fireEvent.click(screen.getByText('compile'))
    expect(await screen.findByText(/Undefined control sequence/)).toBeTruthy()
  })

  it('auto-saves and recompiles after a one-second edit pause', async () => {
    const actions = view()
    const { container } = render(<WritingView {...props(actions)} />)
    fireEvent.click(await screen.findByText('Paper'))
    await waitFor(() => expect(actions.getSource).toHaveBeenCalledWith('r1'))

    vi.useFakeTimers()
    const textarea = container.querySelector('textarea')
    fireEvent.change(textarea as Element, { target: { value: '\\documentclass{article}% edited' } })
    await vi.advanceTimersByTimeAsync(1000)
    expect(actions.updateSource).toHaveBeenCalledWith('r1', '\\documentclass{article}% edited')
    expect(actions.compile).toHaveBeenCalledWith('r1')
    vi.useRealTimers()
  })

  it('does not auto-save while the edit pause has not elapsed', async () => {
    const actions = view()
    const { container } = render(<WritingView {...props(actions)} />)
    fireEvent.click(await screen.findByText('Paper'))
    await waitFor(() => expect(actions.getSource).toHaveBeenCalledWith('r1'))

    vi.useFakeTimers()
    const textarea = container.querySelector('textarea')
    fireEvent.change(textarea as Element, { target: { value: '\\documentclass{article}% edit' } })
    await vi.advanceTimersByTimeAsync(500)
    expect(actions.updateSource).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('shows a compiling indicator while a compile is in flight', async () => {
    let release!: (value: CompileResultView) => void
    const actions = view({
      compile: vi.fn(() => new Promise<CompileResultView>((resolve) => { release = resolve })),
    })
    render(<WritingView {...props(actions)} />)
    fireEvent.click(await screen.findByText('Paper'))
    await waitFor(() => expect(actions.getSource).toHaveBeenCalledWith('r1'))

    fireEvent.click(screen.getByText('compile'))
    expect(screen.getByText('compiling')).toBeTruthy()
    release({ ok: true, diagnostics: [], versionCreated: true, pdfUrl: '/writing/r1/pdf' })
    await waitFor(() => expect(screen.queryByText('compiling')).toBeNull())
    expect(screen.getByText('compiledOk')).toBeTruthy()
  })

  it('resizes the editor split when the divider is dragged', () => {
    const { container } = render(<WritingView {...props(view())} />)
    const editor = container.querySelector('main')
    editor!.getBoundingClientRect = () => ({
      width: 1000, height: 500, top: 0, left: 0, right: 1000, bottom: 500, x: 0, y: 0,
      toJSON: () => ({}),
    })
    const divider = container.querySelector('[class*="divider"]')!
    fireEvent.pointerDown(divider, { clientX: 500 })
    fireEvent.pointerMove(window, { clientX: 600 })
    fireEvent.pointerUp(window)
    expect(editor!.style.gridTemplateColumns).toContain('60%')
  })

  it('shows only the latest version and expands the list on demand', async () => {
    const versions = [
      { versionId: 'v2', reportId: 'r1', label: 'successful compile #2', source: 's', createdAt: 't2' },
      { versionId: 'v1', reportId: 'r1', label: 'successful compile #1', source: 's', createdAt: 't1' },
    ]
    const actions = view({ versions: vi.fn().mockResolvedValue(versions) })
    render(<WritingView {...props(actions)} />)
    fireEvent.click(await screen.findByText('Paper'))
    await waitFor(() => expect(actions.getSource).toHaveBeenCalledWith('r1'))

    expect(screen.getByText(/successful compile #2/)).toBeTruthy()
    expect(screen.queryByText(/successful compile #1/)).toBeNull()

    fireEvent.click(screen.getByText(/successful compile #2/))
    expect(screen.getByText(/successful compile #1/)).toBeTruthy()
  })

  it('collapses and re-expands the report list', async () => {
    render(<WritingView {...props(view())} />)
    expect(await screen.findByText('Paper')).toBeTruthy()

    fireEvent.click(screen.getByText('−'))
    expect(screen.queryByText('Paper')).toBeNull()

    fireEvent.click(screen.getByTitle('listExpand'))
    expect(await screen.findByText('Paper')).toBeTruthy()
  })

  it('opens and closes the LaTeX preview window', async () => {
    const { container } = render(<WritingView {...props(view())} />)
    fireEvent.click(await screen.findByText('Paper'))
    await waitFor(() => expect(screen.getByText('openPreview')).toBeTruthy())

    fireEvent.click(screen.getByText('openPreview'))
    expect(container.querySelector('[class*="modal"]')).toBeTruthy()

    fireEvent.click(screen.getByText('×'))
    expect(container.querySelector('[class*="modal"]')).toBeNull()
  })

  it('compiles on open when the report has no version yet', async () => {
    const actions = view()
    render(<WritingView {...props(actions)} />)
    fireEvent.click(await screen.findByText('Paper'))
    await waitFor(() => expect(actions.compile).toHaveBeenCalledWith('r1'))
  })

  it('shows the latest compiled PDF without recompiling when a version exists', async () => {
    const actions = view({ versions: vi.fn().mockResolvedValue([{ versionId: 'v1', reportId: 'r1', label: 'l', source: 's', createdAt: 't1' }]) })
    const { container } = render(<WritingView {...props(actions)} />)
    fireEvent.click(await screen.findByText('Paper'))
    await waitFor(() => expect(actions.getSource).toHaveBeenCalledWith('r1'))
    expect(actions.compile).not.toHaveBeenCalled()
    expect(container.querySelector('[class*="frame"]')?.getAttribute('src')).toBe('/writing/r1/pdf')
  })

  it('does not recompile when opening the preview after an open-compile', async () => {
    const actions = view()
    render(<WritingView {...props(actions)} />)
    fireEvent.click(await screen.findByText('Paper'))
    await waitFor(() => expect(actions.compile).toHaveBeenCalledWith('r1'))
    const before = vi.mocked(actions.compile).mock.calls.length
    fireEvent.click(screen.getByText('openPreview'))
    expect(vi.mocked(actions.compile).mock.calls.length).toBe(before)
  })

  it('shows line numbers in the editor gutter', async () => {
    const { container } = render(<WritingView {...props(view())} />)
    fireEvent.click(await screen.findByText('Paper'))
    await waitFor(() => expect(screen.getByText('openPreview')).toBeTruthy())
    const gutter = container.querySelector('[class*="gutter"]')
    expect(gutter?.textContent).toBe('1')
  })

  it('lists the document outline and jumps to a heading', async () => {
    const actions = view({ getSource: vi.fn().mockResolvedValue('\\section{Intro}\nbody\n\\subsection{Setup}') })
    const { container } = render(<WritingView {...props(actions)} />)
    fireEvent.click(await screen.findByText('Paper'))
    await waitFor(() => expect(actions.getSource).toHaveBeenCalledWith('r1'))
    fireEvent.click(screen.getByText(/outline/))
    expect(screen.getByText('Intro')).toBeTruthy()
    expect(screen.getByText('Setup')).toBeTruthy()
    const textarea = container.querySelector('textarea')
    fireEvent.click(screen.getByText('Intro'))
    expect(textarea).toBeTruthy()
  })

  it('auto-saves and recompiles from the full-screen editor', async () => {
    const actions = view()
    const { container } = render(<WritingView {...props(actions)} />)
    fireEvent.click(await screen.findByText('Paper'))
    await waitFor(() => expect(actions.getSource).toHaveBeenCalledWith('r1'))
    fireEvent.click(screen.getByText('openPreview'))

    vi.useFakeTimers()
    const modalEditor = container.querySelector('[class*="modalEditor"]')
    const textarea = modalEditor?.querySelector('textarea')
    fireEvent.change(textarea as Element, { target: { value: '\\documentclass{article}% modal' } })
    await vi.advanceTimersByTimeAsync(1000)
    expect(actions.updateSource).toHaveBeenCalledWith('r1', '\\documentclass{article}% modal')
    expect(actions.compile).toHaveBeenCalledWith('r1')
    vi.useRealTimers()
  })

  it('resizes the full-screen editor preview split', async () => {
    const { container } = render(<WritingView {...props(view())} />)
    fireEvent.click(await screen.findByText('Paper'))
    fireEvent.click(screen.getByText('openPreview'))
    const modalEditor = container.querySelector('[class*="modalEditor"]')
    modalEditor!.getBoundingClientRect = () => ({
      width: 1000, height: 500, top: 0, left: 0, right: 1000, bottom: 500, x: 0, y: 0,
      toJSON: () => ({}),
    })
    const divider = container.querySelectorAll('[class*="divider"]')[1] as Element
    fireEvent.pointerDown(divider, { clientX: 500 })
    fireEvent.pointerMove(window, { clientX: 600 })
    fireEvent.pointerUp(window)
    expect(modalEditor!.getAttribute('style')).toContain('60%')
  })

  it('downloads the current source as a .tex file named after the report', async () => {
    const actions = view()
    render(<WritingView {...props(actions)} />)
    fireEvent.click(await screen.findByText('Paper'))
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

  it('compiles from the full-screen preview toolbar', async () => {
    const actions = view()
    const { container } = render(<WritingView {...props(actions)} />)
    fireEvent.click(await screen.findByText('Paper'))
    await waitFor(() => expect(actions.getSource).toHaveBeenCalledWith('r1'))
    fireEvent.click(screen.getByText('openPreview'))
    const header = container.querySelector('[class*="modalHeader"]') as HTMLElement
    const before = vi.mocked(actions.compile).mock.calls.length
    fireEvent.click(within(header).getByText('compile'))
    expect(vi.mocked(actions.compile).mock.calls.length).toBe(before + 1)
  })

  it('downloads the report from the full-screen preview toolbar', async () => {
    const actions = view()
    const { container } = render(<WritingView {...props(actions)} />)
    fireEvent.click(await screen.findByText('Paper'))
    await waitFor(() => expect(actions.getSource).toHaveBeenCalledWith('r1'))
    fireEvent.click(screen.getByText('openPreview'))
    const header = container.querySelector('[class*="modalHeader"]') as HTMLElement

    let clickedLink: HTMLAnchorElement | undefined
    const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clickedLink = this
    })
    fireEvent.click(within(header).getByText('download'))
    expect(clickedLink?.getAttribute('download')).toBe('Paper.tex')
    spy.mockRestore()
  })

  it('restores a version by refreshing the PDF without snapshotting a new version', async () => {
    const actions = view({
      versions: vi.fn().mockResolvedValue([
        { versionId: 'v2', reportId: 'r1', label: 'successful compile #2', source: 's', createdAt: 't2' },
        { versionId: 'v1', reportId: 'r1', label: 'successful compile #1', source: 's', createdAt: 't1' },
      ]),
    })
    render(<WritingView {...props(actions)} />)
    fireEvent.click(await screen.findByText('Paper'))
    await waitFor(() => expect(actions.getSource).toHaveBeenCalledWith('r1'))
    fireEvent.click(screen.getByText(/successful compile #2/))
    fireEvent.click(screen.getByText(/successful compile #1/))
    await waitFor(() => expect(actions.restore).toHaveBeenCalledWith('r1', 'v1'))
    await waitFor(() => expect(actions.compile).toHaveBeenCalledWith('r1', { snapshot: false }))
  })
})
