/**
 * Pipeline surface contracts: the store handle, the inject faces, and the
 * composed component props for the sidebar navigation block and the
 * full-window editor overlay. Owner shares carry only the facts the owner
 * owns (sidebar column state); pipelines data and mutations arrive through
 * this package's inject face over the generated pipelines Remote API.
 */
import type { PropsLocale, PropsStore, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { PipelineSummary, WorkflowJson } from '@deepseek-ai/dsh-pipeline/types'
import type { PipelineRunRecord, TriggerNowResult } from '@deepseek-ai/dsh-pipeline-local/types'
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'

/** Shared viewing state: which pipeline (if any) the overlay editor shows. */
export interface PipelineUiState {
  /** The open pipeline's id, or `null` when the editor is closed. */
  openId: string | null
}

/** Declared action shape of the pipeline UI store. */
export type PipelineUiActions = {
  open: (draft: PipelineUiState, id: string) => void
  close: (draft: PipelineUiState) => void
}

/**
 * Declares the root-scoped pipeline UI state and write surface.
 * @returns the store handle.
 */
export function createPipelineUiStore(): EngineStoreHandle<PipelineUiState, PipelineUiActions> {
  return defineStore({
    init: (): PipelineUiState => ({ openId: null }),
    actions: {
      open: (d, id: string) => { d.openId = id },
      close: (d) => { d.openId = null },
    },
  })
}

/** The pipelines wire verbs the surface needs, over the generated Remote API. */
export interface PipelineApi {
  /** List every pipeline's projection with live run status. */
  list: () => Promise<RemoteResult<readonly PipelineSummary[]>>
  /** Read one definition. */
  get: (id: string) => Promise<RemoteResult<WorkflowJson | undefined>>
  /** Pause (`false`) or resume (`true`) one pipeline's scheduled triggers. */
  setEnabled: (id: string, enabled: boolean) => Promise<RemoteResult<boolean>>
  /** Delete one pipeline and its runs. */
  remove: (id: string) => Promise<RemoteResult<boolean>>
  /** Start a manual run and wait for it to settle. */
  triggerNow: (id: string) => Promise<RemoteResult<TriggerNowResult>>
  /** List one pipeline's settled runs, oldest first. */
  runs: (id: string) => Promise<RemoteResult<readonly PipelineRunRecord[]>>
}

/**
 * Inject face of the sidebar navigation block: the wire verbs plus the
 * editor-opening callback (the store is the shared channel, but opening
 * from the nav keeps the call site one arrow).
 */
export interface PipelineNavInjected {
  /** The wire verbs. */
  api: PipelineApi
  /** Open the full-window editor for one pipeline. */
  openEditor: (id: string) => void
}

/**
 * Full props of the sidebar navigation block: runtime share, the store
 * (selection lives across remounts), the inject face, and copy.
 */
export type PipelinesNavProps =
  PropsRuntime<'sidebar.pipelines'>
  & PropsStore<EngineStoreHandle<PipelineUiState, PipelineUiActions>>
  & PipelineNavInjected
  & PropsLocale<'pipeline'>

/** Inject face of the editor overlay: the wire verbs. */
export interface PipelineEditorInjected {
  /** The wire verbs. */
  api: PipelineApi
}

/**
 * Full props of the full-window editor overlay: runtime share, the shared
 * store (the open pipeline id), the inject face, and copy.
 */
export type PipelineEditorProps =
  PropsRuntime<'shell.overlay'>
  & PropsStore<EngineStoreHandle<PipelineUiState, PipelineUiActions>>
  & PipelineEditorInjected
  & PropsLocale<'pipeline'>
