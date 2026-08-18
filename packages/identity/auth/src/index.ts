import type { IncomingMessage } from 'node:http'
import { AsyncLocalStorage } from 'node:async_hooks'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable provider-qualified identity used for ownership and isolation. */
export type AuthenticatedUserId = Branded<'AuthenticatedUserId'>

/** Verified identity fields that DSH may consume after external authentication. */
export interface AuthenticatedUser {
  readonly userId: AuthenticatedUserId
  readonly username: string
}

/**
 * Validate and brand one external subject identifier.
 * @param value - Provider-qualified non-empty subject.
 * @returns The stable authenticated-user id.
 */
export function authenticatedUserId(value: string): AuthenticatedUserId {
  if (value.trim().length === 0) throw new TypeError('authenticated user id must not be empty')
  return value as AuthenticatedUserId
}

/** External-session verifier and AsyncLocalStorage-backed request identity scope. */
export abstract class AuthService extends Service {
  private readonly scope = new AsyncLocalStorage<AuthenticatedUser>()
  constructor(ctx: Context) { super(ctx, 'auth') }
  /**
   * Recover and verify the authenticated user carried by a request.
   * @param request - Request headers carrying the session cookie.
   * @returns The verified user, or undefined when no valid session is present.
   */
  abstract authenticateRequest(request: Pick<IncomingMessage, 'headers'>): Promise<AuthenticatedUser | undefined>
  /**
   * Read the current request identity.
   * @returns The user in the current authenticated asynchronous request scope, when present.
   */
  currentUser(): AuthenticatedUser | undefined { return this.scope.getStore() }
  /**
   * Run an operation inside an authenticated asynchronous scope.
   * @param user - Identity made available to downstream consumers.
   * @param operation - Work whose asynchronous continuations inherit the identity.
   * @returns The operation's result.
   */
  runAs<T>(user: AuthenticatedUser, operation: () => T): T { return this.scope.run(user, operation) }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    auth: AuthService
  }
}

export default AuthService
