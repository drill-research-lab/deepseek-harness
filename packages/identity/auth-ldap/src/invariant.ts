import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
export const name = 'auth-ldap-invariant'
export const inject = ['invariants']
/** No runtime invariant: LDAP is an external system and each operation validates its complete response. */
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-auth-ldap', install))
