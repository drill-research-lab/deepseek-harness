import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque identity of one queued admission request, minted per {@link enqueue} call. */
export type QueueId = Branded<'QueueId'>

/**
 * Brand an implementation-minted queue identity.
 * @param id - opaque queue identity.
 * @returns the same string, branded; no validation is performed.
 */
export function QueueId(id: string): QueueId {
  return id as QueueId
}
