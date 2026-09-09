/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-llm-admission-queue`.
 * @module @deepseek-ai/dsh-llm-admission-queue/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-llm-admission-queue'

/** Cordis companion plugin name. */
export const name = 'llm-admission-queue-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the queue is process-local scheduling state and
 * appends no session event. Its `admitted`/`release` accounting is covered by
 * the package's own tests; there is no durable event/data relation to assert.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
