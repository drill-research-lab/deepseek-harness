import { isAbsolute, join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type { AuthenticatedUserId } from '@deepseek-ai/dsh-auth'
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Origin of a server-trusted ownership decision. */
export type OwnerPrincipalSource = 'request' | 'background'

/** Server-trusted identity used to authorize owner-scoped persistence. */
export interface OwnerPrincipal {
  readonly userId: AuthenticatedUserId
  readonly source: OwnerPrincipalSource
}

/** Validated host path rooted in one owner's persistence namespace. */
export type UserHomePath = Branded<'UserHomePath'>

/** Minimal durable identity stored at the root of each user home. */
export interface UserHomeIdentity {
  readonly schemaVersion: 1
  readonly userId: AuthenticatedUserId
  readonly createdAt: string
  readonly updatedAt: string
}

/**
 * Opaque owner-scoped filesystem namespace. Paths can only be derived from
 * validated relative segments; the host root is never reconstructed from
 * mutable identity metadata.
 */
export class UserHome {
  /** @internal The file provider is the only constructor. */
  constructor(
    readonly owner: OwnerPrincipal,
    readonly identity: UserHomeIdentity,
    private readonly root: string,
  ) {}

  /**
   * Resolve validated path segments beneath this user home.
   * @param segments - Individual relative path components, never paths.
   * @returns A path rooted in this user home.
   */
  path(...segments: readonly string[]): UserHomePath {
    for (const segment of segments) validateUserHomePathSegment(segment)
    return join(this.root, ...segments) as UserHomePath
  }
}

/**
 * Reject path syntax that could escape or reinterpret a rooted namespace.
 * This lexical validation does not claim symlink or TOCTOU protection.
 * @param segment - One candidate path component.
 */
export function validateUserHomePathSegment(segment: string): void {
  if (segment.length === 0 || segment === '.' || segment === '..') {
    throw new TypeError('user-home path segment must name one child')
  }
  if (segment.includes('\0')) throw new TypeError('user-home path segment must not contain NUL')
  if (isAbsolute(segment) || segment.includes('/') || segment.includes('\\')) {
    throw new TypeError('user-home path segment must not contain a path separator')
  }
}

/** Trusted principal and per-owner home resolver. */
export abstract class OwnershipService extends Service {
  constructor(ctx: Context) { super(ctx, 'ownership') }

  /**
   * Read the principal for the verified authenticated request scope.
   * @returns The current request principal.
   * @throws when called outside an authenticated request scope.
   */
  abstract currentPrincipal(): OwnerPrincipal

  /**
   * Read the verified request principal when execution is inside an authenticated scope.
   * @returns The current request principal, or `undefined` outside a request.
   */
  abstract currentPrincipalOrUndefined(): OwnerPrincipal | undefined

  /**
   * Rehydrate a principal from a durable, server-trusted owner id.
   * @param userId - Branded owner id previously read from trusted persistence.
   * @returns A background principal.
   */
  abstract backgroundPrincipal(userId: AuthenticatedUserId): OwnerPrincipal

  /**
   * Open or create the filesystem namespace for a trusted principal.
   * @param principal - Server-trusted owner identity.
   * @returns A validated owner-scoped home.
   */
  abstract resolveUserHome(principal: OwnerPrincipal): Promise<UserHome>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    ownership: OwnershipService
  }
}

export default OwnershipService
