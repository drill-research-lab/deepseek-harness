import { createHash, randomBytes } from 'node:crypto'
import { chmod, link, lstat, mkdir, open, readFile, realpath, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { authenticatedUserId, type AuthenticatedUserId } from '@deepseek-ai/dsh-auth'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import {
  OwnershipService,
  OwnerRoot,
  UserHome,
  type OwnerPrincipal,
  type UserHomeIdentity,
} from '@deepseek-ai/dsh-ownership'

const USER_HOME_MODE = 0o700
const PRIVATE_FILE_MODE = 0o600
const IDENTITY_SCHEMA_VERSION = 1
const IDENTITY_FILENAME = 'identity.json'

/** File-backed ownership configuration. */
export interface Config {
  /**
   * Root containing hashed per-owner homes. An omitted or blank value uses
   * `resolveDshHome()/users`; the Web bundle maps `DSH_USERS_HOME` into this
   * field because this provider does not read that environment variable.
   */
  usersRoot?: string
  /**
   * Root containing hashed per-owner containment roots. An omitted or blank
   * value uses `resolveDshHome()/owner-roots`.
   */
  ownerRoots?: string
}

export const Config: z<Config> = z.object({
  usersRoot: z.string().default(''),
  ownerRoots: z.string().default(''),
})

/**
 * Resolve the deployment-owned users root.
 * @param configured - Explicit plugin configuration.
 * @returns An absolute users-root path.
 */
export function resolveUsersRoot(configured?: string): string {
  if (configured !== undefined && configured.trim().length > 0) return resolve(configured)
  return join(resolveDshHome(), 'users')
}

/**
 * Resolve the deployment-owned owner-roots root.
 * @param configured - Explicit plugin configuration.
 * @returns An absolute owner-roots path.
 */
export function resolveOwnerRoots(configured?: string): string {
  if (configured !== undefined && configured.trim().length > 0) return resolve(configured)
  return join(resolveDshHome(), 'owner-roots')
}

/**
 * Map a provider-qualified immutable user id to a fixed filesystem-safe key.
 * @param userId - Complete stable owner identity, including provider prefix.
 * @returns Lowercase SHA-256 hex.
 */
export function userHomeDirectoryKey(userId: AuthenticatedUserId): string {
  return createHash('sha256').update(userId, 'utf8').digest('hex')
}

function isCode(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === code
}

/**
 * Converge concurrent first opens of one per-owner directory through an
 * in-flight map: the first call opens, repeats await that same promise.
 * @param inFlight - The resolver's in-flight map.
 * @param key - The per-owner directory key.
 * @param open - The open operation to deduplicate.
 * @returns the shared open result.
 */
function convergeOpen<T>(inFlight: Map<string, Promise<T>>, key: string, open: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key)
  if (existing !== undefined) return existing
  const operation = open().finally(() => inFlight.delete(key))
  inFlight.set(key, operation)
  return operation
}

function parseIdentity(source: string, path: string): UserHomeIdentity {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch {
    throw new Error(`host-ownership-file: malformed identity metadata at ${path}`)
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`host-ownership-file: malformed identity metadata at ${path}`)
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  if (keys.join(',') !== 'createdAt,schemaVersion,updatedAt,userId'
    || record.schemaVersion !== IDENTITY_SCHEMA_VERSION
    || typeof record.userId !== 'string' || record.userId.trim().length === 0
    || typeof record.createdAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt))
    || typeof record.updatedAt !== 'string' || !Number.isFinite(Date.parse(record.updatedAt))) {
    throw new Error(`host-ownership-file: unsupported or malformed identity metadata at ${path}`)
  }
  return {
    schemaVersion: IDENTITY_SCHEMA_VERSION,
    userId: authenticatedUserId(record.userId),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

async function publishIdentity(path: string, identity: UserHomeIdentity): Promise<void> {
  const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`
  const handle = await open(temporary, 'wx', PRIVATE_FILE_MODE)
  try {
    await handle.writeFile(`${JSON.stringify(identity, null, 2)}\n`, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await link(temporary, path)
  } catch (error) {
    /* v8 ignore next -- requires an injected filesystem failure between a successful temp write and hard link */
    if (!isCode(error, 'EEXIST')) throw error
  } finally {
    await rm(temporary, { force: true })
  }
}

async function hardenDirectory(path: string): Promise<void> {
  const metadata = await lstat(path)
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error(`host-ownership-file: expected a real directory at ${path}`)
  }
  await chmod(path, USER_HOME_MODE)
}

async function hardenIdentity(path: string): Promise<void> {
  const metadata = await lstat(path)
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`host-ownership-file: expected a regular identity file at ${path}`)
  }
  await chmod(path, PRIVATE_FILE_MODE)
}

/** File-backed resolver that validates immutable identity before publishing a UserHome. */
export class FileUserHomeResolver {
  private readonly inFlight = new Map<string, Promise<UserHome>>()

  /** @param usersRoot - Trusted deployment root, never request input. */
  constructor(private readonly usersRoot: string) {}

  /**
   * Open or create one owner home, converging concurrent first opens.
   * @param principal - Server-trusted owner principal.
   * @returns A validated user home.
   */
  resolve(principal: OwnerPrincipal): Promise<UserHome> {
    const key = userHomeDirectoryKey(principal.userId)
    return convergeOpen(this.inFlight, key, () => this.open(principal, key))
  }

  private async open(principal: OwnerPrincipal, key: string): Promise<UserHome> {
    await mkdir(this.usersRoot, { recursive: true, mode: USER_HOME_MODE })
    await hardenDirectory(this.usersRoot)
    const homeRoot = join(this.usersRoot, key)
    await mkdir(homeRoot, { recursive: true, mode: USER_HOME_MODE })
    await hardenDirectory(homeRoot)
    const identityPath = join(homeRoot, IDENTITY_FILENAME)
    let source: string
    try {
      source = await readFile(identityPath, 'utf8')
    } catch (error) {
      if (!isCode(error, 'ENOENT')) throw error
      const timestamp = new Date().toISOString()
      await publishIdentity(identityPath, {
        schemaVersion: IDENTITY_SCHEMA_VERSION,
        userId: principal.userId,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      source = await readFile(identityPath, 'utf8')
    }
    await hardenIdentity(identityPath)
    const identity = parseIdentity(source, identityPath)
    if (identity.userId !== principal.userId) {
      throw new Error(`host-ownership-file: identity mismatch for user-home directory ${key}`)
    }
    return new UserHome(principal, identity, homeRoot)
  }
}

/**
 * File-backed resolver for the canonical per-owner containment root. The
 * owner identity is already guaranteed by `OwnerPrincipal`, so no identity
 * file validation is needed — the resolver only creates, hardens, and
 * canonicalizes the private directory.
 */
export class FileOwnerRootResolver {
  private readonly inFlight = new Map<string, Promise<OwnerRoot>>()

  /** @param ownerRoots - Trusted deployment root, never request input. */
  constructor(private readonly ownerRoots: string) {}

  /**
   * Open or create one owner root, converging concurrent first opens.
   * @param principal - Server-trusted owner principal.
   * @returns The canonical owner root.
   */
  resolve(principal: OwnerPrincipal): Promise<OwnerRoot> {
    const key = userHomeDirectoryKey(principal.userId)
    return convergeOpen(this.inFlight, key, () => this.open(principal, key))
  }

  private async open(principal: OwnerPrincipal, key: string): Promise<OwnerRoot> {
    await mkdir(this.ownerRoots, { recursive: true, mode: USER_HOME_MODE })
    await hardenDirectory(this.ownerRoots)
    const root = join(this.ownerRoots, key)
    await mkdir(root, { recursive: true, mode: USER_HOME_MODE })
    await hardenDirectory(root)
    return new OwnerRoot(principal, await realpath(root))
  }
}

/** Host provider for trusted principals and owner-scoped file homes. */
export class FileOwnershipService extends OwnershipService {
  static inject = ['auth']
  static Config = Config
  private readonly resolver: FileUserHomeResolver
  private readonly ownerRootResolver: FileOwnerRootResolver

  constructor(ctx: Context, config: Config = {}) {
    super(ctx)
    const usersRoot = resolveUsersRoot(config.usersRoot)
    this.resolver = new FileUserHomeResolver(usersRoot)
    this.ownerRootResolver = new FileOwnerRootResolver(resolveOwnerRoots(config.ownerRoots))
  }

  currentPrincipal(): OwnerPrincipal {
    const principal = this.currentPrincipalOrUndefined()
    if (principal === undefined) throw new Error('host-ownership-file: no authenticated request owner')
    return principal
  }

  currentPrincipalOrUndefined(): OwnerPrincipal | undefined {
    const user = this.ctx.auth.currentUser()
    return user === undefined ? undefined : { userId: user.userId, source: 'request' }
  }

  backgroundPrincipal(userId: AuthenticatedUserId): OwnerPrincipal {
    return { userId, source: 'background' }
  }

  resolveUserHome(principal: OwnerPrincipal): Promise<UserHome> {
    return this.resolver.resolve(principal)
  }

  resolveOwnerRoot(principal: OwnerPrincipal): Promise<OwnerRoot> {
    return this.ownerRootResolver.resolve(principal)
  }
}

export default FileOwnershipService
