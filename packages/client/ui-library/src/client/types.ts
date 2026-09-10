/**
 * Inject faces of the Library surface: the sidebar section and the full-page
 * view share one page-state observable created in `apply`, and every durable
 * fact travels through the library Remote namespace or the `/library` data
 * plane — the components hold view-local state only.
 */
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { AskLogEntryView, AskView, NotebookView, ResourceView } from '@deepseek-ai/dsh-library-api/types'

export type { AskLogEntryView, AskView, NotebookView, ResourceView } from '@deepseek-ai/dsh-library-api/types'

/**
 * Whether the Library page is open, which notebook it shows, and which
 * resource its preview panel holds. The whole triple is shared state (not
 * view-local) because it doubles as the page's address: the plugin mirrors it
 * into the `#library/…` URL hash, so documents and the ask thread are
 * linkable from outside the page.
 */
export interface LibraryPageState {
  /** Whether the full-page view renders. */
  readonly open: boolean
  /** Selected notebook id; `undefined` before the first selection. */
  readonly notebookId?: string
  /** Resource open in the preview panel; `undefined` keeps the panel closed. */
  readonly resourceId?: string
}

/** Shared observables of the Library surface. */
export interface LibraryHooks {
  hooks: {
    /** Page open/selection state shared by the section and the view. */
    pageState: HostObservable<LibraryPageState>
    /** Bumped after every notebook/resource mutation so peers refetch. */
    revision: HostObservable<number>
    /**
     * Viewport x of the sidebar's right edge, measured by the sidebar
     * section, so the page view starts beside the sidebar instead of
     * covering it.
     */
    sidebarEdge: HostObservable<number>
  }
}

/** Inject face of the sidebar section. */
export interface LibrarySectionFace extends LibraryHooks {
  /** Open the Library page, optionally on one notebook. */
  onOpen(notebookId?: string): void
  /** Report the sidebar's current right edge (viewport x, px). */
  onMeasure(edge: number): void
  /** List notebooks, newest first. */
  listNotebooks(): Promise<readonly NotebookView[]>
  /** Create a notebook and open the page on it. */
  createNotebook(title: string): Promise<void>
}

/** Inject face of the full-page Library view. */
export interface LibraryViewFace extends LibraryHooks {
  /** Close the Library page. */
  onClose(): void
  /** Switch the page to one notebook (closing any open preview). */
  onSelectNotebook(notebookId: string): void
  /** Open one resource in the preview panel, or close it with `undefined`. */
  onOpenResource(resourceId: string | undefined): void
  /** List notebooks, newest first. */
  listNotebooks(): Promise<readonly NotebookView[]>
  /** Create a notebook and select it. */
  createNotebook(title: string): Promise<NotebookView>
  /** Rename one notebook. */
  renameNotebook(notebookId: string, title: string): Promise<void>
  /** Delete one notebook with its files. */
  deleteNotebook(notebookId: string): Promise<void>
  /** List one notebook's resources, newest first. */
  listResources(notebookId: string): Promise<readonly ResourceView[]>
  /** Delete one resource with its files. */
  deleteResource(resourceId: string): Promise<void>
  /** Ingest pasted text; resolves once conversion settles. */
  ingestText(notebookId: string, name: string, text: string): Promise<ResourceView>
  /** Upload one file through the `/library` data plane; resolves once conversion settles. */
  uploadFile(notebookId: string, file: File): Promise<ResourceView>
  /** Read one resource's converted Markdown. */
  readMarkdown(resourceId: string): Promise<string>
  /** Ask the notebook a question; resolves to the grounded answer. */
  ask(notebookId: string, question: string): Promise<AskView>
  /** Read one notebook's durable ask history, oldest first. */
  askLog(notebookId: string): Promise<readonly AskLogEntryView[]>
  /**
   * Same-origin URL of one resource's stored original.
   * @param resourceId - Resource id.
   * @param variant - `raw` for inline preview, `download` for attachment disposition.
   */
  fileUrl(resourceId: string, variant: 'raw' | 'download'): string
}
