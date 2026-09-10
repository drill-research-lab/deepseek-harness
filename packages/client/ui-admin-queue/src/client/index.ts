/** Admin queue management settings plugin, browser half. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { AdminQueue, type AdminQueueInjected } from './AdminQueue.tsx'
import { AdminQueueController } from './store.ts'
import { en, zh, zhTw, type AdminQueueKey } from './locales.ts'

export type { AdminQueueInjected, AdminQueueProps } from './AdminQueue.tsx'
export type { AdminQueueKey } from './locales.ts'
export type { AdminQueueState } from './store.ts'
export { ADMIN_QUEUE_POLL_MS, AdminQueueController } from './store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Admin queue management copy. */
    'settings.admin-queue': AdminQueueKey
  }
}

const NS = 'settings.admin-queue'

/** Required services for slot registration and authenticated queue calls. */
export const inject = ['slots', 'locale', 'connection']

/**
 * Register the admin queue page as an in-app Settings section — but only
 * once `auth.me()` confirms this browser's identity is an admin. Frontend
 * hiding is UX only: the entry point never appears for a non-admin, but the
 * real boundary is the server-side admin gate `queue.list`/`queue.reorder`
 * enforce on every call (a non-admin invoking either RPC directly, bypassing
 * this UI entirely, still receives `forbidden`). The check runs once at
 * connection start; it does not follow a mid-session admin-group change
 * (documented in the package README's Known Limitations).
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, 'zh-TW': zhTw, en }), 'ui-admin-queue: dictionaries')
  const connection = ctx.get('connection') as ConnectionHandle
  const controller = new AdminQueueController(connection.api)
  const useSnapshot = bindSnapshotSelector(controller.store)
  const t = ctx.locale.bind(NS) as AdminQueueInjected['t']

  ctx.effect(() => ctx.on('connection/reset', () => {
    if (controller.store.getSnapshot().status !== 'checking-permission') controller.retry()
  }), 'ui-admin-queue: connection reset')

  // Registration is itself an effect: a disposal before the permission check
  // resolves cancels the pending registration instead of racing it.
  ctx.effect(() => {
    let disposed = false
    let unregister: (() => void) | undefined
    void connection.api.auth.me({}).then((response) => {
      if (disposed) return
      if (!response.result.ok || !response.result.value.isAdmin) return
      unregister = ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'admin-queue',
        order: 21,
        label: () => t('nav'),
        inject: (): AdminQueueInjected => ({ controller, useSnapshot, t }),
      }, AdminQueue))
    })
    return () => {
      disposed = true
      unregister?.()
    }
  }, 'ui-admin-queue: admin-only section gate')
}
