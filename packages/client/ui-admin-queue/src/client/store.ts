/** Polling controller for the admin-only LLM admission-queue RPCs. */

import type { IApiClient, QueueEntryView, RpcErrorCode } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/**
 * Refresh cadence: `queue.list` carries no server-suggested interval (unlike
 * `llm.metrics`'s `refreshAfterMs`), so the page polls at a fixed interval
 * matching the inference dashboard's default. Polling is suspended for the
 * duration of a drag so an in-flight reorder is not overwritten by a stale
 * snapshot. Replacing this poll with a live push is deferred — see the
 * package README's Known Limitations.
 */
export const ADMIN_QUEUE_POLL_MS = 2_000

/** Admin queue page render state. */
export type AdminQueueState =
  | { status: 'checking-permission' }
  | { status: 'forbidden' }
  | { status: 'loading' }
  | { status: 'ready'; entries: readonly QueueEntryView[] }
  | { status: 'error'; code: RpcErrorCode | 'transport'; message: string }

/**
 * Browser-local lifecycle for one admin queue page instance: verifies the
 * caller's own admin standing (frontend UX only — `queue.list`/`queue.reorder`
 * independently enforce it server-side), polls the queue snapshot, and relays
 * the admin-set waiting order.
 */
export class AdminQueueController {
  /** Snapshot consumed by the admin queue page. */
  readonly store: SnapshotStore<AdminQueueState> = createSnapshotStore({ status: 'checking-permission' })

  private active = false
  private suspended = false
  private generation = 0
  private timer: ReturnType<typeof setTimeout> | undefined

  /** @param api - authenticated auth + queue wire face. */
  constructor(private readonly api: Pick<IApiClient, 'auth' | 'queue'>) {}

  /** Start polling: checks admin standing first, then begins the list poll. */
  start(): void {
    if (this.active) return
    this.active = true
    void this.checkPermissionThenLoad()
  }

  /** Stop polling and invalidate an outstanding response. */
  stop(): void {
    this.active = false
    this.suspended = false
    this.generation += 1
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  /** Retry after a visible failure (permission recheck, then the list). */
  retry(): void {
    if (this.active) void this.checkPermissionThenLoad()
  }

  /** Pause the poll while the admin is dragging a row so the snapshot cannot snap back. */
  suspend(): void {
    this.suspended = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  /** Resume polling after a drag, reconciling immediately with a fresh snapshot. */
  resume(): void {
    if (!this.suspended) return
    this.suspended = false
    if (this.active) void this.load()
  }

  /**
   * Push the admin-set front-to-back order of the waiting entries, then refresh.
   * @param orderedQueueIds - the desired waiting order, front first.
   */
  async reorder(orderedQueueIds: readonly string[]): Promise<void> {
    try {
      await this.api.queue.reorder({ orderedQueueIds: [...orderedQueueIds] })
    } finally {
      if (this.active) await this.load()
    }
  }

  /** Verify admin standing, then enter the poll loop only if it holds. */
  private async checkPermissionThenLoad(): Promise<void> {
    const generation = ++this.generation
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    this.store.set({ status: 'checking-permission' })
    try {
      const response = await this.api.auth.me({})
      if (generation !== this.generation || !this.active) return
      if (!response.result.ok) {
        this.store.set({ status: 'error', code: response.result.error.code, message: response.result.error.message })
        return
      }
      if (!response.result.value.isAdmin) {
        this.store.set({ status: 'forbidden' })
        return
      }
      await this.load(generation)
    } catch (error: unknown) {
      if (generation !== this.generation || !this.active) return
      this.store.set({
        status: 'error', code: 'transport', message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /** Refresh the queue snapshot once and schedule the next poll. Callers never invoke this while suspended. */
  private async load(generation = this.generation): Promise<void> {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    if (this.store.getSnapshot().status !== 'ready') this.store.set({ status: 'loading' })
    try {
      const response = await this.api.queue.list({})
      // `suspend()` may have fired during the await — a stale snapshot must not
      // overwrite the order the admin is dragging.
      if (generation !== this.generation || !this.active || this.suspended) return
      if (!response.result.ok) {
        this.store.set({ status: 'error', code: response.result.error.code, message: response.result.error.message })
        return
      }
      this.store.set({ status: 'ready', entries: response.result.value.entries })
      this.timer = setTimeout(() => { void this.load(generation) }, ADMIN_QUEUE_POLL_MS)
    } catch (error: unknown) {
      if (generation !== this.generation || !this.active) return
      this.store.set({
        status: 'error', code: 'transport', message: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
