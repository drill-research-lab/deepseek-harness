/** Package-owned invariant companion. @module @deepseek-ai/dsh-auth-dev/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-auth-dev'

/** Cordis companion plugin name. */
export const name = 'auth-dev-invariant'
/** Services required before the companion can reserve and check package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this is a stateless dev-only AuthService with no
 * durable relationship to assert; the single-user trust decision is a property
 * of the composition, not a runtime fact to check.
 */
const install: InvariantInstaller = Object.assign(() => {}, { inject: ['auth'] })

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
