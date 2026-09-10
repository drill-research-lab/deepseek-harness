/**
 * Library surface plugin, browser half: one `sidebar.section` entry (the
 * notebook list below the session browser) and one `shell.overlay` entry (the
 * full-page Library view). The two share a closure-scoped page-state
 * observable and a revision counter bumped after every mutation; durable data
 * travels through `ctx.remote.library` and the `/library` data plane. The
 * page state mirrors into the `#library/…` URL hash both ways, so notebooks,
 * documents, and the ask thread are linkable from outside the page.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the generated Remote API and ctx.remote merge through the Client assembly boundary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the ui-sidebar SlotMap merge (the sidebar.section entry).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the ui-layout SlotMap merge (the shell.overlay entry).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { LibraryPageState, LibrarySectionFace, LibraryViewFace, ResourceView } from './types.ts'
import { LibrarySection } from './LibrarySection.tsx'
import { LibraryView } from './LibraryView.tsx'
import { en, NS, zh, zhTw, type LibraryKey } from './locales.ts'

export type { LibraryPageState, LibrarySectionFace, LibraryViewFace } from './types.ts'
export type { AskView, NotebookView, ResourceView } from '@deepseek-ai/dsh-library-api/types'
export type { LibraryKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Library surface's copy. */
    library: LibraryKey
  }
}

/** A settable {@link HostObservable}. */
interface ValueSource<T> extends HostObservable<T> {
  set(next: T): void
}

/**
 * Minimal closure-scoped observable in the standard-kit currency.
 * @param initial - First snapshot value.
 * @returns the observable with its setter.
 */
function valueSource<T>(initial: T): ValueSource<T> {
  let current = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => current,
    subscribe: (fn) => {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    set: (next) => {
      current = next
      for (const fn of [...listeners]) fn()
    },
  }
}

/** Required services: the two slot seats, Remote mutations, and copy. */
export const inject = ['slots', 'locale', 'remote', 'remote.library']

/** The Library page's URL-hash address: `#library/<notebook>[/resource/<id>]`. */
const HASH_RE = /^#library(?:\/([^/]+))?(?:\/resource\/([^/]+))?$/

/** Parse the current location hash into a page state, or `undefined` when it is not a Library address. */
export function stateFromHash(hash: string): LibraryPageState | undefined {
  const match = HASH_RE.exec(hash)
  if (match === null) return undefined
  const notebookId = match[1] === undefined ? undefined : decodeURIComponent(match[1])
  const resourceId = match[2] === undefined ? undefined : decodeURIComponent(match[2])
  return {
    open: true,
    ...notebookId === undefined ? {} : { notebookId },
    ...notebookId === undefined || resourceId === undefined ? {} : { resourceId },
  }
}

/** Project one page state to its hash address; `''` for a closed page. */
export function hashFromState(state: LibraryPageState): string {
  if (!state.open) return ''
  let hash = '#library'
  if (state.notebookId !== undefined) {
    hash += `/${encodeURIComponent(state.notebookId)}`
    if (state.resourceId !== undefined) hash += `/resource/${encodeURIComponent(state.resourceId)}`
  }
  return hash
}

/**
 * Register the Library surface. The inject faces wrap the Remote calls,
 * branching on `ok`, and bump the shared revision after every mutation.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, 'zh-TW': zhTw, en }), 'ui-library: dictionaries')

  const pageState = valueSource<LibraryPageState>({ open: false })
  const revision = valueSource(0)
  const sidebarEdge = valueSource(0)
  const bump = () => { revision.set(revision.getSnapshot() + 1) }

  // Deep links: the page state mirrors into the `#library/…` hash, so a
  // document or the ask thread is reachable from outside the page (a pasted
  // URL, a link an agent wrote in chat). The hash is applied at boot and on
  // every later hashchange; state changes rewrite the hash without growing
  // the history.
  ctx.effect(() => {
    const applyHash = (): void => {
      const next = stateFromHash(window.location.hash)
      if (next !== undefined) {
        pageState.set(next)
      } else if (pageState.getSnapshot().open && window.location.hash === '') {
        pageState.set({ ...pageState.getSnapshot(), open: false })
      }
    }
    const syncHash = (): void => {
      const wanted = hashFromState(pageState.getSnapshot())
      if (wanted === window.location.hash) return
      const base = window.location.pathname + window.location.search
      window.history.replaceState(null, '', wanted === '' ? base : base + wanted)
    }
    applyHash()
    const unsubscribe = pageState.subscribe(syncHash)
    window.addEventListener('hashchange', applyHash)
    return () => {
      unsubscribe()
      window.removeEventListener('hashchange', applyHash)
    }
  }, 'ui-library: hash deep links')

  const unwrap = <T>(result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T => {
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
    return result.value
  }

  const listNotebooks = async () => unwrap(await ctx.remote.library.listNotebooks())

  const uploadFile = async (notebookId: string, file: File): Promise<ResourceView> => {
    const query = `notebook=${encodeURIComponent(notebookId)}&name=${encodeURIComponent(file.name)}&kind=source`
    const response = await globalThis.fetch(`/library/upload?${query}`, {
      method: 'POST',
      headers: { 'content-type': file.type === '' ? 'application/octet-stream' : file.type },
      body: file,
    })
    if (!response.ok) {
      const body = await response.text()
      throw new Error(`upload failed (${String(response.status)}): ${body}`)
    }
    const resource = await response.json() as ResourceView
    bump()
    return resource
  }

  ctx.slots.inject('sidebar.section', () => ctx.slots.register({
    name: 'sidebar.section',
    id: 'library',
    order: 10,
    locale: NS,
    inject: (): LibrarySectionFace => ({
      hooks: { pageState, revision, sidebarEdge },
      onOpen: (notebookId) => {
        const next = notebookId ?? pageState.getSnapshot().notebookId
        pageState.set(next === undefined ? { open: true } : { open: true, notebookId: next })
      },
      onMeasure: (edge) => {
        if (edge !== sidebarEdge.getSnapshot()) sidebarEdge.set(edge)
      },
      listNotebooks,
      createNotebook: async (title) => {
        const notebook = unwrap(await ctx.remote.library.createNotebook({ title }))
        bump()
        pageState.set({ open: true, notebookId: notebook.notebookId })
      },
    }),
  }, LibrarySection))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'library',
    locale: NS,
    inject: (): LibraryViewFace => ({
      hooks: { pageState, revision, sidebarEdge },
      onClose: () => {
        pageState.set({ ...pageState.getSnapshot(), open: false })
      },
      onSelectNotebook: (notebookId) => {
        // A notebook switch drops the open preview: the resource belongs to
        // the previous notebook.
        pageState.set({ open: true, notebookId })
      },
      onOpenResource: (resourceId) => {
        const current = pageState.getSnapshot()
        if (current.notebookId === undefined) return
        pageState.set(resourceId === undefined
          ? { open: current.open, notebookId: current.notebookId }
          : { open: current.open, notebookId: current.notebookId, resourceId })
      },
      listNotebooks,
      createNotebook: async (title) => {
        const notebook = unwrap(await ctx.remote.library.createNotebook({ title }))
        bump()
        return notebook
      },
      renameNotebook: async (notebookId, title) => {
        unwrap(await ctx.remote.library.renameNotebook({ notebookId, title }))
        bump()
      },
      deleteNotebook: async (notebookId) => {
        unwrap(await ctx.remote.library.deleteNotebook({ notebookId }))
        bump()
        const current = pageState.getSnapshot()
        if (current.notebookId === notebookId) pageState.set({ open: current.open })
      },
      listResources: async notebookId => unwrap(await ctx.remote.library.listResources({ notebookId })),
      deleteResource: async (resourceId) => {
        unwrap(await ctx.remote.library.deleteResource({ resourceId }))
        bump()
      },
      ingestText: async (notebookId, name, text) => {
        const resource = unwrap(await ctx.remote.library.ingestText({ notebookId, name, text, kind: 'source' }))
        bump()
        return resource
      },
      uploadFile,
      readMarkdown: async resourceId => unwrap(await ctx.remote.library.readMarkdown({ resourceId })).content,
      ask: async (notebookId, question) => unwrap(await ctx.remote.library.ask({ notebookId, question })),
      askLog: async notebookId => unwrap(await ctx.remote.library.askLog({ notebookId })),
      fileUrl: (resourceId, variant) => `/library/${encodeURIComponent(resourceId)}/${variant}`,
    }),
  }, LibraryView))
}
