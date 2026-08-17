import { Context } from '@deepseek-ai/cordis'
import type { Client } from 'ldapts'
import { describe, expect, it, vi } from 'vitest'
import type { CredentialProvider, CredentialRef } from '@deepseek-ai/dsh-credentials'
import LdapDirectory from '../src/index.ts'

const SETTINGS: Record<string, string> = {
  LDAP_URL: 'ldaps://ldap.islab.local:636',
  LDAP_BASE_DN: 'dc=islab,dc=local',
  LDAP_BIND_DN: 'uid=gateway,ou=people,dc=islab,dc=local',
  LDAP_BIND_PASSWORD: 'gateway-secret',
  LDAP_USER_SEARCH_FILTER: '(uid={{username}})',
  LDAP_USER_ID_ATTRIBUTE: 'entryUUID',
  LDAP_USERNAME_ATTRIBUTE: 'uid',
}

async function mounted(): Promise<{ directory: LdapDirectory; dispose(): Promise<void> }> {
  const ctx = new Context()
  ctx.provide('credentials', {
    resolve: async (ref: CredentialRef) => {
      const value = SETTINGS[String(ref)]
      return value === undefined ? undefined : { value, source: 'test' }
    },
  } as unknown as CredentialProvider)
  const fiber = ctx.plugin(LdapDirectory)
  await fiber.await()
  return { directory: ctx.ldapDirectory, dispose: () => fiber.dispose() }
}

describe('LDAP gateway directory', () => {
  it('searches with the service account and verifies the user password by LDAP bind', async () => {
    const app = await mounted()
    const serviceBind = vi.fn(async () => {})
    const service = {
      bind: serviceBind,
      search: vi.fn(async () => ({ searchEntries: [{
        dn: 'uid=alice,ou=people,dc=islab,dc=local', entryUUID: 'uuid-alice', uid: 'alice',
      }] })),
      unbind: vi.fn(async () => {}),
    } as unknown as Client
    const userBind = vi.fn(async () => {})
    const user = { bind: userBind, unbind: vi.fn(async () => {}) } as unknown as Client
    const internal = app.directory as unknown as { client(url: string): Client }
    vi.spyOn(internal, 'client').mockReturnValueOnce(service).mockReturnValueOnce(user)

    await expect(app.directory.authenticate('alice', 'correct')).resolves.toEqual({
      userId: 'ldap:uuid-alice', username: 'alice',
    })
    expect(serviceBind).toHaveBeenCalledWith(SETTINGS.LDAP_BIND_DN, SETTINGS.LDAP_BIND_PASSWORD)
    expect(userBind).toHaveBeenCalledWith('uid=alice,ou=people,dc=islab,dc=local', 'correct')
    await app.dispose()
  })
})
