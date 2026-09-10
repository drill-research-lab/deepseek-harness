// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AskLogEntryView, NotebookView, ResourceView } from '../src/client/types.ts'
import type { LibraryViewProps } from '../src/client/LibraryView.tsx'
import { LibraryView } from '../src/client/LibraryView.tsx'
import { en } from '../src/client/locales.ts'

// English-dictionary translate stub with `{param}` interpolation, so the
// assertions below query the same copy the shell renders.
const t: LibraryViewProps['t'] = (key: string, params?: Record<string, unknown>) => {
  let value = (en as Record<string, string>)[key] ?? key
  for (const [name, replacement] of Object.entries(params ?? {})) {
    value = value.replaceAll(`{${name}}`, String(replacement))
  }
  return value
}

afterEach(cleanup)

const notebook: NotebookView = {
  notebookId: 'nb1',
  title: '圖學課程',
  resourceCount: 2,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
}

const resources: ResourceView[] = [
  {
    resourceId: 'r-pdf',
    notebookId: 'nb1',
    name: 'library-demo.pdf',
    kind: 'source',
    status: 'ready',
    mediaType: 'application/pdf',
    bytes: 2048,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  },
  {
    resourceId: 'r-md',
    notebookId: 'nb1',
    name: 'shader-notes.md',
    kind: 'source',
    status: 'ready',
    mediaType: 'text/markdown',
    bytes: 512,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  },
]

const askEntries: AskLogEntryView[] = [
  {
    id: 'e1',
    origin: 'agent',
    question: 'what sets the pixel color?',
    answer: 'gl_FragColor sets it [shader-notes.md]',
    grounded: true,
    sources: [{ resourceId: 'r-md', name: 'shader-notes.md', heading: '' }],
    createdAt: '2026-09-01T00:00:00Z',
  },
]

function mountView(state: { open: boolean; notebookId?: string; resourceId?: string }) {
  const onOpenResource = vi.fn()
  const props = {
    usePageState: (selector: (value: typeof state) => unknown) => selector(state),
    useRevision: (selector: (value: number) => unknown) => selector(0),
    useSidebarEdge: (selector: (value: number) => unknown) => selector(0),
    onClose: vi.fn(),
    onSelectNotebook: vi.fn(),
    onOpenResource,
    listNotebooks: vi.fn(async () => [notebook]),
    createNotebook: vi.fn(),
    renameNotebook: vi.fn(),
    deleteNotebook: vi.fn(),
    listResources: vi.fn(async () => resources),
    deleteResource: vi.fn(),
    ingestText: vi.fn(),
    uploadFile: vi.fn(),
    readMarkdown: vi.fn(async () => '# Shaders\ngl_FragColor sets the pixel color.'),
    ask: vi.fn(),
    askLog: vi.fn(async () => askEntries),
    fileUrl: (resourceId: string, variant: string) => `/library/${resourceId}/${variant}`,
    t,
  }
  render(<LibraryView {...props as unknown as LibraryViewProps} />)
  return { onOpenResource, props }
}

describe('LibraryView', () => {
  it('renders nothing while the page state is closed', () => {
    mountView({ open: false })
    expect(screen.queryByPlaceholderText(en['view.ask.placeholder'])).toBeNull()
  })

  it('renders the notebook header, sources, and the persisted ask thread', async () => {
    mountView({ open: true, notebookId: 'nb1' })
    await waitFor(() => { expect(screen.getByText('圖學課程')).toBeTruthy() })
    expect(screen.getByText(en['view.notebook.count'].replace('{count}', '2'))).toBeTruthy()
    expect(screen.getByText('library-demo.pdf')).toBeTruthy()
    // The durable log renders, agent-asked exchanges tagged.
    await waitFor(() => { expect(screen.getByText('what sets the pixel color?')).toBeTruthy() })
    expect(screen.getByText(en['view.ask.agent'])).toBeTruthy()
    // The composer is present; no preview panel without a resource address.
    expect(screen.getByPlaceholderText(en['view.ask.placeholder'])).toBeTruthy()
    expect(screen.queryByText(en['view.preview.markdown'])).toBeNull()
  })

  it('opens a source into the preview address on click', async () => {
    const { onOpenResource } = mountView({ open: true, notebookId: 'nb1' })
    // The name appears both as the source row and as a citation pill; the
    // source row is the button that also carries the size meta line.
    await waitFor(() => { expect(screen.getAllByText('shader-notes.md').length).toBeGreaterThan(0) })
    const row = screen.getAllByText('shader-notes.md')
      .map(element => element.closest('button'))
      .find(button => button?.textContent?.includes('512 B'))
    expect(row).toBeTruthy()
    fireEvent.click(row as HTMLElement)
    expect(onOpenResource).toHaveBeenCalledWith('r-md')
  })

  it('previews a Markdown source rendered, with the mode toggles shown', async () => {
    mountView({ open: true, notebookId: 'nb1', resourceId: 'r-md' })
    await waitFor(() => { expect(screen.getByText(en['view.preview.markdown'])).toBeTruthy() })
    // text/markdown offers both modes and lands on rendered Markdown.
    expect(screen.getByText(en['view.preview.original'])).toBeTruthy()
    await waitFor(() => { expect(screen.getByText('gl_FragColor sets the pixel color.')).toBeTruthy() })
  })

  it('previews a PDF source on its original with the PDF frame', async () => {
    mountView({ open: true, notebookId: 'nb1', resourceId: 'r-pdf' })
    await waitFor(() => { expect(screen.getByTitle('library-demo.pdf')).toBeTruthy() })
    expect(screen.getByTitle('library-demo.pdf').getAttribute('src')).toBe('/library/r-pdf/raw')
    expect(screen.getByText(en['view.preview.pdf'])).toBeTruthy()
  })

  it('routes a citation pill back into the preview address', async () => {
    const { onOpenResource } = mountView({ open: true, notebookId: 'nb1' })
    await waitFor(() => { expect(screen.getByText('shader-notes.md', { selector: 'button *' })).toBeTruthy() })
    const pill = screen.getAllByText('shader-notes.md').map(el => el.closest('button')).find(el => el?.textContent === 'shader-notes.md')
    expect(pill).toBeTruthy()
    fireEvent.click(pill as HTMLElement)
    expect(onOpenResource).toHaveBeenCalledWith('r-md')
  })
})
