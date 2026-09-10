/** Package-owned invariant companion. @module @deepseek-ai/dsh-library/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-library'

/** Cordis companion plugin name. */
export const name = 'library-invariant'
/** Services required before the companion can reserve and check package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the librarian service is the domain's only writer, the
 * zod schemas validate every record on reopen, and conversion settles each
 * resource inside the one ingest call, so no cross-owner relationship exists
 * to cross-check.
 */
const install: InvariantInstaller = Object.assign(() => {}, { inject: ['librarian'] })

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
