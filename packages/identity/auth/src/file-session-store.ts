import { createHash, randomBytes } from 'node:crypto'
import { chmod, mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { authenticatedUserId, type AuthenticatedUser } from './index.ts'

interface StoredSession {
  v: 1
  userId: string
  username: string
  expiresAt: number
}

function sessionName(token: string): string {
  return `${createHash('sha256').update(token).digest('hex')}.json`
}

/** Owner-only, one-file-per-session storage shared by the gateway and host authentication boundary. */
export class FileSessionStore {
  /** Absolute owner-controlled directory containing hashed session records. */
  readonly directory: string

  constructor(directory: string) {
    this.directory = resolve(directory)
  }

  /**
   * Create a revocable file session.
   * @param user - Authenticated identity bound to the new session.
   * @param expiresAt - Absolute Unix expiry in seconds.
   * @returns The random session id carried by the signed cookie.
   */
  async create(user: AuthenticatedUser, expiresAt: number): Promise<string> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    await chmod(this.directory, 0o700)
    const token = randomBytes(32).toString('base64url')
    const target = join(this.directory, sessionName(token))
    const temporary = join(this.directory, `.${sessionName(token)}.${randomBytes(8).toString('hex')}.tmp`)
    const handle = await open(temporary, 'wx', 0o600)
    try {
      const record: StoredSession = { v: 1, userId: user.userId, username: user.username, expiresAt }
      await handle.writeFile(`${JSON.stringify(record)}\n`, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, target)
    return token
  }

  /**
   * Resolve a live session id, deleting expired records on access.
   * @param token - Random session id recovered from a verified cookie.
   * @param now - Unix time used for expiry comparison.
   * @returns The bound authenticated user, or undefined when absent, invalid, or expired.
   */
  async find(token: string, now = Math.floor(Date.now() / 1000)): Promise<AuthenticatedUser | undefined> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined
    const path = join(this.directory, sessionName(token))
    try {
      const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
      if (typeof parsed !== 'object' || parsed === null) return undefined
      const record = parsed as Partial<StoredSession>
      if (record.v !== 1 || typeof record.userId !== 'string' || record.userId.trim().length === 0
        || typeof record.username !== 'string' || record.username.trim().length === 0
        || typeof record.expiresAt !== 'number' || !Number.isInteger(record.expiresAt)) return undefined
      if (record.expiresAt <= now) {
        await unlink(path).catch(() => {})
        return undefined
      }
      return { userId: authenticatedUserId(record.userId), username: record.username }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      return undefined
    }
  }

  /**
   * Revoke a session id; deleting an already absent session is idempotent.
   * @param token - Random session id to revoke.
   */
  async delete(token: string): Promise<void> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return
    await unlink(join(this.directory, sessionName(token))).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    })
  }
}
