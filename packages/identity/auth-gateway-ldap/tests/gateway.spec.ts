import { EventEmitter } from 'node:events'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { authenticatedUserId } from '@deepseek-ai/dsh-auth'
import type { LdapDirectory } from '@deepseek-ai/dsh-auth-ldap'
import type { LocalAccountStore } from '@deepseek-ai/dsh-auth-local'
import type { CredentialProvider, CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { WebRoute, WebServer } from '@deepseek-ai/dsh-host-webserver'
import ExternalCookieAuthService from '@deepseek-ai/dsh-host-authentication'
import LdapAuthGateway from '../src/index.ts'

const USER = { userId: authenticatedUserId('ldap:uuid-alice'), username: 'alice' }
const LOCAL_USER = { userId: authenticatedUserId('local:uuid-bob'), username: 'bob' }

function request(path: string, body: Record<string, unknown>): IncomingMessage {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]) as unknown as IncomingMessage
  Object.assign(req, { method: 'POST', url: path, headers: { host: '127.0.0.1:3081' } })
  return req
}

function browserRequest(path: string, method: 'GET' | 'POST', body?: URLSearchParams,
  headers: Record<string, string> = {}): IncomingMessage {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(body.toString())]) as unknown as IncomingMessage
  Object.assign(req, {
    method, url: path,
    headers: {
      host: 'auth.islab.local:3081', origin: 'http://auth.islab.local:3081',
      ...(body === undefined ? {} : { 'content-type': 'application/x-www-form-urlencoded' }),
      ...headers,
    },
  })
  return req
}

function csrfForm(pageResult: ReturnType<typeof response>, fields: Record<string, string>): { body: URLSearchParams; cookie: string } {
  const match = pageResult.state.body.match(/name="_csrf" value="([A-Za-z0-9_-]+)"/)
  if (match?.[1] === undefined || pageResult.state.cookie === undefined) throw new Error('CSRF material missing from form')
  return { body: new URLSearchParams({ _csrf: match[1], ...fields }), cookie: pageResult.state.cookie.split(';', 1)[0]! }
}

function response(): { value: ServerResponse; state: { status?: number; body: string; cookie?: string; location?: string } } {
  const state = { body: '' } as { status?: number; body: string; cookie?: string; location?: string }
  const value = Object.assign(new EventEmitter(), {
    writeHead(status: number, headers?: Record<string, string | number>) {
      state.status = status
      if (typeof headers?.['set-cookie'] === 'string') state.cookie = headers['set-cookie']
      if (typeof headers?.location === 'string') state.location = headers.location
      return this
    },
    end(chunk?: string) { if (chunk !== undefined) state.body += chunk; return this },
  }) as unknown as ServerResponse
  return { value, state }
}

async function mounted() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-gateway-session-'))
  const pair = generateKeyPairSync('ed25519')
  const routes = new Map<string, WebRoute>()
  const authenticate = vi.fn(async (username: string, password: string) =>
    username === 'alice' && password === 'correct' ? USER : undefined)
  const authenticateLocal = vi.fn(async (username: string, password: string) =>
    username === 'bob' && password === 'local-password' ? LOCAL_USER : undefined)
  const createLocal = vi.fn(async () => LOCAL_USER)
  const ctx = new Context()
  const values: Record<string, string> = {
    AUTH_COOKIE_PRIVATE_KEY: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    AUTH_COOKIE_ISSUER: 'https://auth.islab.local',
    AUTH_COOKIE_AUDIENCE: 'dsh',
  }
  ctx.provide('credentials', {
    resolve: async (ref: CredentialRef) => {
      const value = values[String(ref)]
      return value === undefined ? undefined : { value, source: 'test' }
    },
  } as unknown as CredentialProvider)
  ctx.provide('ldapDirectory', { authenticate } as unknown as LdapDirectory)
  ctx.provide('localAccounts', { authenticate: authenticateLocal, create: createLocal } as unknown as LocalAccountStore)
  ctx.provide('webServer', {
    register(route: WebRoute) { routes.set(route.path, route); return () => { routes.delete(route.path) } },
  } as WebServer)
  const fiber = ctx.plugin(LdapAuthGateway, {
    cookieSecure: false, registrationEnabled: true, appUrl: 'http://dsh.islab.local:3080/',
    sessionDirectory: join(root, 'sessions'),
  })
  await fiber.await()
  return {
    routes, authenticate, authenticateLocal, createLocal,
    publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    sessionDirectory: join(root, 'sessions'),
    dispose: async () => { await fiber.dispose(); await rm(root, { recursive: true, force: true }) },
  }
}

function identityCookie(cookie: string | undefined): string {
  const value = cookie?.match(/^dsh_identity=([^;]+)/)?.[1]
  if (value === undefined) throw new Error('identity cookie missing')
  return value
}

async function verifier(publicKey: string, sessionDirectory: string) {
  const ctx = new Context()
  const values: Record<string, string> = {
    AUTH_COOKIE_PUBLIC_KEY: publicKey,
    AUTH_COOKIE_ISSUER: 'https://auth.islab.local',
    AUTH_COOKIE_AUDIENCE: 'dsh',
  }
  ctx.provide('credentials', {
    resolve: async (ref: CredentialRef) => {
      const value = values[String(ref)]
      return value === undefined ? undefined : { value, source: 'test' }
    },
  } as unknown as CredentialProvider)
  const fiber = ctx.plugin(ExternalCookieAuthService, { sessionDirectory })
  await fiber.await()
  return { auth: ctx.auth, dispose: () => fiber.dispose() }
}

describe('LDAP authentication gateway', () => {
  it('authenticates against LDAP and issues a browser identity cookie', async () => {
    const app = await mounted()
    const result = response()
    await app.routes.get('/auth/login')!.handler(request('/auth/login', {
      username: 'alice', password: 'correct',
    }), result.value)
    expect(app.authenticate).toHaveBeenCalledWith('alice', 'correct')
    expect(result.state.status).toBe(200)
    expect(result.state.cookie).toMatch(/^dsh_identity=.+; Path=\/; HttpOnly; SameSite=Lax;/)
    expect(result.state.cookie).not.toContain('correct')
    const issued = identityCookie(result.state.cookie)
    const payload = JSON.parse(Buffer.from(issued.split('.')[1]!, 'base64url').toString('utf8')) as Record<string, unknown>
    expect(payload).toMatchObject({
      v: 1, iss: 'https://auth.islab.local', aud: 'dsh', sub: 'ldap:uuid-alice', username: 'alice',
    })
    expect(Object.keys(payload).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'sid', 'sub', 'username', 'v'])
    expect(payload['exp']).toBe((payload['iat'] as number) + 300)
    expect(JSON.stringify(payload)).not.toContain('correct')
    const dsh = await verifier(app.publicKey, app.sessionDirectory)
    await expect(dsh.auth.authenticateRequest({
      headers: { cookie: `dsh_identity=${issued}` },
    })).resolves.toEqual(USER)
    await dsh.dispose()
    await app.dispose()
  })

  it('returns the same 401 for an unknown LDAP account and an invalid password', async () => {
    const app = await mounted()
    for (const [username, password] of [['missing', 'anything'], ['alice', 'wrong']]) {
      const result = response()
      await app.routes.get('/auth/login')!.handler(request('/auth/login', { username, password }), result.value)
      expect(result.state.status).toBe(401)
      expect(JSON.parse(result.state.body)).toEqual({ error: 'invalid credentials' })
      expect(result.state.cookie).toBeUndefined()
    }
    await app.dispose()
  })

  it('serves browser login and registration forms without exposing credentials to DSH', async () => {
    const app = await mounted()
    const loginPage = response()
    await app.routes.get('/auth/login')!.handler(browserRequest('/auth/login', 'GET'), loginPage.value)
    expect(loginPage.state.status).toBe(200)
    expect(loginPage.state.body).toContain('<h2>LDAP</h2>')
    expect(loginPage.state.body).toContain('建立一般帳號')

    const registerPage = response()
    await app.routes.get('/auth/register')!.handler(browserRequest('/auth/register', 'GET'), registerPage.value)
    const registration = csrfForm(registerPage, {
      username: 'bob', password: 'long-enough-password', displayName: 'Bob', email: 'bob@example.com',
    })
    const result = response()
    await app.routes.get('/auth/register')!.handler(browserRequest('/auth/register', 'POST', registration.body,
      { cookie: registration.cookie }), result.value)
    expect(app.createLocal).toHaveBeenCalledWith({
      username: 'bob', password: 'long-enough-password', displayName: 'Bob', email: 'bob@example.com',
    })
    expect(result.state.status).toBe(303)
    expect(result.state.location).toBe('http://auth.islab.local:3080/')
    expect(result.state.cookie).toContain('HttpOnly')
    expect(result.state.body).not.toContain('long-enough-password')
    await app.dispose()
  })

  it('accepts an opaque browser Origin only with the CSRF token issued by the gateway', async () => {
    const app = await mounted()
    const loginPage = response()
    await app.routes.get('/auth/login')!.handler(browserRequest('/auth/login', 'GET'), loginPage.value)
    const login = csrfForm(loginPage, { provider: 'ldap', username: 'alice', password: 'correct' })
    const result = response()
    await app.routes.get('/auth/login')!.handler(browserRequest('/auth/login', 'POST', login.body, {
      origin: 'null', cookie: login.cookie,
    }), result.value)
    expect(result.state.status).toBe(303)
    expect(result.state.location).toBe('http://auth.islab.local:3080/')
    expect(app.authenticate).toHaveBeenCalledWith('alice', 'correct')

    const rejected = response()
    await app.routes.get('/auth/login')!.handler(browserRequest('/auth/login', 'POST', new URLSearchParams({
      provider: 'ldap', username: 'alice', password: 'correct',
    }), { origin: 'null' }), rejected.value)
    expect(rejected.state.status).toBe(403)
    expect(app.authenticate).toHaveBeenCalledTimes(1)
    await app.dispose()
  })

  it('keeps every credential route on the gateway instead of DSH', async () => {
    const app = await mounted()
    expect([...app.routes.keys()].sort()).toEqual(['/auth/login', '/auth/logout', '/auth/me', '/auth/register'])
    const dshRoutes = new Map<string, WebRoute>()
    expect(dshRoutes.has('/auth/login')).toBe(false)
    expect(dshRoutes.has('/auth/register')).toBe(false)
    await app.dispose()
  })

  it('reports the current user, revokes its session on logout, and rejects replay', async () => {
    const app = await mounted()
    const login = response()
    await app.routes.get('/auth/login')!.handler(request('/auth/login', {
      username: 'alice', password: 'correct',
    }), login.value)
    const issued = identityCookie(login.state.cookie)

    const meRequest = browserRequest('/auth/me', 'GET')
    meRequest.headers.cookie = `dsh_identity=${issued}`
    const me = response()
    await app.routes.get('/auth/me')!.handler(meRequest, me.value)
    expect(me.state.status).toBe(200)
    expect(JSON.parse(me.state.body)).toEqual({ authenticated: true, user: USER })

    const logoutRequest = browserRequest('/auth/logout', 'POST', new URLSearchParams(), {
      cookie: `dsh_identity=${issued}`,
    })
    const logout = response()
    await app.routes.get('/auth/logout')!.handler(logoutRequest, logout.value)
    expect(logout.state.status).toBe(200)
    expect(logout.state.cookie).toMatch(/^dsh_identity=; Path=\/; HttpOnly; SameSite=Lax; Max-Age=0/)

    const replay = response()
    const replayRequest = browserRequest('/auth/me', 'GET')
    replayRequest.headers.cookie = `dsh_identity=${issued}`
    await app.routes.get('/auth/me')!.handler(replayRequest, replay.value)
    expect(replay.state.status).toBe(401)
    expect(JSON.parse(replay.state.body)).toEqual({ authenticated: false })

    const dsh = await verifier(app.publicKey, app.sessionDirectory)
    await expect(dsh.auth.authenticateRequest({
      headers: { cookie: `dsh_identity=${issued}` },
    })).resolves.toBeUndefined()
    await dsh.dispose()

    const invalid = response()
    const invalidRequest = browserRequest('/auth/me', 'GET')
    invalidRequest.headers.cookie = `dsh_identity=${issued}x`
    await app.routes.get('/auth/me')!.handler(invalidRequest, invalid.value)
    expect(invalid.state.status).toBe(401)
    expect(JSON.parse(invalid.state.body)).toEqual({ authenticated: false })
    await app.dispose()
  })

  it('authenticates a DSH-local account without calling LDAP', async () => {
    const app = await mounted()
    const result = response()
    await app.routes.get('/auth/login')!.handler(request('/auth/login', {
      provider: 'local', username: 'bob', password: 'local-password',
    }), result.value)
    expect(app.authenticateLocal).toHaveBeenCalledWith('bob', 'local-password')
    expect(app.authenticate).not.toHaveBeenCalled()
    expect(result.state.status).toBe(200)
    expect(JSON.parse(result.state.body)).toEqual({ user: LOCAL_USER })
    expect(result.state.cookie).not.toContain('local-password')
    await app.dispose()
  })

  it('creates a gateway-local DSH account and issues its identity cookie', async () => {
    const app = await mounted()
    const registration = {
      username: 'alice', password: 'long-enough-password', displayName: 'Alice', email: 'alice@example.com',
    }
    const result = response()
    await app.routes.get('/auth/register')!.handler(request('/auth/register', registration), result.value)
    expect(app.createLocal).toHaveBeenCalledWith(registration)
    expect(result.state.status).toBe(201)
    expect(JSON.parse(result.state.body)).toEqual({ user: LOCAL_USER })
    expect(result.state.cookie).toContain('HttpOnly')
    await app.dispose()
  })
})
