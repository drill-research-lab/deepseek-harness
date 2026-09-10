/**
 * `AdmissionQueue`: a single in-memory FIFO admission structure with a
 * concurrency ceiling, admin priority, and position-change notifications. It
 * owns no I/O — the audit sink is injected — and assumes one instance per
 * process (one vLLM backend per DSH web process).
 *
 * @module @deepseek-ai/dsh-llm-admission-queue/queue
 */

import { randomUUID } from 'node:crypto'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { QueueId } from './brand.ts'
import type {
  PositionChange,
  QueueAuditLine,
  QueueAuditRecord,
  QueueEntrySnapshot,
  QueueEntryState,
} from './types.ts'

/** One tracked request. The last four fields are internal book-keeping, never surfaced. */
interface Entry {
  readonly queueId: QueueId
  readonly sessionId?: SessionId
  readonly enqueuedAt: number
  /** Monotonic tiebreaker so entries enqueued in the same millisecond keep FIFO order. */
  readonly seq: number
  state: QueueEntryState
  /** Resolves the caller's `admitted` promise when a slot is granted. */
  readonly resolve: () => void
  /** Rejects the caller's `admitted` promise when the wait is abandoned. */
  readonly reject: (error: Error) => void
  readonly signal: AbortSignal
  abortHandler?: () => void
  /** Last position published to observers; `undefined` before the first publish. */
  notifiedPosition?: number
  notifiedState?: QueueEntryState
}

/** What {@link AdmissionQueue.enqueue} hands back to the `llm/stream` listener. */
export interface Admission {
  readonly queueId: QueueId
  /** 1-based waiting position at enqueue time; `0` when admitted immediately. */
  readonly position: number
  /** Settles when a slot is granted; rejects if the request is aborted or the queue drains. */
  readonly admitted: Promise<void>
}

/** Meta the `llm/stream` listener passes for each gated call. */
export interface EnqueueMeta {
  readonly sessionId?: SessionId
  readonly signal: AbortSignal
}

/** Fire-and-forget audit writer supplied by the plugin; the queue never touches the filesystem. */
export type AuditSink = (line: QueueAuditLine) => void

/**
 * FIFO admission control with a live concurrency ceiling.
 *
 * `limit` is the maximum number of concurrently admitted ("running") entries.
 * `0` disables the ceiling: every call is admitted immediately, still counted
 * but never blocked. Lowering `limit` never preempts running work — admission
 * simply pauses until `running` falls back below the new ceiling.
 */
export class AdmissionQueue {
  private readonly entries = new Map<QueueId, Entry>()
  /** Insertion order; never reordered. Sorting happens only inside {@link waitingView}. */
  private order: QueueId[] = []
  /** Admin-set front-to-back order of waiting entries; the rest keep FIFO behind these. */
  private manualOrder: QueueId[] = []
  private running = 0
  private seqCounter = 0
  private readonly listeners = new Set<(change: PositionChange) => void>()

  /**
   * @param limit - initial concurrency ceiling; `0` means unlimited.
   * @param auditSink - durable audit writer; defaults to a no-op for tests that do not assert audit.
   */
  constructor(
    private limit: number,
    private readonly auditSink: AuditSink = () => {},
  ) {
    this.assertLimit(limit)
  }

  private assertLimit(n: number): void {
    if (!Number.isInteger(n) || n < 0) {
      throw new Error(`llm-admission-queue: limit must be a non-negative integer, got ${String(n)}`)
    }
  }

  private effectiveLimit(): number {
    return this.limit === 0 ? Number.POSITIVE_INFINITY : this.limit
  }

  private abortError(signal: AbortSignal): Error {
    const reason: unknown = signal.reason
    return reason instanceof Error
      ? reason
      : new Error('llm-admission-queue: request aborted while queued', { cause: reason })
  }

  /**
   * Reserve a slot, or join the wait line.
   * @param meta - session identity (when present) and the request's abort signal.
   * @returns the queue id, the enqueue-time position, and a promise that settles on admission.
   */
  enqueue(meta: EnqueueMeta): Admission {
    const queueId = QueueId(randomUUID())
    const gate = Promise.withResolvers<void>()

    if (meta.signal.aborted) {
      // Already cancelled: never joins the queue, and the caller's `await
      // admitted` throws at once so `next()` is never reached.
      gate.reject(this.abortError(meta.signal))
      return { queueId, position: 0, admitted: gate.promise }
    }

    const entry: Entry = {
      queueId,
      ...meta.sessionId === undefined ? {} : { sessionId: meta.sessionId },
      enqueuedAt: Date.now(),
      seq: this.seqCounter++,
      state: 'waiting',
      resolve: gate.resolve,
      reject: gate.reject,
      signal: meta.signal,
    }
    this.entries.set(queueId, entry)
    this.order.push(queueId)

    const abortHandler = (): void => {
      const live = this.entries.get(queueId)
      // A running entry releases through the listener's `finally`, the single
      // owner of the `running` counter; only a still-waiting entry is
      // withdrawn here.
      if (live === undefined || live.state !== 'waiting') return
      this.remove(queueId)
      live.reject(this.abortError(meta.signal))
      this.recompute()
    }
    entry.abortHandler = abortHandler
    meta.signal.addEventListener('abort', abortHandler, { once: true })

    let position: number
    if (this.running < this.effectiveLimit()) {
      entry.state = 'running'
      this.running += 1
      entry.resolve()
      position = 0
    } else {
      position = this.waitingView().findIndex(candidate => candidate.queueId === queueId) + 1
    }
    this.recompute()
    return { queueId, position, admitted: gate.promise }
  }

  /**
   * Release the slot (or wait entry) for `queueId` and admit the next waiter.
   * Safe to call for an id already withdrawn by an abort.
   * @param queueId - the entry to release.
   */
  release(queueId: QueueId): void {
    const entry = this.entries.get(queueId)
    if (entry === undefined) return
    this.remove(queueId)
    if (entry.state === 'running') this.running -= 1
    this.pump()
    this.recompute()
  }

  /**
   * Set the explicit front-to-back order of still-waiting entries. Ids that are
   * unknown or no longer waiting are dropped; waiting entries the list omits
   * keep FIFO order behind the named ones.
   * @param orderedQueueIds - the desired waiting order, front first.
   */
  reorder(orderedQueueIds: readonly string[]): void {
    const seen = new Set<QueueId>()
    const next: QueueId[] = []
    for (const raw of orderedQueueIds) {
      const id = raw as QueueId
      if (seen.has(id)) continue
      const entry = this.entries.get(id)
      if (entry === undefined || entry.state !== 'waiting') continue
      seen.add(id)
      next.push(id)
    }
    this.manualOrder = next
    this.recompute()
  }

  /**
   * Position of one session's front-most entry.
   * @param sessionId - session to look up.
   * @returns position and state, or `undefined` when the session has no entry.
   */
  positionFor(sessionId: SessionId): { position: number; state: QueueEntryState } | undefined {
    const hit = this.listAll().find(snapshot => snapshot.sessionId === sessionId)
    return hit === undefined ? undefined : { position: hit.position, state: hit.state }
  }

  /** Detached snapshot of every entry: manually-ordered then FIFO waiting first, then running in insertion order. */
  listAll(): QueueEntrySnapshot[] {
    const waiting = this.waitingView().map((entry, index) => this.snapshot(entry, index + 1))
    const running = this.order
      .map(id => this.entries.get(id))
      .filter((entry): entry is Entry => entry !== undefined && entry.state === 'running')
      .map(entry => this.snapshot(entry, 0))
    return [...waiting, ...running]
  }

  /**
   * Observe position and state transitions.
   * @param cb - invoked once per changed entry.
   * @returns a disposer that removes the observer.
   */
  onChange(cb: (change: PositionChange) => void): () => void {
    this.listeners.add(cb)
    return () => { this.listeners.delete(cb) }
  }

  /**
   * Change the concurrency ceiling. Raising it admits waiters immediately;
   * lowering it never interrupts running work.
   * @param n - new ceiling; `0` means unlimited.
   */
  setLimit(n: number): void {
    this.assertLimit(n)
    this.limit = n
    this.pump()
    this.recompute()
  }

  /**
   * Reject and drop every waiting entry. Running entries keep their slots and
   * self-clean through their own {@link release}; observers are cleared.
   * @param reason - message for the rejection each abandoned waiter receives.
   */
  drain(reason: string): void {
    for (const entry of [...this.entries.values()]) {
      if (entry.state !== 'waiting') continue
      this.remove(entry.queueId)
      entry.reject(new Error(reason))
    }
    this.manualOrder = []
    this.listeners.clear()
  }

  /**
   * Append one admin priority action to the audit log via the injected sink,
   * stamping it with the current time.
   * @param record - the action; `operator` is the caller's responsibility.
   */
  audit(record: QueueAuditRecord): void {
    this.auditSink({ ts: Date.now(), ...record })
  }

  /** Delete an entry from every structure and detach its abort listener. */
  private remove(queueId: QueueId): void {
    const entry = this.entries.get(queueId)
    if (entry?.abortHandler !== undefined) entry.signal.removeEventListener('abort', entry.abortHandler)
    this.entries.delete(queueId)
    this.order = this.order.filter(id => id !== queueId)
    this.manualOrder = this.manualOrder.filter(id => id !== queueId)
  }

  /**
   * Waiting entries, front to back: entries the admin placed in {@link manualOrder}
   * first (in that order), then the rest by FIFO (enqueue time, then insertion seq).
   */
  private waitingView(): Entry[] {
    const rank = new Map(this.manualOrder.map((id, index) => [id, index] as const))
    return this.order
      .map(id => this.entries.get(id))
      .filter((entry): entry is Entry => entry !== undefined && entry.state === 'waiting')
      .sort((a, b) => {
        const ra = rank.get(a.queueId)
        const rb = rank.get(b.queueId)
        if (ra !== undefined && rb !== undefined) return ra - rb
        if (ra !== undefined) return -1
        if (rb !== undefined) return 1
        return a.enqueuedAt - b.enqueuedAt || a.seq - b.seq
      })
  }

  /** Admit waiters from the head of the sorted wait line until the ceiling is reached. */
  private pump(): void {
    const limit = this.effectiveLimit()
    while (this.running < limit) {
      const next = this.waitingView()[0]
      if (next === undefined) break
      next.state = 'running'
      this.running += 1
      next.resolve()
    }
  }

  /** Republish positions for every waiting entry that moved, and one 'running' notice per admitted entry. */
  private recompute(): void {
    this.waitingView().forEach((entry, index) => {
      const position = index + 1
      if (entry.notifiedState === 'waiting' && entry.notifiedPosition === position) return
      entry.notifiedState = 'waiting'
      entry.notifiedPosition = position
      this.notify({ queueId: entry.queueId, ...this.sessionField(entry), position, state: 'waiting' })
    })
    for (const entry of this.entries.values()) {
      if (entry.state !== 'running' || entry.notifiedState === 'running') continue
      entry.notifiedState = 'running'
      entry.notifiedPosition = 0
      this.notify({ queueId: entry.queueId, ...this.sessionField(entry), position: 0, state: 'running' })
    }
  }

  private notify(change: PositionChange): void {
    for (const cb of [...this.listeners]) {
      try {
        cb(change)
      } catch {
        // A position-change observer threw. The queue does not own its
        // failure and must keep admitting requests, so the throw is contained
        // here and the remaining observers still receive the change.
      }
    }
  }

  private snapshot(entry: Entry, position: number): QueueEntrySnapshot {
    return {
      queueId: entry.queueId,
      ...this.sessionField(entry),
      enqueuedAt: entry.enqueuedAt,
      state: entry.state,
      position,
    }
  }

  private sessionField(entry: Entry): { sessionId?: SessionId } {
    return entry.sessionId === undefined ? {} : { sessionId: entry.sessionId }
  }
}
