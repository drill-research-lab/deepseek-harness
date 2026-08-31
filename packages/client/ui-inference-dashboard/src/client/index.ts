/** Inference dashboard settings plugin, browser half. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { InferenceDashboard, type InferenceDashboardInjected } from './InferenceDashboard.tsx'
import { InferenceDashboardController } from './store.ts'
import { en, zh, zhTw, type InferenceDashboardKey } from './locales.ts'

export type { InferenceDashboardInjected, InferenceDashboardProps } from './InferenceDashboard.tsx'
export type { InferenceDashboardKey } from './locales.ts'
export type { InferenceDashboardMetrics, InferenceDashboardState } from './store.ts'
export { InferenceDashboardController } from './store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Inference runtime dashboard copy. */
    'settings.inference-dashboard': InferenceDashboardKey
  }
}

const NS = 'settings.inference-dashboard'

/** Required services for slot registration and authenticated metrics calls. */
export const inject = ['slots', 'locale', 'connection']

/**
 * Register the dashboard as an in-app Settings section.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, 'zh-TW': zhTw, en }), 'ui-inference-dashboard: dictionaries')
  const connection = ctx.get('connection') as ConnectionHandle
  const controller = new InferenceDashboardController(connection.api)
  const useSnapshot = bindSnapshotSelector(controller.store)
  const t = ctx.locale.bind(NS) as InferenceDashboardInjected['t']

  ctx.effect(() => ctx.on('connection/reset', () => {
    controller.refreshIfActive()
  }), 'ui-inference-dashboard: connection reset')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'inference-dashboard',
    order: 20,
    label: () => t('nav'),
    inject: (): InferenceDashboardInjected => ({ controller, useSnapshot, t }),
  }, InferenceDashboard))
}
