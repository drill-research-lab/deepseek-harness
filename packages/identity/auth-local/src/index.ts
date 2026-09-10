import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { authenticatedUserId, type AuthenticatedUser } from '@deepseek-ai/dsh-auth'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

const FORMAT_VERSION = 1
const SCRYPT_KEY_BYTES = 32
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const

/** File-backed local-account configuration for the external gateway. */
export interface Config {
  /** Absolute or working-directory-relative owner-only account file. */
  path: string
  /** Minimum password length enforced before hashing a new account. */
  minPasswordLength?: number
}

export const Config: z<Config> = z.object({
  path: z.string().required(),
  minPasswordLength: z.natural().min(8).default(12),
})
export const name = 'auth-local'

/** Fields collected by the gateway when creating one local DSH account. */
export interface LocalAccountRegistration {
  /** Case-insensitive login name displayed in DSH. */
  readonly username: string
  /** Plaintext password retained only until its scrypt derivation completes. */
  readonly password: string
  /** Human-readable account name retained by the gateway. */
  readonly displayName: string
  /** Case-insensitive contact address retained by the gateway. */
  readonly email: string
}

interface StoredAccount {
  id: string
  username: string
  usernameKey: string
  displayName: string
  email: string
  emailKey: string
  salt: string
  passwordHash: string
}

interface AccountDocument { version: 1; accounts: StoredAccount[] }

/** Duplicate username or email reported without exposing password material. */
export class LocalAccountConflictError extends Error {}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

function normalized(value: string): string { return value.trim().toLocaleLowerCase('en-US') }

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    scrypt(password, salt, SCRYPT_KEY_BYTES, SCRYPT_OPTIONS, (error, key) => {
      if (error === null) resolvePromise(key)
      else reject(error)
    })
  })
}

function validateAccount(value: unknown): StoredAccount {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('auth-local: account entry must be an object')
  const entry = value as Record<string, unknown>
  for (const key of ['id', 'username', 'usernameKey', 'displayName', 'email', 'emailKey', 'salt', 'passwordHash']) {
    if (typeof entry[key] !== 'string' || entry[key].length === 0) throw new TypeError(`auth-local: account ${key} must be a non-empty string`)
  }
  return entry as unknown as StoredAccount
}

/** Owner-only account store used solely by the separately deployed authentication gateway. */
export class LocalAccountStore extends Service {
  private readonly filename: string
  private readonly minPasswordLength: number

  constructor(ctx: Context, config: Config) {
    super(ctx, 'localAccounts')
    this.filename = resolve(config.path)
    this.minPasswordLength = config.minPasswordLength ?? 12
  }

  private async read(): Promise<AccountDocument> {
    try {
      const metadata = await stat(this.filename)
      if (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0) {
        throw new Error(`auth-local: ${this.filename} must have mode 0600`)
      }
      const parsed: unknown = JSON.parse(await readFile(this.filename, 'utf8'))
      if (typeof parsed !== 'object' || parsed === null || (parsed as Record<string, unknown>).version !== FORMAT_VERSION
        || !Array.isArray((parsed as Record<string, unknown>).accounts)) {
        throw new TypeError(`auth-local: ${this.filename} has an unsupported account format`)
      }
      return { version: 1, accounts: (parsed as { accounts: unknown[] }).accounts.map(validateAccount) }
    } catch (error) {
      if (isMissing(error)) return { version: 1, accounts: [] }
      throw error
    }
  }

  /**
   * Verify one gateway-local username and password.
   * @param username - Login name collected by the gateway.
   * @param password - Password collected by the gateway and discarded after derivation.
   * @returns The stable local identity, or undefined when the credentials do not match.
   */
  async authenticate(username: string, password: string): Promise<AuthenticatedUser | undefined> {
    if (username.length === 0 || password.length === 0) return undefined
    const account = (await this.read()).accounts.find(candidate => candidate.usernameKey === normalized(username))
    if (account === undefined) return undefined
    const actual = await derive(password, Buffer.from(account.salt, 'base64url'))
    const expected = Buffer.from(account.passwordHash, 'base64url')
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return undefined
    // Gateway-local accounts never carry admin: there is no directory group to
    // read one from, and admin is a deliberate LDAP-only capability.
    return { userId: authenticatedUserId(`local:${account.id}`), username: account.username, isAdmin: false }
  }

  /**
   * Create one gateway-local account with an scrypt-derived password hash.
   * @param registration - Account fields collected only by the gateway.
   * @returns The new stable local identity after the owner-only file commits.
   */
  async create(registration: LocalAccountRegistration): Promise<AuthenticatedUser> {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(registration.username)) throw new TypeError('auth-local: username is invalid')
    if (registration.password.length < this.minPasswordLength) throw new TypeError('auth-local: password is too short')
    if (registration.displayName.trim().length === 0) throw new TypeError('auth-local: displayName is required')
    if (!registration.email.includes('@')) throw new TypeError('auth-local: email is invalid')
    await mkdir(dirname(this.filename), { recursive: true, mode: 0o700 })
    return withFileLock(this.filename, async () => {
      const document = await this.read()
      const usernameKey = normalized(registration.username)
      const emailKey = normalized(registration.email)
      if (document.accounts.some(account => account.usernameKey === usernameKey || account.emailKey === emailKey)) {
        throw new LocalAccountConflictError('auth-local: username or email already exists')
      }
      const salt = randomBytes(16)
      const passwordHash = await derive(registration.password, salt)
      const account: StoredAccount = {
        id: randomUUID(), username: registration.username, usernameKey,
        displayName: registration.displayName.trim(), email: registration.email.trim(), emailKey,
        salt: salt.toString('base64url'), passwordHash: passwordHash.toString('base64url'),
      }
      document.accounts.push(account)
      await writeFileAtomic(this.filename, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
      return { userId: authenticatedUserId(`local:${account.id}`), username: account.username, isAdmin: false }
    })
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    localAccounts: LocalAccountStore
  }
}

export default LocalAccountStore
