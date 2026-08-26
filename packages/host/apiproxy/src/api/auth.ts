/** Authentication-domain unary methods. */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Authenticated identity exposed to the current browser. */
export interface CurrentUserView {
  /** Stable provider-qualified identity used for ownership. */
  userId: string
  /** Display name verified by the authentication gateway. */
  username: string
}

/** Authentication-domain unary methods. */
export interface AuthApi {
  /** Return the identity carried by the authenticated request scope. */
  me(request: RpcRequest<{}>): Promise<RpcResponse<CurrentUserView>>
}
