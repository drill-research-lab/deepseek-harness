import { EventEmitter } from 'node:events'
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { CredentialProvider, CredentialRef } from '@deepseek-ai/dsh-credentials'
import { authenticatedUserId } from '@deepseek-ai/dsh-auth'
import { FileSessionStore } from '@deepseek-ai/dsh-auth/file-session-store'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import ExternalCookieAuthService from '../src/index.ts'

const ISSUER = 'https://auth.islab.local'
const AUDIENCE = 'dsh'
const pair = generateKeyPairSync('ed25519')

function token(privateKey: KeyObject, sessionId: string, overrides: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    v: 1, iss: ISSUER, aud: AUDIENCE, sub: 'ldap:uuid-alice', username: 'alice',
    sid: sessionId, iat: now, exp: now + 300, ...overrides,
  })).toString('base64url')
  const signature = sign(null, Buffer.from(`${header}.${payload}`), privateKey).toString('base64url')
  return `${header}.${payload}.${signature}`
}

function response(): { value: ServerResponse; state: { status?: number; body: string; cookie?: string } } {
  const state = { body: '' } as { status?: number; body: string; cookie?: string }
  const value = Object.assign(new EventEmitter(), {
    writeHead(status: number, headers?: Record<string, string | number>) {
      state.status = status
      if (typeof headers?.['set-cookie'] === 'string') state.cookie = headers['set-cookie']
      return this
    },
    end(chunk?: string) { if (chunk !== undefined) state.body += chunk; return this },
  }) as unknown as ServerResponse
  return { value, state }
}

function browserRequest(path: string, method: 'GET' | 'POST', headers: Record<string, string> = {}): IncomingMessage {
  const req = Readable.from([]) as unknown as IncomingMessage
  Object.assign(req, { method, url: path, headers: { host: '127.0.0.1:3080', ...headers } })
  return req
}

async function mounted() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-host-session-'))
  const sessions = new FileSessionStore(join(root, 'sessions'))
  const ctx = new Context()
  const routes = new Map<string, WebRoute>()
  const values: Record<string, string> = {
    AUTH_COOKIE_PUBLIC_KEY: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    AUTH_COOKIE_ISSUER: ISSUER,
    AUTH_COOKIE_AUDIENCE: AUDIENCE,
  }
  ctx.provide('credentials', {
    resolve: async (ref: CredentialRef) => {
      const value = values[String(ref)]
      return value === undefined ? undefined : { value, source: 'test' }
    },
    reserveDeployment: () => {},
  } as unknown as CredentialProvider)
  ctx.provide('webServer', {
    register: (route: WebRoute) => { routes.set(route.path, route); return () => { routes.delete(route.path) } },
  } as never)
  const fiber = ctx.plugin(ExternalCookieAuthService, { sessionDirectory: sessions.directory })
  await fiber.await()
  return {
    auth: ctx.auth as ExternalCookieAuthService,
    sessions,
    routes,
    dispose: async () => { await fiber.dispose(); await rm(root, { recursive: true, force: true }) },
  }
}

type Mounted = Awaited<ReturnType<typeof mounted>>

async function issued(app: Mounted, overrides: Record<string, unknown> = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const expiresAt = typeof overrides['exp'] === 'number' ? overrides['exp'] : now + 300
  const sessionId = await app.sessions.create({ userId: authenticatedUserId('ldap:uuid-alice'), username: 'alice', isAdmin: false }, expiresAt)
  return token(pair.privateKey, sessionId, overrides)
}

describe('external identity cookie authentication', () => {
  it('accepts a valid LDAP identity cookie from the gateway', async () => {
    const app = await mounted()
    const valid = await issued(app)
    await expect(app.auth.authenticateRequest({
      headers: { cookie: `dsh_identity=${valid}` },
    })).resolves.toEqual({ userId: 'ldap:uuid-alice', username: 'alice', isAdmin: false })
    await app.dispose()
  })

  it('rejects tampered, expired, and incorrectly targeted cookies', async () => {
    const app = await mounted()
    const valid = await issued(app)
    await expect(app.auth.authenticateRequest({ headers: { cookie: `dsh_identity=${valid}x` } })).resolves.toBeUndefined()
    await expect(app.auth.authenticateRequest({
      headers: { cookie: `dsh_identity=${await issued(app, { exp: 1 })}` },
    })).resolves.toBeUndefined()
    await expect(app.auth.authenticateRequest({
      headers: { cookie: `dsh_identity=${await issued(app, { aud: 'other-service' })}` },
    })).resolves.toBeUndefined()
    await expect(app.auth.authenticateRequest({
      headers: { cookie: `dsh_identity=${await issued(app, { iss: 'https://attacker.invalid' })}` },
    })).resolves.toBeUndefined()
    await expect(app.auth.authenticateRequest({
      headers: { cookie: `dsh_identity=${await issued(app, { iat: Math.floor(Date.now() / 1000) + 60 })}` },
    })).resolves.toBeUndefined()
    await app.dispose()
  })

  it('reads headers only and exposes no credential or session-issuance operation', async () => {
    const app = await mounted()
    const valid = await issued(app)
    const request = {
      headers: { cookie: `dsh_identity=${valid}` },
      async *[Symbol.asyncIterator](): AsyncGenerator<never> {
        throw new Error('DSH attempted to read a credential body')
      },
    }
    await expect(app.auth.authenticateRequest(request)).resolves.toBeDefined()
    expect('createSession' in app.auth).toBe(false)
    expect('clearSession' in app.auth).toBe(false)
    await app.dispose()
  })

  it('revokes the session carried by a request and ignores a forged cookie', async () => {
    const app = await mounted()
    const valid = await issued(app)
    await app.auth.logout({ headers: { cookie: `dsh_identity=${valid}` } })
    await expect(app.auth.authenticateRequest({ headers: { cookie: `dsh_identity=${valid}` } })).resolves.toBeUndefined()
    await app.auth.logout({ headers: { cookie: `dsh_identity=${valid}x` } })
    await app.auth.logout({ headers: {} })
    await app.dispose()
  })

  it('clears the identity cookie and revokes the session on POST /auth/logout', async () => {
    const app = await mounted()
    const valid = await issued(app)
    const route = app.routes.get('/auth/logout')
    expect(route).toBeDefined()
    const result = response()
    await route!.handler(browserRequest('/auth/logout', 'POST', { cookie: `dsh_identity=${valid}` }), result.value)
    expect(result.state.status).toBe(200)
    expect(result.state.cookie).toBe('dsh_identity=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0')
    await expect(app.auth.authenticateRequest({ headers: { cookie: `dsh_identity=${valid}` } })).resolves.toBeUndefined()
    await app.dispose()
  })

  it('rejects a cross-origin logout and non-POST methods', async () => {
    const app = await mounted()
    const valid = await issued(app)
    const route = app.routes.get('/auth/logout')!
    const crossOrigin = response()
    await route.handler(browserRequest('/auth/logout', 'POST', {
      host: '127.0.0.1:3080', origin: 'http://attacker.invalid', cookie: `dsh_identity=${valid}`,
    }), crossOrigin.value)
    expect(crossOrigin.state.status).toBe(403)
    const wrongMethod = response()
    await route.handler(browserRequest('/auth/logout', 'GET', { cookie: `dsh_identity=${valid}` }), wrongMethod.value)
    expect(wrongMethod.state.status).toBe(405)
    // Neither request revoked the session.
    await expect(app.auth.authenticateRequest({ headers: { cookie: `dsh_identity=${valid}` } })).resolves.toBeDefined()
    await app.dispose()
  })
})

describe('external identity cookie authentication — isAdmin', () => {
  /** Issue a cookie whose file-session record carries the given admin flag. */
  async function issuedWithRecord(app: Mounted, recordIsAdmin: boolean, tokenOverrides: Record<string, unknown> = {}): Promise<string> {
    const now = Math.floor(Date.now() / 1000)
    const sessionId = await app.sessions.create(
      { userId: authenticatedUserId('ldap:uuid-alice'), username: 'alice', isAdmin: recordIsAdmin },
      now + 300,
    )
    return token(pair.privateKey, sessionId, tokenOverrides)
  }

  it('returns isAdmin: true when the record and cookie both mark the user admin', async () => {
    const app = await mounted()
    const cookie = await issuedWithRecord(app, true, { isAdmin: true })
    await expect(app.auth.authenticateRequest({ headers: { cookie: `dsh_identity=${cookie}` } }))
      .resolves.toEqual({ userId: 'ldap:uuid-alice', username: 'alice', isAdmin: true })
    await app.dispose()
  })

  it('takes isAdmin from the file-session record, not the cookie, when they disagree', async () => {
    const app = await mounted()
    // Forged/desynchronised cookie: signature verifies, payload says admin, record does not.
    const cookie = await issuedWithRecord(app, false, { isAdmin: true })
    await expect(app.auth.authenticateRequest({ headers: { cookie: `dsh_identity=${cookie}` } }))
      .resolves.toEqual({ userId: 'ldap:uuid-alice', username: 'alice', isAdmin: false })
    await app.dispose()
  })

  it('does not grant admin from the cookie when the record has it but the cookie omits it', async () => {
    const app = await mounted()
    const cookie = await issuedWithRecord(app, true) // no isAdmin in the token payload
    await expect(app.auth.authenticateRequest({ headers: { cookie: `dsh_identity=${cookie}` } }))
      .resolves.toEqual({ userId: 'ldap:uuid-alice', username: 'alice', isAdmin: true })
    await app.dispose()
  })

  it('verifies a pre-upgrade cookie that omits isAdmin, reading it as false', async () => {
    const app = await mounted()
    const cookie = await issuedWithRecord(app, false) // neither record nor cookie sets isAdmin
    await expect(app.auth.authenticateRequest({ headers: { cookie: `dsh_identity=${cookie}` } }))
      .resolves.toEqual({ userId: 'ldap:uuid-alice', username: 'alice', isAdmin: false })
    await app.dispose()
  })

  it('rejects a cookie whose isAdmin claim is not a boolean', async () => {
    const app = await mounted()
    const cookie = await issuedWithRecord(app, false, { isAdmin: 'yes' })
    await expect(app.auth.authenticateRequest({ headers: { cookie: `dsh_identity=${cookie}` } }))
      .resolves.toBeUndefined()
    await app.dispose()
  })
})
