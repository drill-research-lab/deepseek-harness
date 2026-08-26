/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-drill-production`.
 * @module @deepseek-ai/dsh-drill-production/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-drill-production'

/** Cordis companion plugin name. */
export const name = 'drill-production-bundle-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

// No runtime invariant: the package is a static patch-list carrier (a YAML
// document of row overrides owned by other packages); it mounts no service,
// emits no events, and owns no mutable relation to check. The capability
// policy it configures is enforced and tested inside the packages it
// patches (`dsh-agent-presets`'s `approvedIds`, `dsh-permission-presets`'s
// preset table).
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
