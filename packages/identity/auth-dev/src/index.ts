/**
 * Local-development authentication provider (`ctx.auth`). Trusts every request
 * as one fixed local user so a developer can exercise the Web UI without
 * standing up the external identity-cookie gateway. NEVER mount this in a
 * production composition — it grants unauthenticated access.
 * @module @deepseek-ai/dsh-auth-dev
 */

import type { IncomingMessage } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import { AuthService, authenticatedUserId, type AuthenticatedUser } from '@deepseek-ai/dsh-auth'

export type { AuthenticatedUser } from '@deepseek-ai/dsh-auth'

declare module '@deepseek-ai/cordis' {
  interface Context {
    auth: AuthService
  }
}

/**
 * A dev-only {@link AuthService}. `authenticateRequest` always returns the one
 * configured/loopback user, so every browser session is treated as that user.
 */
export class DevAuthService extends AuthService {
  private readonly user: AuthenticatedUser

  /**
   * @param ctx - Host context.
   * @param config - Optional display username for the fixed local user.
   */
  constructor(ctx: Context, config: { readonly username?: string } = {}) {
    super(ctx)
    this.user = { userId: authenticatedUserId('local:dev'), username: config.username ?? 'local' }
  }

  authenticateRequest(_request: Pick<IncomingMessage, 'headers'>): Promise<AuthenticatedUser> {
    return Promise.resolve(this.user)
  }
}

export default DevAuthService
