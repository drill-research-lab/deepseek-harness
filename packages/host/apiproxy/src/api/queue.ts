/**
 * queue domain contract: admin-only visibility and manual ordering of the
 * in-process LLM admission queue (`ctx.llmAdmissionQueue`). Both methods
 * enforce the admin identity inside the operation, before any queue access.
 * api/ has zero Node dependencies and is importable from the browser.
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/**
 * Wire view of one admission-queue entry. Branded ids are widened to `string`
 * and no signal/promise state is exposed.
 */
export interface QueueEntryView {
  /** Opaque per-request queue id (the `reorder` target). */
  queueId: string
  /** 1-based position among waiting entries; `0` once the entry is running. */
  position: number
  state: 'waiting' | 'running'
  /** `Date.now()` at enqueue time. */
  enqueuedAt: number
  /** Session that issued the request, when the call carried one. */
  sessionId?: string
  /**
   * Login name of the session's owner, resolved from the session header
   * (`ldap:` login for LDAP, the registration name for a local account).
   * Absent for a call with no session or a session written before the name
   * was captured. Identity only — never conversation content.
   */
  ownerUsername?: string
}

/** queue-domain unary methods (the map keys `queue.*` of RpcMethodMap). */
export interface QueueApi {
  /**
   * Snapshot of every admission-queue entry: the admin-set waiting order (then
   * FIFO for the rest) first, then running. Admin only.
   */
  list(request: RpcRequest<{}>): Promise<RpcResponse<{ entries: QueueEntryView[] }>>
  /**
   * Set the explicit front-to-back order of the still-waiting entries. Ids that
   * are unknown or no longer waiting are ignored; waiting entries the list
   * omits keep FIFO order behind the named ones. Admin only.
   */
  reorder(request: RpcRequest<{ orderedQueueIds: string[] }>): Promise<RpcResponse<{}>>
}
