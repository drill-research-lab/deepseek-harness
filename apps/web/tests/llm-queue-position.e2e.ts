// Real Web composition: the admin-only LLM queue management page. LDAP-issued
// cookies drive one admin and one non-admin identity through the shipping
// authentication carrier; the assembled application already composes the
// real `llmAdmissionQueue` plugin (packages/bundle/base, limit 1), so `queue.list`
// answers a genuine (empty, absent any in-flight request) snapshot rather
// than a fixture. The scenario issues no model calls, so no replay fixture
// is installed (LaunchOptions.replayFixture is omitted).
//
// Scope note (see the feature's final report): a genuinely *waiting* queue
// entry requires two real, overlapping top-level session turns sharing the
// admission queue's concurrency limit — `installLlmReplay` binds a live
// session to the next unclaimed script in ONE fixture file in claim order
// (packages/test-support/llm-replay/src/index.ts), which a hand-authored
// two-script fixture could drive but was not attempted here. This scenario
// instead exercises the real permission gate (frontend hiding AND the
// server-side `forbidden` a direct RPC call still hits) and the real,
// connected (if empty) admin page render.
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
const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/llm-queue-position', import.meta.url))
const ADMIN_PAGE_EXPECTED = join(SNAPSHOT_DIR, 'admin-page.expected.md')
const ISSUER = 'https://auth.islab.local'
const AUDIENCE = 'dsh'
const USERS = new Map<string, AuthenticatedUser>([
  ['root', { userId: authenticatedUserId('ldap:root'), username: 'Root', isAdmin: true }],
  ['carol', { userId: authenticatedUserId('ldap:carol'), username: 'Carol', isAdmin: false }],
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

/** Call one apiproxy RPC method directly (bypassing the browser client entirely) with a given identity cookie. */
async function callRpc(baseUrl: string, cookie: string, method: string, rpcId: string, payload: unknown = {}): Promise<unknown> {
  const response = await fetch(`${baseUrl}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
  })
  expect(response.status).toBe(200)
  return response.json()
}

describe('web e2e: admin LLM queue management', () => {
  let root: string
  let scaffold: WebScaffold
  let gateway: Awaited<ReturnType<typeof launchGateway>>

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-llm-queue-position-'))
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

  it('still refuses queue.list and queue.reorder for a non-admin identity called directly, bypassing the frontend entirely', async () => {
    const carol = await loginCookie(gateway.baseUrl, 'carol')

    const listResponse = await callRpc(scaffold.baseUrl, carol, 'queue.list', 'carol-list')
    expect(listResponse).toMatchObject({
      result: { ok: false, error: { code: 'forbidden' } },
    })

    const reorderResponse = await callRpc(scaffold.baseUrl, carol, 'queue.reorder', 'carol-reorder', { orderedQueueIds: ['whatever'] })
    expect(reorderResponse).toMatchObject({
      result: { ok: false, error: { code: 'forbidden' } },
    })
  })

  it('answers an admin identity called directly with the real (empty) queue snapshot', async () => {
    const root_ = await loginCookie(gateway.baseUrl, 'root')
    const listResponse = await callRpc(scaffold.baseUrl, root_, 'queue.list', 'root-list')
    expect(listResponse).toMatchObject({
      result: { ok: true, value: { entries: [] } },
    })
  })

  it('hides the queue management entry from a non-admin browser session', async () => {
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
      await page.goto(`${gateway.baseUrl}/auth/login`)
      const ldap = page.locator('#pane-ldap')
      await ldap.getByLabel('帳號').fill('carol')
      await ldap.getByLabel('密碼').fill('carol-password')
      await Promise.all([
        page.waitForURL(scaffold.baseUrl),
        ldap.getByRole('button', { name: '登入' }).click(),
      ])
      const welcome = page.getByRole('dialog', { name: WELCOME_NOTICE_COPY.zh.title })
      await welcome.getByRole('button', { name: WELCOME_NOTICE_COPY.zh.continueLabel }).click()
      await welcome.waitFor({ state: 'detached' })
      await page.getByRole('button', { name: '设置', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: '设置' })
      await dialog.getByText('Carol', { exact: true }).waitFor()
      expect(await dialog.getByRole('button', { name: '排队管理' }).count()).toBe(0)
    } finally {
      await browser.close()
    }
  })

  it('shows an admin the real, connected (empty) queue page through the assembled application', async () => {
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
      await page.goto(`${gateway.baseUrl}/auth/login`)
      const ldap = page.locator('#pane-ldap')
      await ldap.getByLabel('帳號').fill('root')
      await ldap.getByLabel('密碼').fill('root-password')
      await Promise.all([
        page.waitForURL(scaffold.baseUrl),
        ldap.getByRole('button', { name: '登入' }).click(),
      ])
      const welcome = page.getByRole('dialog', { name: WELCOME_NOTICE_COPY.zh.title })
      await welcome.getByRole('button', { name: WELCOME_NOTICE_COPY.zh.continueLabel }).click()
      await welcome.waitFor({ state: 'detached' })
      await page.getByRole('button', { name: '设置', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: '设置' })
      await dialog.getByRole('button', { name: '排队管理' }).click()
      await dialog.getByText('目前没有排队或运行中的请求。').waitFor({ timeout: 10_000 })

      const snapshot = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
      await compareOrRefreshGolden(ADMIN_PAGE_EXPECTED, snapshot, MODE)
      expect(snapshot).toContain('目前没有排队或运行中的请求。')
    } finally {
      await browser.close()
    }
  })
})
