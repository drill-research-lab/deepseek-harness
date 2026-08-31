/** Polling controller for the authenticated inference metrics RPC. */

import type { IApiClient, InferenceMetricsView, RpcErrorCode } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** Dashboard render state. */
export type InferenceDashboardState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; metrics: InferenceMetricsView }
  | { status: 'error'; code: RpcErrorCode | 'transport'; message: string }

/** Browser-local lifecycle for one settings dashboard instance. */
export class InferenceDashboardController {
  /** Snapshot consumed by the settings section. */
  readonly store: SnapshotStore<InferenceDashboardState> = createSnapshotStore({ status: 'idle' })

  private active = false
  private generation = 0
  private timer: ReturnType<typeof setTimeout> | undefined

  /** @param api - authenticated LLM wire face. */
  constructor(private readonly api: Pick<IApiClient, 'llm'>) {}

  /** Start polling, loading immediately on the first active mount. */
  start(): void {
    if (this.active) return
    this.active = true
    void this.load()
  }

  /** Stop polling and invalidate an outstanding response. */
  stop(): void {
    this.active = false
    this.generation += 1
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  /** Retry after a visible failure. */
  retry(): void {
    if (this.active) void this.load()
  }

  /** Refresh the sample once and schedule the next successful scrape. */
  async load(): Promise<void> {
    const generation = ++this.generation
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    if (this.store.getSnapshot().status !== 'ready') this.store.set({ status: 'loading' })
    try {
      const response = await this.api.llm.metrics({})
      if (generation !== this.generation || !this.active) return
      if (!response.result.ok) {
        this.store.set({
          status: 'error',
          code: response.result.error.code,
          message: response.result.error.message,
        })
        return
      }
      const metrics = response.result.value
      this.store.set({ status: 'ready', metrics })
      this.timer = setTimeout(() => { void this.load() }, metrics.refreshAfterMs)
    } catch (error: unknown) {
      if (generation !== this.generation || !this.active) return
      this.store.set({
        status: 'error',
        code: 'transport',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /** Refresh only while the settings section owns the polling lifecycle. */
  refreshIfActive(): void {
    if (this.active) void this.load()
  }
}
