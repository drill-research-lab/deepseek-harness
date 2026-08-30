/**
 * Writing surface plugin, browser half: one `conversation.view` entry ("Writing")
 * rendering the report list + LaTeX/PDF split editor + compile feedback. The
 * report data arrives through the Remote-backed inject face; the component owns
 * its view-local state (selection, draft, compile output), so the plugin holds
 * no store and no event listeners.
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the generated Remote API and ctx.remote merge through the Client assembly boundary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the ui-conversation SlotMap merge (the conversation.view entry).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the ui-sidebar SlotMap merge (the sidebar.reports entry).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { SidebarReportsInjected, WritingViewInjected } from './types.ts'
import { WritingView } from './WritingView.tsx'
import { SidebarReports } from './SidebarReports.tsx'
import { createWritingReportsStore } from './reportStore.ts'
import { en, NS, zh, zhTw, type WritingKey } from './locales.ts'

export type { SidebarReportsInjected, WritingViewInjected } from './types.ts'
export type { CompileResultView, ReportVersionView } from '@deepseek-ai/dsh-writing-api/types'
export type { WritingKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The writing view's copy. */
    writing: WritingKey
  }
}

/** Required services: the conversation view slot, Remote mutations, sessions, and copy. */
export const inject = ['slots', 'conversationViews', 'sessions', 'locale', 'remote', 'remote.writing']

/**
 * Register the Writing editor view and its sidebar report panel over one shared
 * report-selection store. Both slot contributions use the same store handle so
 * picking a report in the sidebar drives the editor and vice versa.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, 'zh-TW': zhTw, en }), 'ui-writing: dictionaries')
  const t = ctx.locale.bind(NS)
  const reportsStore = createWritingReportsStore()

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'writing',
    order: 30,
    locale: NS,
    label: () => t('view.writing'),
    store: reportsStore,
    inject: (_sessionId: SessionId): WritingViewInjected => ({
      rename: async (reportId, title) => {
        const result = await ctx.remote.writing.rename({ reportId, title })
        if (!result.ok) throw new Error(result.error.message)
      },
      getSource: async (reportId) => {
        const result = await ctx.remote.writing.get({ reportId })
        if (!result.ok) throw new Error(result.error.message)
        return result.value?.source ?? ''
      },
      updateSource: async (reportId, source) => {
        const result = await ctx.remote.writing.updateContent({ reportId, source })
        if (!result.ok) throw new Error(result.error.message)
      },
      compile: async (reportId, options) => {
        const result = await ctx.remote.writing.compile({
          reportId,
          ...(options?.snapshot === undefined ? {} : { snapshot: options.snapshot }),
        })
        if (!result.ok) throw new Error(result.error.message)
        const value = result.value
        return {
          ok: value.ok,
          diagnostics: value.diagnostics,
          versionCreated: value.versionCreated,
          ...(value.pdfUrl === undefined ? {} : { pdfUrl: value.pdfUrl }),
        }
      },
      versions: async (reportId) => {
        const result = await ctx.remote.writing.versions({ reportId })
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      restore: async (reportId, versionId, branch) => {
        const result = await ctx.remote.writing.restore({ reportId, versionId, branch })
        if (!result.ok) throw new Error(result.error.message)
        return result.value.source
      },
    }),
  }, WritingView))

  ctx.slots.inject('sidebar.reports', () => ctx.slots.register({
    name: 'sidebar.reports',
    locale: NS,
    store: reportsStore,
    inject: (): SidebarReportsInjected => ({
      listReports: async () => {
        const result = await ctx.remote.writing.list()
        if (!result.ok) throw new Error(result.error.message)
        return result.value.map(view => ({
          reportId: view.reportId,
          title: view.title,
          updatedAt: view.updatedAt,
        }))
      },
      createReport: async (title) => {
        const result = await ctx.remote.writing.create({ title })
        if (!result.ok) throw new Error(result.error.message)
      },
    }),
  }, SidebarReports))
}
