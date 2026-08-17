import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
export const name = 'host-authentication-invariant'
export const inject = ['invariants']
/** No runtime invariant: verification is stateless and request identity lives only in AsyncLocalStorage. */
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-host-authentication', install))
