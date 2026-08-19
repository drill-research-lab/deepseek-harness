import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
export const name = 'host-ownership-file-invariant'
export const inject = ['invariants']
/** No runtime invariant: identity consistency is validated before each UserHome is published. */
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-host-ownership-file', install))
