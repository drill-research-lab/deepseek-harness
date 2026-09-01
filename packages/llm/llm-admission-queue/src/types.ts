/**
 * Shared type surface for the admission queue, including the
 * `ctx.llmAdmissionQueue` service the transport and RPC layers consume. This
 * subpath is runtime-free so a browser-side or remote renderer can import the
 * view shapes without loading the queue implementation.
 *
 * @module @deepseek-ai/dsh-llm-admission-queue/types
 */

import type { SessionId } from '@deepseek-ai/dsh-session'
import type { QueueId } from './brand.ts'

export type { QueueId } from './brand.ts'

/** Lifecycle of one queued request: still waiting for a slot, or holding one. */
export type QueueEntryState = 'waiting' | 'running'

/** Detached, mutation-free view of one queue entry. Never carries a signal or promise. */
export interface QueueEntrySnapshot {
  /** Opaque identity of this queued request. */
  readonly queueId: QueueId
  /** Session that issued the request, when the call carried one. */
  readonly sessionId?: SessionId
  /** `Date.now()` at enqueue time. */
  readonly enqueuedAt: number
  /** Whether this entry is still waiting or already admitted. */
  readonly state: QueueEntryState
  /** 1-based position among waiting entries; `0` once the entry is running. */
  readonly position: number
}

/** One position-or-state transition published to {@link LlmAdmissionQueueService.onChange} observers. */
export interface PositionChange {
  readonly queueId: QueueId
  readonly sessionId?: SessionId
  /** New 1-based waiting position, or `0` when the entry has just been admitted. */
  readonly position: number
  readonly state: QueueEntryState
}

/** One admin reorder action, written to the deployment's queue-admin audit log. */
export interface QueueAuditRecord {
  readonly action: 'reorder'
  /** The authenticated admin who performed the action; supplied by the caller. */
  readonly operator: { readonly userId: string; readonly username: string }
  /** The full waiting order the admin set, front to back. */
  readonly order: readonly string[]
}

/** One appended audit line: an {@link QueueAuditRecord} stamped with its write time. */
export type QueueAuditLine = QueueAuditRecord & { readonly ts: number }

/**
 * `ctx.llmAdmissionQueue`: the in-process admission queue's read and control
 * surface for the transport and RPC layers. `enqueue` and `release` are not
 * exposed here — the `llm/stream` listener owns the admission lifecycle.
 */
export interface LlmAdmissionQueueService {
  /**
   * Current position of one session's front-most entry.
   * @param sessionId - session to look up.
   * @returns the entry's position and state, or `undefined` when the session has none.
   */
  positionFor(sessionId: SessionId): { position: number; state: QueueEntryState } | undefined
  /**
   * Set the explicit front-to-back order of still-waiting entries. Ids that are
   * unknown or no longer waiting are ignored; waiting entries the list omits
   * keep FIFO order behind the ones it names. Never preempts a running request
   * and never adds a slot.
   * @param orderedQueueIds - the desired waiting order, front first.
   */
  reorder(orderedQueueIds: readonly string[]): void
  /** Detached snapshot of every entry: manually-ordered then FIFO waiting first, then running. */
  listAll(): QueueEntrySnapshot[]
  /**
   * Observe position and state transitions.
   * @param cb - invoked once per changed entry.
   * @returns a disposer that removes the observer.
   */
  onChange(cb: (change: PositionChange) => void): () => void
  /**
   * Record one admin reorder action to the deployment audit log. The caller
   * supplies `operator`; this package owns only the durable write.
   * @param record - the action to append.
   */
  audit(record: QueueAuditRecord): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    llmAdmissionQueue: LlmAdmissionQueueService
  }
}
