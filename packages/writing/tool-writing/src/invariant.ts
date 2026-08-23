/** Package-owned invariant companion. @module @deepseek-ai/dsh-tool-writing/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-writing'

/** Cordis companion plugin name. */
export const name = 'tool-writing-invariant'
/** Services required before the companion can reserve and check package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the writing tools funnel every read and write through
 * the report registry (`ctx.reports`), and the compile result is a snapshot of
 * the compile service's diagnostics; the session-log model-visible rule is the
 * tool registry's own, not a cross-service relationship to assert here.
 */
const install: InvariantInstaller = Object.assign(() => {}, { inject: ['tools'] })

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
