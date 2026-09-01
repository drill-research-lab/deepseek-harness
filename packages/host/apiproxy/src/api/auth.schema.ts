/** Authentication-domain zod schemas. */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'

/** auth.me request payload. */
export const authMeRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'auth.me'>>>

/** auth.me response value. */
export const authMeValueSchema = z.object({
  userId: z.string(),
  username: z.string(),
  isAdmin: z.boolean(),
}) satisfies z.ZodType<Wire<ResponseValue<'auth.me'>>>
