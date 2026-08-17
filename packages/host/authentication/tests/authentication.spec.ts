import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { CredentialProvider, CredentialRef } from '@deepseek-ai/dsh-credentials'
import { authenticatedUserId } from '@deepseek-ai/dsh-auth'
import { FileSessionStore } from '@deepseek-ai/dsh-auth/file-session-store'
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

async function mounted() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-host-session-'))
  const sessions = new FileSessionStore(join(root, 'sessions'))
  const ctx = new Context()
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
  } as unknown as CredentialProvider)
  const fiber = ctx.plugin(ExternalCookieAuthService, { sessionDirectory: sessions.directory })
  await fiber.await()
  return {
    auth: ctx.auth as ExternalCookieAuthService,
    sessions,
    dispose: async () => { await fiber.dispose(); await rm(root, { recursive: true, force: true }) },
  }
}

type Mounted = Awaited<ReturnType<typeof mounted>>

async function issued(app: Mounted, overrides: Record<string, unknown> = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const expiresAt = typeof overrides['exp'] === 'number' ? overrides['exp'] : now + 300
  const sessionId = await app.sessions.create({ userId: authenticatedUserId('ldap:uuid-alice'), username: 'alice' }, expiresAt)
  return token(pair.privateKey, sessionId, overrides)
}

describe('external identity cookie authentication', () => {
  it('accepts a valid LDAP identity cookie from the gateway', async () => {
    const app = await mounted()
    const valid = await issued(app)
    await expect(app.auth.authenticateRequest({
      headers: { cookie: `dsh_identity=${valid}` },
    })).resolves.toEqual({ userId: 'ldap:uuid-alice', username: 'alice' })
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
})
