/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-writing`.
 * @module @deepseek-ai/dsh-client-ui-writing/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-writing'

/** Cordis companion plugin name. */
export const name = 'client-ui-writing-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the plugin is one `conversation.view` registration with
 * component-local state and a Remote-backed inject face; it owns no store, emits
 * no cordis events, and holds no cross-plugin mutable state, so its disposal is
 * proven by the HMR-safety spec.
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
