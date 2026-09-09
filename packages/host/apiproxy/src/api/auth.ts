/** Authentication-domain unary methods. */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Authenticated identity exposed to the current browser. */
export interface CurrentUserView {
  /** Stable provider-qualified identity used for ownership. */
  userId: string
  /** Display name verified by the authentication gateway. */
  username: string
  /** Whether this user is in the deployment's admin group (login-time snapshot). */
  isAdmin: boolean
}

/** Authentication-domain unary methods. */
export interface AuthApi {
  /** Return the identity carried by the authenticated request scope. */
  me(request: RpcRequest<{}>): Promise<RpcResponse<CurrentUserView>>
}
