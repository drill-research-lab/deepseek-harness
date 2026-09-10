/** Package-owned invariant companion. @module @deepseek-ai/dsh-library-api/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-library-api'

/** Cordis companion plugin name. */
export const name = 'library-api-invariant'
/** Services required before the companion can reserve and check package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the gateway is a stateless projection of the librarian
 * service — every response is computed from the librarian's authoritative
 * state per request, so there is no second copy to cross-check.
 */
const install: InvariantInstaller = Object.assign(() => {}, { inject: ['library'] })

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
