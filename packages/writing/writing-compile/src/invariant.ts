/** Package-owned invariant companion. @module @deepseek-ai/dsh-writing-compile/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-writing-compile'

/** Cordis companion plugin name. */
export const name = 'writing-compile-invariant'
/** Services required before the companion can reserve and check package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the compile service performs short-lived subprocess
 * work through the shell seam, and the diagnostics parser is a pure function
 * pinned by unit tests; there is no cross-service durable relationship to assert.
 */
const install: InvariantInstaller = Object.assign(() => {}, { inject: ['latexCompile'] })

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
