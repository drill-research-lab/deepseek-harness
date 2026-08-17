import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
export const name = 'auth-gateway-ldap-invariant'
export const inject = ['invariants']
/** No runtime invariant: route lifecycle belongs to webserver and LDAP results are checked per operation. */
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-auth-gateway-ldap', install))
