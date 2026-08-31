/**
 * Pipelines surface plugin, browser half: the sidebar Pipelines block and the
 * full-window editor overlay, sharing one root-scoped store (the open
 * pipeline) and one inject face over the generated pipelines Remote API.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the generated Remote API and ctx.remote merge through the Client assembly boundary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls ui-sidebar's SlotMap merge (the 'sidebar.pipelines' entry).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls ui-layout's SlotMap merge (the 'shell.overlay' entry).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { PipelineApi, PipelineUiActions, PipelineUiState } from './slots.ts'
import { createPipelineUiStore } from './slots.ts'
import type { EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import { PipelinesNav } from './PipelinesNav.tsx'
import { PipelineEditor } from './PipelineEditor.tsx'
import { en, zh, zhTw, type PipelineKey } from './locales.ts'

export { createPipelineUiStore } from './slots.ts'
export type { PipelineApi, PipelineEditorProps, PipelineNavInjected, PipelineUiActions, PipelineUiState, PipelinesNavProps } from './slots.ts'
export { layoutDag, type LaidOutNode } from './PipelineCanvas.tsx'
export type { PipelineKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The pipelines surface's copy. */
    pipeline: PipelineKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'pipeline'

/** Required services for the slot registrations, Remote verbs, shared store, and copy. */
export const inject = ['slots', 'remote', 'remote.pipelines', 'locale']

/**
 * Client plugin body: the sidebar navigation block and the editor overlay,
 * both wired to the shared pipeline UI store handle created here so identity
 * follows the plugin fiber.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, 'zh-TW': zhTw, en }), 'ui-pipeline: dictionaries')

  const store = createPipelineUiStore()

  const api: PipelineApi = {
    list: () => ctx.remote.pipelines.list(),
    createFromTemplate: request => ctx.remote.pipelines.createFromTemplate(request),
    save: definition => ctx.remote.pipelines.save(definition),
    get: id => ctx.remote.pipelines.get(id),
    setEnabled: (id, enabled) => ctx.remote.pipelines.setEnabled(id, enabled),
    remove: id => ctx.remote.pipelines.delete(id),
    triggerNow: id => ctx.remote.pipelines.triggerNow(id),
    runs: id => ctx.remote.pipelines.runs(id),
  }

  ctx.slots.inject('sidebar.pipelines', () => ctx.slots.register({
    name: 'sidebar.pipelines',
    locale: NS,
    store,
    inject: actions => ({
      api,
      openEditor: (id: string) => { actions.open(id) },
    }),
  }, PipelinesNav))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'pipeline-editor',
    order: 20,
    locale: NS,
    store,
    inject: () => ({ api }),
  }, PipelineEditor))
}

/** The shared store's declared shape, re-exported for the slot type chain. */
export type PipelineUiStoreHandle = EngineStoreHandle<PipelineUiState, PipelineUiActions>
