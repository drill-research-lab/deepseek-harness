import { createPublicKey, verify, type KeyObject } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { AuthService, authenticatedUserId, type AuthenticatedUser } from '@deepseek-ai/dsh-auth'
import { FileSessionStore } from '@deepseek-ai/dsh-auth/file-session-store'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-host-webserver'

/** External identity-cookie verification configuration. */
export interface Config {
  /** Credential reference containing the gateway's Ed25519 PEM public key. */
  publicKeyRef?: string
  /** Credential reference containing the exact accepted token issuer. */
  issuerRef?: string
  /** Credential reference containing the exact DSH token audience. */
  audienceRef?: string
  /** Browser cookie carrying the compact signed identity token. */
  cookieName?: string
  /** Directory shared with the gateway's revocable file-session store. */
  sessionDirectory?: string
}

export const Config: z<Config> = z.object({
  publicKeyRef: z.string().default('AUTH_COOKIE_PUBLIC_KEY'),
  issuerRef: z.string().default('AUTH_COOKIE_ISSUER'),
  audienceRef: z.string().default('AUTH_COOKIE_AUDIENCE'),
  cookieName: z.string().default('dsh_identity'),
  sessionDirectory: z.string().default('.dsh-auth/sessions'),
})
export const inject = ['credentials', 'webServer']
export const name = 'host-authentication'

interface IdentityPayload {
  v: 1
  iss: string
  aud: string
  sub: string
  username: string
  /** Login-time admin snapshot. Absent in tokens issued before this field existed; read as `false`. */
  isAdmin?: boolean
  iat: number
  exp: number
  sid: string
}

function cookieValue(request: Pick<IncomingMessage, 'headers'>, name: string): string | undefined {
  const header = request.headers.cookie
  if (header === undefined) return undefined
  for (const part of header.split(';')) {
    const at = part.indexOf('=')
    if (at >= 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim()
  }
  return undefined
}

function hasTrustedOrigin(request: Pick<IncomingMessage, 'headers'>): boolean {
  const origin = request.headers.origin
  const host = request.headers.host
  if (origin === undefined) return true
  if (host === undefined) return false
  try { return new URL(origin).host === host } catch { return false }
}

function decodeJson(encoded: string): unknown {
  return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
}

/** Verifies identity cookies issued by the separately deployed authentication gateway. */
export class ExternalCookieAuthService extends AuthService {
  static inject = ['credentials', 'webServer']
  private publicKey!: KeyObject
  private issuer!: string
  private audience!: string
  private readonly cookieName: string
  private readonly sessions: FileSessionStore

  constructor(ctx: Context, config: Config = {}) {
    super(ctx)
    this.cookieName = config.cookieName ?? 'dsh_identity'
    this.sessions = new FileSessionStore(config.sessionDirectory ?? '.dsh-auth/sessions')
    if (!/^[A-Za-z0-9_-]+$/.test(this.cookieName)) {
      throw new Error('host-authentication: cookieName is invalid')
    }
    ctx.effect(async () => {
      const publicKeyRef = credentialRef(config.publicKeyRef ?? 'AUTH_COOKIE_PUBLIC_KEY')
      const issuerRef = credentialRef(config.issuerRef ?? 'AUTH_COOKIE_ISSUER')
      const audienceRef = credentialRef(config.audienceRef ?? 'AUTH_COOKIE_AUDIENCE')
      for (const ref of [publicKeyRef, issuerRef, audienceRef]) ctx.credentials.reserveDeployment(ref)
      const [key, issuer, audience] = await Promise.all([
        ctx.credentials.resolve(publicKeyRef),
        ctx.credentials.resolve(issuerRef),
        ctx.credentials.resolve(audienceRef),
      ])
      if (key === undefined) throw new Error(`host-authentication: ${publicKeyRef} is not configured`)
      if (issuer === undefined || issuer.value.length === 0) {
        throw new Error(`host-authentication: ${issuerRef} is not configured`)
      }
      if (audience === undefined || audience.value.length === 0) {
        throw new Error(`host-authentication: ${audienceRef} is not configured`)
      }
      const parsed = createPublicKey(key.value)
      if (parsed.asymmetricKeyType !== 'ed25519') {
        throw new Error(`host-authentication: ${publicKeyRef} must be an Ed25519 public key`)
      }
      this.publicKey = parsed
      this.issuer = issuer.value
      this.audience = audience.value
      return () => {}
    }, 'host-authentication: load identity verification material')
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/auth/logout',
      handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
        if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
        if (!hasTrustedOrigin(req)) { res.writeHead(403); res.end(); return }
        await this.logout(req)
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'set-cookie': this.clearIdentityCookie(),
          'cache-control': 'no-store',
        })
        res.end(JSON.stringify({ authenticated: false }))
      },
    }), 'host-authentication: logout route')
  }

  authenticateRequest(request: Pick<IncomingMessage, 'headers'>): Promise<AuthenticatedUser | undefined> {
    return this.verifyRequest(request)
  }

  /**
   * Revoke the session carried by a request's identity cookie. The token is
   * verified first so a forged cookie cannot revoke another session; a missing
   * or invalid cookie revokes nothing.
   * @param request - request headers carrying the session cookie.
   */
  async logout(request: Pick<IncomingMessage, 'headers'>): Promise<void> {
    const token = cookieValue(request, this.cookieName)
    if (token === undefined) return
    const identity = this.verifiedIdentity(token)
    if (identity !== undefined) await this.sessions.delete(identity.sessionId)
  }

  /** The Set-Cookie value that deletes the identity cookie in the browser. */
  private clearIdentityCookie(): string {
    return `${this.cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  }

  private verifiedIdentity(token: string): { user: AuthenticatedUser; sessionId: string } | undefined {
    const parts = token.split('.')
    if (parts.length !== 3) return undefined
    const [encodedHeader, encodedPayload, encodedSignature] = parts
    if (encodedHeader === undefined || encodedPayload === undefined || encodedSignature === undefined) return undefined
    try {
      const header = decodeJson(encodedHeader)
      if (typeof header !== 'object' || header === null
        || (header as Record<string, unknown>).alg !== 'EdDSA'
        || (header as Record<string, unknown>).typ !== 'JWT') return undefined
      const signed = Buffer.from(`${encodedHeader}.${encodedPayload}`)
      if (!verify(null, signed, this.publicKey, Buffer.from(encodedSignature, 'base64url'))) return undefined
      const payload = decodeJson(encodedPayload) as Partial<IdentityPayload>
      const now = Math.floor(Date.now() / 1000)
      if (payload.v !== 1 || payload.iss !== this.issuer || payload.aud !== this.audience
        || typeof payload.sub !== 'string' || payload.sub.trim().length === 0
        || typeof payload.username !== 'string' || payload.username.trim().length === 0
        || typeof payload.sid !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(payload.sid)
        || typeof payload.iat !== 'number' || !Number.isInteger(payload.iat) || payload.iat > now
        || typeof payload.exp !== 'number' || !Number.isInteger(payload.exp) || payload.exp <= now
        || (payload.isAdmin !== undefined && typeof payload.isAdmin !== 'boolean')) return undefined
      return {
        user: { userId: authenticatedUserId(payload.sub), username: payload.username, isAdmin: payload.isAdmin === true },
        sessionId: payload.sid,
      }
    } catch {
      return undefined
    }
  }

  private async verifyRequest(request: Pick<IncomingMessage, 'headers'>): Promise<AuthenticatedUser | undefined> {
    const token = cookieValue(request, this.cookieName)
    if (token === undefined) return undefined
    const identity = this.verifiedIdentity(token)
    if (identity === undefined) return undefined
    const stored = await this.sessions.find(identity.sessionId)
    if (stored?.userId !== identity.user.userId || stored.username !== identity.user.username) return undefined
    // The revocable server-side record is authoritative for privilege: the
    // cookie's `isAdmin` is only a hint, so a token whose signature verifies but
    // whose record says otherwise cannot elevate.
    return { ...identity.user, isAdmin: stored.isAdmin }
  }
}

export default ExternalCookieAuthService
