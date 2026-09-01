/**
 * queue domain zod schemas (names derived from map keys: queueListRequestSchema /
 * queueListValueSchema / queueReorderRequestSchema / queueReorderValueSchema).
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import type { QueueEntryView } from './queue.ts'

/** One admission-queue entry row of queue.list. */
export const queueEntryViewSchema = z.object({
  queueId: z.string().min(1),
  position: z.number().int().nonnegative(),
  state: z.union([z.literal('waiting'), z.literal('running')]),
  enqueuedAt: z.number().int().nonnegative(),
  sessionId: z.string().min(1).optional(),
  ownerUsername: z.string().min(1).optional(),
}) satisfies z.ZodType<Wire<QueueEntryView>>

/** queue.list request payload. */
export const queueListRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'queue.list'>>>

/** queue.list response value. */
export const queueListValueSchema = z.object({
  entries: z.array(queueEntryViewSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'queue.list'>>>

/** queue.reorder request payload. */
export const queueReorderRequestSchema = z.object({
  orderedQueueIds: z.array(z.string().min(1)),
}) satisfies z.ZodType<Wire<RequestPayload<'queue.reorder'>>>

/** queue.reorder response value (empty acknowledgement). */
export const queueReorderValueSchema = z.object({}) satisfies z.ZodType<Wire<ResponseValue<'queue.reorder'>>>
