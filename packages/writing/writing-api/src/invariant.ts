/** Package-owned invariant companion. @module @deepseek-ai/dsh-writing-api/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-writing-api'

/** Cordis companion plugin name. */
export const name = 'writing-api-invariant'
/** Services required before the companion can reserve and check package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the gateway is a projection over the report registry
 * and compile service, and the PDF route answers one stateless read; no
 * cross-service durable relationship is owned here.
 */
const install: InvariantInstaller = Object.assign(() => {}, { inject: ['writing'] })

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
