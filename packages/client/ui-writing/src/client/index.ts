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
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { WritingViewInjected } from './types.ts'
import { WritingView } from './WritingView.tsx'
import { en, NS, zh, zhTw, type WritingKey } from './locales.ts'

export type { WritingViewInjected } from './types.ts'
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
 * Register the Writing view once its conversation.view declaration is on the
 * ledger. The inject face wraps the Remote calls, branching on `ok`.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, 'zh-TW': zhTw, en }), 'ui-writing: dictionaries')
  const t = ctx.locale.bind(NS)

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'writing',
    order: 30,
    locale: NS,
    label: () => t('view.writing'),
    inject: (_sessionId: SessionId): WritingViewInjected => ({
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
      getSource: async (reportId) => {
        const result = await ctx.remote.writing.get({ reportId })
        if (!result.ok) throw new Error(result.error.message)
        return result.value?.source ?? ''
      },
      updateSource: async (reportId, source) => {
        const result = await ctx.remote.writing.updateContent({ reportId, source })
        if (!result.ok) throw new Error(result.error.message)
      },
      compile: async (reportId) => {
        const result = await ctx.remote.writing.compile({ reportId })
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
      restore: async (reportId, versionId) => {
        const result = await ctx.remote.writing.restore({ reportId, versionId })
        if (!result.ok) throw new Error(result.error.message)
        return result.value.source
      },
    }),
  }, WritingView))
}
