#!/usr/bin/env node
import { join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import CredentialsLocal from '@deepseek-ai/dsh-credentials-local'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import LdapDirectory from '@deepseek-ai/dsh-auth-ldap'
import LocalAccountStore from '@deepseek-ai/dsh-auth-local'
import LdapAuthGateway from './index.ts'

function booleanSetting(name: string, fallback: boolean): boolean {
  const value = process.env[name]
  if (value === undefined) return fallback
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`${name} must be true or false`)
}

function portSetting(): number {
  const value = process.env['DSH_AUTH_PORT'] ?? '3081'
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('DSH_AUTH_PORT must be an integer from 1 to 65535')
  return port
}

/* v8 ignore start -- executable composition; package tests cover each mounted provider. */
async function main(): Promise<void> {
  const requestedHome = process.env['DSH_AUTH_HOME']
  if (requestedHome === undefined || requestedHome.length === 0) {
    throw new Error('DSH_AUTH_HOME is required and must be separate from DSH_HOME')
  }
  const authHome = resolve(requestedHome)
  const dshHome = process.env['DSH_HOME'] === undefined ? undefined : resolve(process.env['DSH_HOME'])
  if (dshHome === authHome) throw new Error('DSH_AUTH_HOME must not equal DSH_HOME')

  const ctx = new Context()
  await ctx.plugin(CredentialsLocal, { dshHome: authHome, watch: true })
  await ctx.plugin(LdapDirectory)
  await ctx.plugin(LocalAccountStore, { path: join(authHome, 'accounts.json') })
  const port = portSetting()
  await ctx.plugin(WebServer, { host: booleanSetting('DSH_AUTH_PUBLIC', false) ? '0.0.0.0' : '127.0.0.1', port })
  await ctx.plugin(LdapAuthGateway, {
    sessionDirectory: join(authHome, 'sessions'),
    cookieSecure: booleanSetting('AUTH_COOKIE_SECURE', true),
    registrationEnabled: booleanSetting('DSH_LOCAL_REGISTRATION_ENABLED', false),
    appUrl: process.env['DSH_APP_URL'] ?? 'http://127.0.0.1:3080/',
  })

  let closing = false
  const close = async (code: number): Promise<void> => {
    if (closing) return
    closing = true
    try { await ctx.fiber.dispose() } finally { process.exit(code) }
  }
  process.on('SIGTERM', () => { void close(0) })
  process.on('SIGINT', () => { void close(130) })
  process.stdout.write(`LDAP authentication gateway listening on port ${String(port)}\n`)
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
/* v8 ignore stop */
