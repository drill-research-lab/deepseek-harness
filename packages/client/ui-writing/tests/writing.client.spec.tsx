// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
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
})
