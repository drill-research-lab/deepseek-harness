// Real gateway-issued cookies cross the shipping Host authentication carrier
// before the browser opens the assembled Settings UI.
import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { authenticatedUserId, type AuthenticatedUser } from '@deepseek-ai/dsh-auth'
import LocalAccountStore from '@deepseek-ai/dsh-auth-local'
import { CredentialProvider, type CredentialInfo, type CredentialRef, type ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import LdapAuthGateway from '../../../packages/identity/auth-gateway-ldap/src/index.ts'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, webSnapshotMode,
  WELCOME_NOTICE_COPY, type WebScaffold,
} from './scaffold.ts'
import { ZH_BROWSER_LOCALE } from './support.ts'

const MODE = webSnapshotMode()
const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/authenticated-settings', import.meta.url))
const ACCOUNT_EXPECTED = join(SNAPSHOT_DIR, 'account.expected.md')
const ISSUER = 'https://auth.islab.local'
const AUDIENCE = 'dsh'
const USERS = new Map<string, AuthenticatedUser>([
  ['alice', { userId: authenticatedUserId('ldap:alice'), username: 'Alice' }],
  ['bob', { userId: authenticatedUserId('ldap:bob'), username: 'Bob' }],
])
const credentialValues = new Map<string, string>()

class FixtureCredentials extends CredentialProvider {
  resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    const value = credentialValues.get(String(ref))
    return Promise.resolve(value === undefined ? undefined : { value, source: 'fixture' })
  }
  describe(ref: CredentialRef): Promise<CredentialInfo> {
    return Promise.resolve({ configured: credentialValues.has(String(ref)), source: 'fixture', writable: false })
  }
  set(): Promise<void> { return Promise.reject(new Error('fixture credentials are read-only')) }
  unset(): Promise<void> { return Promise.reject(new Error('fixture credentials are read-only')) }
}

class FixtureLdapDirectory extends Service {
  constructor(ctx: Context) { super(ctx, 'ldapDirectory') }
  authenticate(username: string, password: string): Promise<AuthenticatedUser | undefined> {
    return Promise.resolve(password === `${username}-password` ? USERS.get(username) : undefined)
  }
}

async function launchGateway(
  appUrl: string,
  sessionDirectory: string,
  privateKey: string,
  root: string,
): Promise<{ ctx: Context; baseUrl: string }> {
  credentialValues.set('AUTH_COOKIE_PRIVATE_KEY', privateKey)
  credentialValues.set('AUTH_COOKIE_ISSUER', ISSUER)
  credentialValues.set('AUTH_COOKIE_AUDIENCE', AUDIENCE)
  const ctx = new Context()
  await ctx.plugin(FixtureCredentials)
  await ctx.plugin(FixtureLdapDirectory)
  await ctx.plugin(LocalAccountStore, { path: join(root, 'accounts.json') })
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(LdapAuthGateway, {
    appUrl,
    cookieSecure: false,
    sessionDirectory,
  })
  return { ctx, baseUrl: `http://127.0.0.1:${String(ctx.webServer.port)}` }
}

async function loginCookie(baseUrl: string, username: string): Promise<string> {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ provider: 'ldap', username, password: `${username}-password` }),
  })
  expect(response.status).toBe(200)
  const cookie = response.headers.get('set-cookie')?.split(';', 1)[0]
  if (cookie === undefined) throw new Error(`authentication gateway did not issue a cookie for ${username}`)
  return cookie
}

async function currentUser(baseUrl: string, cookie: string, rpcId: string): Promise<unknown> {
  const response = await fetch(`${baseUrl}/api/auth.me`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ type: 'client-request', rpcId, method: 'auth.me', payload: {} }),
  })
  expect(response.status).toBe(200)
  const body: unknown = await response.json()
  if (typeof body === 'object' && body !== null && 'result' in body) {
    const result: unknown = body.result
    if (typeof result === 'object' && result !== null && 'ok' in result && result.ok === false) {
      throw new Error(`auth.me failed: ${JSON.stringify(body)}`)
    }
  }
  return body
}

describe('web e2e: authenticated account settings', () => {
  let root: string
  let scaffold: WebScaffold
  let gateway: Awaited<ReturnType<typeof launchGateway>>

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-authenticated-settings-'))
    const sessions = join(root, 'sessions')
    const pair = generateKeyPairSync('ed25519')
    const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    scaffold = await launchWebScaffold({
      authentication: { publicKey, issuer: ISSUER, audience: AUDIENCE, sessionDirectory: sessions },
    })
    gateway = await launchGateway(scaffold.baseUrl, sessions, privateKey, root)
  }, 120_000)

  afterAll(async () => {
    await gateway?.ctx.fiber.dispose()
    await scaffold?.close()
    if (root !== undefined) await rm(root, { recursive: true, force: true })
    credentialValues.clear()
  })

  it('keeps Alice and Bob isolated through gateway cookies and auth.me', async () => {
    const alice = await loginCookie(gateway.baseUrl, 'alice')
    const bob = await loginCookie(gateway.baseUrl, 'bob')

    await expect(currentUser(scaffold.baseUrl, alice, 'alice-1')).resolves.toMatchObject({
      result: { ok: true, value: { userId: 'ldap:alice', username: 'Alice' } },
    })
    await expect(currentUser(scaffold.baseUrl, bob, 'bob-1')).resolves.toMatchObject({
      result: { ok: true, value: { userId: 'ldap:bob', username: 'Bob' } },
    })
    await expect(currentUser(scaffold.baseUrl, alice, 'alice-2')).resolves.toMatchObject({
      result: { ok: true, value: { userId: 'ldap:alice', username: 'Alice' } },
    })
  })

  it('logs in and snapshots the account section through the assembled application', async () => {
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
      await page.goto(`${gateway.baseUrl}/auth/login`)
      const ldap = page.locator('#pane-ldap')
      await ldap.getByLabel('帳號').fill('alice')
      await ldap.getByLabel('密碼').fill('alice-password')
      await Promise.all([
        page.waitForURL(scaffold.baseUrl),
        ldap.getByRole('button', { name: '登入' }).click(),
      ])
      const welcome = page.getByRole('dialog', { name: WELCOME_NOTICE_COPY.zh.title })
      await welcome.getByRole('button', { name: WELCOME_NOTICE_COPY.zh.continueLabel }).click()
      await welcome.waitFor({ state: 'detached' })
      await page.getByRole('button', { name: '设置', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: '设置' })
      await dialog.getByText('Alice', { exact: true }).waitFor()
      const snapshot = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
      await compareOrRefreshGolden(ACCOUNT_EXPECTED, snapshot, MODE)
      expect(snapshot).toContain('Alice')
      expect(snapshot).toContain('登出')
    } finally {
      await browser.close()
    }
  })
})
