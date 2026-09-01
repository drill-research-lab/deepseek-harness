import { createPrivateKey, createPublicKey, randomBytes, sign, timingSafeEqual, verify, type KeyObject } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { authenticatedUserId, type AuthenticatedUser } from '@deepseek-ai/dsh-auth'
import { FileSessionStore } from '@deepseek-ai/dsh-auth/file-session-store'
import { LocalAccountConflictError, type LocalAccountRegistration } from '@deepseek-ai/dsh-auth-local'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

/** LDAP gateway identity-cookie issuance configuration. */
export interface Config {
  /** Credential reference containing the gateway's Ed25519 PEM private key. */
  privateKeyRef?: string
  /** Credential reference containing the identity token issuer. */
  issuerRef?: string
  /** Credential reference containing the DSH token audience. */
  audienceRef?: string
  /** Browser cookie carrying the compact signed identity token. */
  cookieName?: string
  /** Identity token and cookie lifetime, capped at one hour. */
  cookieExpireSeconds?: number
  /** Whether the identity cookie carries the Secure attribute. */
  cookieSecure?: boolean
  /** Whether callers may create gateway-local DSH accounts. */
  registrationEnabled?: boolean
  /** Absolute DSH browser URL used after a successful form submission. */
  appUrl?: string
  /** Owner-only directory containing one revocable record per browser session. */
  sessionDirectory?: string
}

export const Config: z<Config> = z.object({
  privateKeyRef: z.string().default('AUTH_COOKIE_PRIVATE_KEY'),
  issuerRef: z.string().default('AUTH_COOKIE_ISSUER'),
  audienceRef: z.string().default('AUTH_COOKIE_AUDIENCE'),
  cookieName: z.string().default('dsh_identity'),
  cookieExpireSeconds: z.natural().min(60).max(3600).default(300),
  cookieSecure: z.boolean().default(true),
  registrationEnabled: z.boolean().default(false),
  appUrl: z.string().default('http://127.0.0.1:3080/'),
  sessionDirectory: z.string().default('.dsh-auth/sessions'),
})
export const inject = ['credentials', 'ldapDirectory', 'localAccounts', 'webServer']
export const name = 'auth-gateway-ldap'
const MAX_CREDENTIAL_BODY_BYTES = 64 * 1024
const CSRF_COOKIE_NAME = 'dsh_auth_csrf'
const CSRF_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += bytes.length
    if (size > MAX_CREDENTIAL_BODY_BYTES) throw new TypeError('credential body is too large')
    chunks.push(bytes)
  }
  const encoded = Buffer.concat(chunks).toString('utf8')
  if (isForm(request)) {
    const body: Record<string, unknown> = {}
    for (const [key, value] of new URLSearchParams(encoded)) {
      if (body[key] !== undefined) throw new TypeError(`${key} must occur once`)
      body[key] = value
    }
    return body
  }
  const body: unknown = JSON.parse(encoded)
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new TypeError('body must be an object')
  return body as Record<string, unknown>
}

function isForm(request: IncomingMessage): boolean {
  return request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() === 'application/x-www-form-urlencoded'
}

function hasTrustedOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin
  const host = request.headers.host
  if (origin === undefined) return true
  if (host === undefined) return false
  try { return new URL(origin).host === host } catch { return false }
}

function cookieValue(request: IncomingMessage, name: string): string | undefined {
  const header = request.headers.cookie
  if (header === undefined) return undefined
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue
    return part.slice(separator + 1).trim()
  }
  return undefined
}

function csrfToken(request: IncomingMessage): string {
  const existing = cookieValue(request, CSRF_COOKIE_NAME)
  return existing !== undefined && CSRF_TOKEN_PATTERN.test(existing)
    ? existing
    : randomBytes(32).toString('base64url')
}

function validCsrf(request: IncomingMessage, body: Record<string, unknown>): boolean {
  const submitted = body['_csrf']
  const cookie = cookieValue(request, CSRF_COOKIE_NAME)
  if (typeof submitted !== 'string' || cookie === undefined
    || !CSRF_TOKEN_PATTERN.test(submitted) || !CSRF_TOKEN_PATTERN.test(cookie)) return false
  return timingSafeEqual(Buffer.from(submitted), Buffer.from(cookie))
}

function stringField(body: Record<string, unknown>, name: string): string {
  const value = body[name]
  if (typeof value !== 'string') throw new TypeError(`${name} must be a string`)
  return value
}

function json(response: ServerResponse, status: number, body: unknown, cookie?: string): void {
  const encoded = JSON.stringify(body)
  const headers: Record<string, string | number> = {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(encoded),
    'cache-control': 'no-store',
  }
  if (cookie !== undefined) headers['set-cookie'] = cookie
  response.writeHead(status, headers)
  response.end(encoded)
}

const PAGE_STYLE = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    padding: 24px 16px; background: #0f1115; color: #ffffff;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .card { width: 100%; max-width: 400px; background: #1b1b1c; border: 1px solid #353638; border-radius: 12px; padding: 28px 24px; }
  .brand { margin: 0 0 4px; font-size: 18px; font-weight: 600; }
  .subtitle { margin: 0 0 22px; font-size: 13px; color: #adb2b8; }
  .tabs input[type="radio"] { position: absolute; width: 1px; height: 1px; opacity: 0; }
  .tab-buttons { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 4px; margin-bottom: 20px; background: #232324; border-radius: 8px; }
  .tab-buttons label { padding: 8px 0; border-radius: 6px; text-align: center; font-size: 14px; font-weight: 500; color: #adb2b8; cursor: pointer; transition: background-color .15s cubic-bezier(.4,0,.2,1), color .15s cubic-bezier(.4,0,.2,1); }
  #tab-ldap:checked ~ .tab-buttons label[for="tab-ldap"], #tab-local:checked ~ .tab-buttons label[for="tab-local"] { background: #353638; color: #ffffff; }
  .field { display: block; margin-bottom: 14px; font-size: 13px; color: #adb2b8; }
  .field input { display: block; width: 100%; margin-top: 6px; padding: 9px 12px; font-size: 14px; color: #ffffff; background: #232324; border: 1px solid #353638; border-radius: 8px; outline: none; }
  .field input:focus { border-color: #4176e6; }
  button[type="submit"] { display: block; width: 100%; padding: 10px 12px; margin-top: 4px; font-size: 15px; font-weight: 600; color: #ffffff; background: #4176e6; border: none; border-radius: 8px; cursor: pointer; transition: background-color .15s cubic-bezier(.4,0,.2,1); }
  button[type="submit"]:hover { background: #679efe; }
  .hint { margin: 16px 0 0; text-align: center; font-size: 13px; color: #adb2b8; }
  .hint a { color: #679efe; text-decoration: none; }
  .hint a:hover { text-decoration: underline; }
  #tab-ldap:checked ~ .panes #pane-local { display: none; }
  #tab-local:checked ~ .panes #pane-ldap { display: none; }
`

function page(title: string, content: string): string {
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${PAGE_STYLE}</style></head><body><main class="card">${content}</main></body></html>`
}

function loginPage(registrationEnabled: boolean, csrf: string): string {
  return page('DSH 登入', `<h1 class="brand">DeepSeek Harness</h1>
    <p class="subtitle">登入</p>
    <div class="tabs">
      <input type="radio" name="auth-tab" id="tab-ldap" checked>
      <input type="radio" name="auth-tab" id="tab-local">
      <div class="tab-buttons"><label for="tab-ldap">LDAP</label><label for="tab-local">一般帳號</label></div>
      <div class="panes">
        <form id="pane-ldap" method="post" action="/auth/login"><input type="hidden" name="_csrf" value="${csrf}"><input type="hidden" name="provider" value="ldap"><label class="field">帳號<input name="username" autocomplete="username" required></label><label class="field">密碼<input name="password" type="password" autocomplete="current-password" required></label><button type="submit">登入</button></form>
        <form id="pane-local" method="post" action="/auth/login"><input type="hidden" name="_csrf" value="${csrf}"><input type="hidden" name="provider" value="local"><label class="field">帳號<input name="username" autocomplete="username" required></label><label class="field">密碼<input name="password" type="password" autocomplete="current-password" required></label><button type="submit">登入</button><p class="hint">${registrationEnabled ? '<a href="/auth/register">建立一般帳號</a>' : '一般帳號註冊未開放。'}</p></form>
      </div>
    </div>`)
}

function registerPage(csrf: string): string {
  return page('建立 DSH 帳號', `<h1 class="brand">建立一般帳號</h1>
    <p class="subtitle">建立一個 DSH 本地帳號</p>
    <form method="post" action="/auth/register"><input type="hidden" name="_csrf" value="${csrf}"><label class="field">帳號<input name="username" autocomplete="username" pattern="[A-Za-z0-9._-]{1,64}" required></label><label class="field">顯示名稱<input name="displayName" autocomplete="name" required></label><label class="field">Email<input name="email" type="email" autocomplete="email" required></label><label class="field">密碼（至少 12 個字元）<input name="password" type="password" minlength="12" autocomplete="new-password" required></label><button type="submit">建立</button></form><p class="hint"><a href="/auth/login">返回登入</a></p>`)
}

function html(response: ServerResponse, status: number, body: string, cookie?: string, formAction = "'self'"): void {
  const headers: Record<string, string | number> = {
    'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store', 'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; form-action ${formAction}; base-uri 'none'; frame-ancestors 'none'`,
    'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
  }
  if (cookie !== undefined) headers['set-cookie'] = cookie
  response.writeHead(status, headers)
  response.end(body)
}

function formError(response: ServerResponse, status: number, message: string): void {
  html(response, status, page('登入失敗', `<h1>${message}</h1><p><a href="/auth/login">返回登入</a></p>`))
}

function redirect(response: ServerResponse, location: string, cookie: string): void {
  response.writeHead(303, { location, 'set-cookie': cookie, 'cache-control': 'no-store' })
  response.end()
}

/** Owns credential routes and identity-cookie signing in the authentication gateway process. */
export class LdapAuthGateway extends Service {
  static inject = ['credentials', 'ldapDirectory', 'localAccounts', 'webServer']
  private privateKey!: KeyObject
  private publicKey!: KeyObject
  private issuer!: string
  private audience!: string
  private readonly cookieName: string
  private readonly expires: number
  private readonly secure: boolean
  private readonly registrationEnabled: boolean
  private readonly appUrl: string
  private readonly sessions: FileSessionStore

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'ldapAuthGateway')
    this.cookieName = config.cookieName ?? 'dsh_identity'
    this.expires = config.cookieExpireSeconds ?? 300
    this.secure = config.cookieSecure ?? true
    this.registrationEnabled = config.registrationEnabled ?? false
    this.sessions = new FileSessionStore(config.sessionDirectory ?? '.dsh-auth/sessions')
    const appUrl = new URL(config.appUrl ?? 'http://127.0.0.1:3080/')
    if (!['http:', 'https:'].includes(appUrl.protocol) || appUrl.username.length > 0 || appUrl.password.length > 0) {
      throw new Error('auth-gateway-ldap: appUrl must be an HTTP(S) URL without credentials')
    }
    this.appUrl = appUrl.href
    if (!/^[A-Za-z0-9_-]+$/.test(this.cookieName)) throw new Error('auth-gateway-ldap: cookieName is invalid')
    ctx.effect(async () => {
      const privateKeyRef = credentialRef(config.privateKeyRef ?? 'AUTH_COOKIE_PRIVATE_KEY')
      const issuerRef = credentialRef(config.issuerRef ?? 'AUTH_COOKIE_ISSUER')
      const audienceRef = credentialRef(config.audienceRef ?? 'AUTH_COOKIE_AUDIENCE')
      for (const ref of [privateKeyRef, issuerRef, audienceRef]) ctx.credentials.reserveDeployment(ref)
      const [key, issuer, audience] = await Promise.all([
        ctx.credentials.resolve(privateKeyRef),
        ctx.credentials.resolve(issuerRef),
        ctx.credentials.resolve(audienceRef),
      ])
      if (key === undefined) throw new Error(`auth-gateway-ldap: ${privateKeyRef} is not configured`)
      if (issuer === undefined || issuer.value.length === 0) throw new Error(`auth-gateway-ldap: ${issuerRef} is not configured`)
      if (audience === undefined || audience.value.length === 0) throw new Error(`auth-gateway-ldap: ${audienceRef} is not configured`)
      const parsed = createPrivateKey(key.value)
      if (parsed.asymmetricKeyType !== 'ed25519') {
        throw new Error(`auth-gateway-ldap: ${privateKeyRef} must be an Ed25519 private key`)
      }
      this.privateKey = parsed
      this.publicKey = createPublicKey(parsed)
      this.issuer = issuer.value
      this.audience = audience.value
      return () => {}
    }, 'auth-gateway-ldap: load signing material')
    this.registerRoutes()
  }

  private identityToken(user: AuthenticatedUser, sessionId: string, expiresAt: number): string {
    const now = Math.floor(Date.now() / 1000)
    const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' })).toString('base64url')
    const payload = Buffer.from(JSON.stringify({
      v: 1, iss: this.issuer, aud: this.audience, sub: user.userId,
      username: user.username, sid: sessionId, iat: now, exp: expiresAt,
      isAdmin: user.isAdmin,
    })).toString('base64url')
    const signature = sign(null, Buffer.from(`${header}.${payload}`), this.privateKey).toString('base64url')
    return `${header}.${payload}.${signature}`
  }

  private async identityCookie(user: AuthenticatedUser): Promise<string> {
    const expiresAt = Math.floor(Date.now() / 1000) + this.expires
    const sessionId = await this.sessions.create(user, expiresAt)
    return `${this.cookieName}=${this.identityToken(user, sessionId, expiresAt)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${String(this.expires)}${this.secure ? '; Secure' : ''}`
  }

  private clearIdentityCookie(): string {
    return `${this.cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${this.secure ? '; Secure' : ''}`
  }

  private verifiedIdentity(request: IncomingMessage): { user: AuthenticatedUser; sessionId: string } | undefined {
    const token = cookieValue(request, this.cookieName)
    if (token === undefined) return undefined
    const parts = token.split('.')
    if (parts.length !== 3) return undefined
    const [header, payload, signature] = parts
    if (header === undefined || payload === undefined || signature === undefined) return undefined
    try {
      const parsedHeader: unknown = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'))
      if (typeof parsedHeader !== 'object' || parsedHeader === null
        || (parsedHeader as Record<string, unknown>).alg !== 'EdDSA'
        || (parsedHeader as Record<string, unknown>).typ !== 'JWT'
        || !verify(null, Buffer.from(`${header}.${payload}`), this.publicKey, Buffer.from(signature, 'base64url'))) {
        return undefined
      }
      const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
      if (typeof parsed !== 'object' || parsed === null) return undefined
      const identity = parsed as Record<string, unknown>
      const now = Math.floor(Date.now() / 1000)
      if (identity['v'] !== 1 || identity['iss'] !== this.issuer || identity['aud'] !== this.audience
        || typeof identity['sub'] !== 'string' || identity['sub'].trim().length === 0
        || typeof identity['username'] !== 'string' || identity['username'].trim().length === 0
        || typeof identity['sid'] !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(identity['sid'])
        || typeof identity['iat'] !== 'number' || !Number.isInteger(identity['iat']) || identity['iat'] > now
        || typeof identity['exp'] !== 'number' || !Number.isInteger(identity['exp']) || identity['exp'] <= now
        || (identity['isAdmin'] !== undefined && typeof identity['isAdmin'] !== 'boolean')) return undefined
      return {
        user: {
          userId: authenticatedUserId(identity['sub']),
          username: identity['username'],
          isAdmin: identity['isAdmin'] === true,
        },
        sessionId: identity['sid'],
      }
    } catch {
      return undefined
    }
  }

  private async authenticatedUser(request: IncomingMessage): Promise<AuthenticatedUser | undefined> {
    const identity = this.verifiedIdentity(request)
    if (identity === undefined) return undefined
    const stored = await this.sessions.find(identity.sessionId)
    if (stored?.userId !== identity.user.userId || stored.username !== identity.user.username) return undefined
    return identity.user
  }

  private redirectLocation(request: IncomingMessage): string {
    const target = new URL(this.appUrl)
    const host = request.headers.host
    if (host === undefined) return target.href
    try {
      target.hostname = new URL(`http://${host}`).hostname
      return target.href
    } catch {
      return target.href
    }
  }

  private csrfCookie(token: string): string {
    return `${CSRF_COOKIE_NAME}=${token}; Path=/auth; HttpOnly; SameSite=Strict; Max-Age=600${this.secure ? '; Secure' : ''}`
  }

  private formAction(request: IncomingMessage): string {
    return `'self' ${new URL(this.redirectLocation(request)).origin}`
  }

  private registerRoutes(): void {
    const login: WebRoute = { kind: 'exact', path: '/auth/login', handler: async (req, res) => {
      if (req.method === 'GET') {
        const token = csrfToken(req)
        html(res, 200, loginPage(this.registrationEnabled, token), this.csrfCookie(token), this.formAction(req))
        return
      }
      if (req.method !== 'POST') { res.writeHead(405, { allow: 'GET, POST' }); res.end(); return }
      try {
        const body = await readBody(req)
        if (isForm(req) ? !validCsrf(req, body) : !hasTrustedOrigin(req)) {
          formError(res, 403, '來源驗證失敗')
          return
        }
        const provider = body['provider'] === undefined ? 'ldap' : stringField(body, 'provider')
        if (provider !== 'ldap' && provider !== 'local') throw new TypeError('provider must be ldap or local')
        const username = stringField(body, 'username')
        const password = stringField(body, 'password')
        const user = provider === 'ldap'
          ? await this.ctx.ldapDirectory.authenticate(username, password)
          : await this.ctx.localAccounts.authenticate(username, password)
        if (user === undefined) {
          if (isForm(req)) formError(res, 401, '帳號或密碼錯誤')
          else json(res, 401, { error: 'invalid credentials' })
          return
        }
        const cookie = await this.identityCookie(user)
        if (isForm(req)) redirect(res, this.redirectLocation(req), cookie)
        else json(res, 200, { user }, cookie)
      } catch (error) {
        if (error instanceof SyntaxError || error instanceof TypeError) {
          if (isForm(req)) formError(res, 400, '登入資料格式錯誤')
          else json(res, 400, { error: 'invalid request' })
          return
        }
        throw error
      }
    } }
    const register: WebRoute = { kind: 'exact', path: '/auth/register', handler: async (req, res) => {
      if (req.method === 'GET') {
        if (this.registrationEnabled) {
          const token = csrfToken(req)
          html(res, 200, registerPage(token), this.csrfCookie(token), this.formAction(req))
        }
        else formError(res, 403, '一般帳號註冊目前未開放')
        return
      }
      if (req.method !== 'POST') { res.writeHead(405, { allow: 'GET, POST' }); res.end(); return }
      if (!this.registrationEnabled) {
        if (isForm(req)) formError(res, 403, '一般帳號註冊目前未開放')
        else json(res, 403, { error: 'registration disabled' })
        return
      }
      try {
        const body = await readBody(req)
        if (isForm(req) ? !validCsrf(req, body) : !hasTrustedOrigin(req)) {
          formError(res, 403, '來源驗證失敗')
          return
        }
        const registration: LocalAccountRegistration = {
          username: stringField(body, 'username'), password: stringField(body, 'password'),
          displayName: stringField(body, 'displayName'), email: stringField(body, 'email'),
        }
        const user = await this.ctx.localAccounts.create(registration)
        const cookie = await this.identityCookie(user)
        if (isForm(req)) redirect(res, this.redirectLocation(req), cookie)
        else json(res, 201, { user }, cookie)
      } catch (error) {
        if (error instanceof SyntaxError || error instanceof TypeError) {
          if (isForm(req)) formError(res, 400, '註冊資料格式錯誤')
          else json(res, 400, { error: 'invalid request' })
          return
        }
        if (error instanceof LocalAccountConflictError) {
          if (isForm(req)) formError(res, 409, '帳號或 Email 已經存在')
          else json(res, 409, { error: 'account already exists' })
          return
        }
        throw error
      }
    } }
    const me: WebRoute = { kind: 'exact', path: '/auth/me', handler: async (req, res) => {
      if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET' }); res.end(); return }
      const user = await this.authenticatedUser(req)
      if (user === undefined) json(res, 401, { authenticated: false })
      else json(res, 200, { authenticated: true, user })
    } }
    const logout: WebRoute = { kind: 'exact', path: '/auth/logout', handler: async (req, res) => {
      if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
      if (!hasTrustedOrigin(req)) { json(res, 403, { error: 'invalid origin' }); return }
      const identity = this.verifiedIdentity(req)
      if (identity !== undefined) await this.sessions.delete(identity.sessionId)
      json(res, 200, { authenticated: false }, this.clearIdentityCookie())
    } }
    this.ctx.effect(() => this.ctx.webServer.register(login), 'auth-gateway-ldap: login route')
    this.ctx.effect(() => this.ctx.webServer.register(register), 'auth-gateway-ldap: registration route')
    this.ctx.effect(() => this.ctx.webServer.register(me), 'auth-gateway-ldap: current-user route')
    this.ctx.effect(() => this.ctx.webServer.register(logout), 'auth-gateway-ldap: logout route')
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    ldapAuthGateway: LdapAuthGateway
  }
}

export default LdapAuthGateway
