// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
})
