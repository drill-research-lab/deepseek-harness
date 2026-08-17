/**
 * REAL-composition browser coverage: a test-only cordis.yml boots the shipping
 * Gateway, WebServer, and local-account provider through Loader. Chromium then
 * submits the rendered forms over real HTTP, including the opaque-Origin case
 * observed on remote Chrome.
 */

import { createHash, generateKeyPairSync } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context, Service } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { afterEach, describe, expect, it } from 'vitest'
import { chromium, type Browser } from 'playwright'
import { authenticatedUserId, type AuthenticatedUser } from '@deepseek-ai/dsh-auth'
import { CredentialProvider, type CredentialInfo, type CredentialRef, type ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import LocalAccountStore from '@deepseek-ai/dsh-auth-local'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import LdapAuthGateway from '../../../packages/identity/auth-gateway-ldap/src/index.ts'

const LDAP_USER: AuthenticatedUser = { userId: authenticatedUserId('ldap:browser-uuid'), username: 'browser-user' }
const values = new Map<string, string>()

class FixtureCredentials extends CredentialProvider {
  resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    const value = values.get(String(ref))
    return Promise.resolve(value === undefined ? undefined : { value, source: 'fixture' })
  }
  describe(ref: CredentialRef): Promise<CredentialInfo> {
    return Promise.resolve({ configured: values.has(String(ref)), source: 'fixture', writable: false })
  }
  set(): Promise<void> { return Promise.reject(new Error('fixture credentials are read-only')) }
  unset(): Promise<void> { return Promise.reject(new Error('fixture credentials are read-only')) }
}

class FixtureLdapDirectory extends Service {
  constructor(ctx: Context) { super(ctx, 'ldapDirectory') }
  authenticate(username: string, password: string): Promise<AuthenticatedUser | undefined> {
    return Promise.resolve(username === 'browser-user' && password === 'browser-password' ? LDAP_USER : undefined)
  }
}

let root: string | undefined
let context: Context | undefined
let browser: Browser | undefined
let dshServer: Server | undefined

afterEach(async () => {
  await browser?.close()
  browser = undefined
  if (dshServer !== undefined) await new Promise<void>((resolve, reject) => {
    dshServer!.close((error) => { if (error) reject(error); else resolve() })
  })
  dshServer = undefined
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  values.clear()
})

async function loadGateway(): Promise<{ baseUrl: string; accounts: string; sessions: string; dshUrl: string }> {
  root = await mkdtemp(join(tmpdir(), 'dsh-auth-browser-'))
  const accounts = join(root, 'accounts.json')
  const sessions = join(root, 'sessions')
  dshServer = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<h1>DSH authenticated home</h1>')
  })
  await new Promise<void>((resolve, reject) => {
    dshServer!.once('error', reject)
    dshServer!.listen(0, '127.0.0.1', resolve)
  })
  const dshAddress = dshServer.address()
  if (dshAddress === null || typeof dshAddress === 'string') throw new Error('DSH fixture did not bind TCP')
  const dshUrl = `http://127.0.0.1:${String(dshAddress.port)}/`
  const pair = generateKeyPairSync('ed25519')
  values.set('AUTH_COOKIE_PRIVATE_KEY', pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString())
  values.set('AUTH_COOKIE_ISSUER', 'https://auth.islab.local')
  values.set('AUTH_COOKIE_AUDIENCE', 'dsh')
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@fixture/credentials'",
    "- name: '@fixture/ldap'",
    "- name: '@deepseek-ai/dsh-auth-local'",
    '  config:',
    `    path: '${accounts}'`,
    "- name: '@deepseek-ai/dsh-host-webserver'",
    '  config:',
    "    host: '127.0.0.1'",
    '    port: 0',
    "- name: '@deepseek-ai/dsh-auth-gateway-ldap'",
    '  inject: [webServer]',
    '  config:',
    '    cookieSecure: false',
    '    registrationEnabled: true',
    `    sessionDirectory: '${sessions}'`,
    `    appUrl: '${dshUrl}'`,
    '',
  ].join('\n'))
  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@fixture/credentials', FixtureCredentials],
    ['@fixture/ldap', FixtureLdapDirectory],
    ['@deepseek-ai/dsh-auth-local', LocalAccountStore],
    ['@deepseek-ai/dsh-host-webserver', WebServer],
    ['@deepseek-ai/dsh-auth-gateway-ldap', LdapAuthGateway],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await context.loader.await()
  return { baseUrl: `http://127.0.0.1:${String(context.webServer.port)}`, accounts, sessions, dshUrl }
}

describe('authentication gateway in Chromium', () => {
  it('logs in through LDAP with normal and null Origin and registers a local account', { timeout: 60_000 }, async () => {
    const { baseUrl, accounts, sessions, dshUrl } = await loadGateway()
    browser = await chromium.launch()
    const browserContext = await browser.newContext()
    const page = await browserContext.newPage()

    let browserOrigin: string | undefined
    page.on('request', (request) => {
      if (request.url() === `${baseUrl}/auth/login` && request.method() === 'POST') {
        browserOrigin = request.headers()['origin']
      }
    })
    await page.goto(`${baseUrl}/auth/login`)
    const ldap = page.locator('section').filter({ hasText: 'LDAP' })
    await ldap.getByLabel('帳號').fill('browser-user')
    await ldap.getByLabel('密碼').fill('browser-password')
    const loginResponse = page.waitForResponse(response => response.url() === `${baseUrl}/auth/login`
      && response.request().method() === 'POST')
    await ldap.getByRole('button', { name: '登入' }).click()
    expect((await loginResponse).status()).toBe(303)
    expect(page.url()).toBe(dshUrl)
    expect(await page.getByRole('heading').textContent()).toBe('DSH authenticated home')
    expect(browserOrigin).toBe('null')
    const ldapCookie = (await browserContext.cookies(baseUrl)).find(cookie => cookie.name === 'dsh_identity')
    expect(ldapCookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', secure: false })
    const ldapPayload = JSON.parse(Buffer.from(ldapCookie!.value.split('.')[1]!, 'base64url').toString('utf8')) as Record<string, unknown>
    expect(ldapPayload).toMatchObject({
      v: 1, iss: 'https://auth.islab.local', aud: 'dsh', sub: 'ldap:browser-uuid', username: 'browser-user',
    })
    expect(ldapPayload['exp']).toBe((ldapPayload['iat'] as number) + 300)
    expect(JSON.stringify(ldapPayload)).not.toContain('browser-password')

    await browserContext.clearCookies()
    await page.route(`${baseUrl}/auth/login`, async (route) => {
      if (route.request().method() === 'POST') {
        await route.continue({ headers: { ...route.request().headers(), origin: 'null' } })
      } else await route.continue()
    })
    await page.goto(`${baseUrl}/auth/login`)
    await ldap.getByLabel('帳號').fill('browser-user')
    await ldap.getByLabel('密碼').fill('browser-password')
    const nullOriginResponse = page.waitForResponse(response => response.url() === `${baseUrl}/auth/login`
      && response.request().method() === 'POST')
    await ldap.getByRole('button', { name: '登入' }).click()
    expect((await nullOriginResponse).status()).toBe(303)
    const activeLdapCookie = (await browserContext.cookies(baseUrl)).find(cookie => cookie.name === 'dsh_identity')
    expect(activeLdapCookie).toBeDefined()
    const activePayload = JSON.parse(Buffer.from(activeLdapCookie!.value.split('.')[1]!, 'base64url').toString('utf8')) as Record<string, unknown>
    const activeSessionName = `${createHash('sha256').update(String(activePayload['sid'])).digest('hex')}.json`
    expect(await readdir(sessions)).toContain(activeSessionName)
    expect((await stat(join(sessions, activeSessionName))).mode & 0o777).toBe(0o600)
    expect(await readFile(join(sessions, activeSessionName), 'utf8')).not.toContain(activeLdapCookie!.value)
    expect((await stat(sessions)).mode & 0o777).toBe(0o700)
    await page.unroute(`${baseUrl}/auth/login`)

    const me = await page.goto(`${baseUrl}/auth/me`)
    expect(me?.status()).toBe(200)
    expect(JSON.parse(await page.textContent('body') ?? '')).toEqual({ authenticated: true, user: LDAP_USER })
    const logout = await page.evaluate(async () => {
      const response = await fetch('/auth/logout', { method: 'POST' })
      const body: unknown = JSON.parse(await response.text())
      return { status: response.status, body }
    })
    expect(logout).toEqual({ status: 200, body: { authenticated: false } })
    expect(await readdir(sessions)).not.toContain(activeSessionName)
    expect((await browserContext.cookies(baseUrl)).some(cookie => cookie.name === 'dsh_identity')).toBe(false)
    const requestAfterLogout = await page.goto(`${baseUrl}/auth/me`)
    expect(requestAfterLogout?.status()).toBe(401)
    const replay = await fetch(`${baseUrl}/auth/me`, { headers: { cookie: `dsh_identity=${activeLdapCookie!.value}` } })
    expect(replay.status).toBe(401)
    expect(await replay.json()).toEqual({ authenticated: false })

    await page.goto(`${baseUrl}/auth/register`)
    await page.getByLabel('帳號').fill('local-user')
    await page.getByLabel('顯示名稱').fill('Local User')
    await page.getByLabel('Email').fill('local@example.com')
    await page.getByLabel('密碼（至少 12 個字元）').fill('local-browser-password')
    const registerResponse = page.waitForResponse(response => response.url() === `${baseUrl}/auth/register`
      && response.request().method() === 'POST')
    await page.getByRole('button', { name: '建立' }).click()
    expect((await registerResponse).status()).toBe(303)
    const stored = await readFile(accounts, 'utf8')
    expect(stored).toContain('local-user')
    expect(stored).not.toContain('local-browser-password')
    expect((await stat(accounts)).mode & 0o777).toBe(0o600)

    await browserContext.clearCookies()
    await page.goto(`${baseUrl}/auth/login`)
    const local = page.locator('section').filter({ hasText: '一般帳號' })
    await local.getByLabel('帳號').fill('local-user')
    await local.getByLabel('密碼').fill('local-browser-password')
    const localLoginResponse = page.waitForResponse(response => response.url() === `${baseUrl}/auth/login`
      && response.request().method() === 'POST')
    await local.getByRole('button', { name: '登入' }).click()
    expect((await localLoginResponse).status()).toBe(303)
    const localCookie = (await browserContext.cookies(baseUrl)).find(cookie => cookie.name === 'dsh_identity')
    const localPayload = JSON.parse(Buffer.from(localCookie!.value.split('.')[1]!, 'base64url').toString('utf8')) as Record<string, unknown>
    expect(localPayload).toMatchObject({ username: 'local-user' })
    expect(localPayload['sub']).toMatch(/^local:/)
  })
})
