/** Package-owned invariant companion. @module @deepseek-ai/dsh-writing/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-writing'

/** Cordis companion plugin name. */
export const name = 'writing-invariant'
/** Services required before the companion can reserve and check package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the private typed writer owns current report and
 * version mutations, the domain schema validates records and versions on
 * reopen, and each table is a closed two-writer table with no second truth.
 */
const install: InvariantInstaller = Object.assign(() => {}, { inject: ['reports'] })

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
