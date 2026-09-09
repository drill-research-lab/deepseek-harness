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
    reserveDeployment: () => {},
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
      userId: 'ldap:uuid-alice', username: 'alice', isAdmin: false,
    })
    expect(serviceBind).toHaveBeenCalledWith(SETTINGS.LDAP_BIND_DN, SETTINGS.LDAP_BIND_PASSWORD)
    expect(userBind).toHaveBeenCalledWith('uid=alice,ou=people,dc=islab,dc=local', 'correct')
    await app.dispose()
  })

  it('requests memberOf in the login search', async () => {
    const app = await mounted()
    const search = vi.fn(async () => ({ searchEntries: [{
      dn: 'uid=alice,ou=people,dc=islab,dc=local', entryUUID: 'uuid-alice', uid: 'alice',
    }] }))
    const service = { bind: vi.fn(async () => {}), search, unbind: vi.fn(async () => {}) } as unknown as Client
    const user = { bind: vi.fn(async () => {}), unbind: vi.fn(async () => {}) } as unknown as Client
    vi.spyOn(app.directory as unknown as { client(url: string): Client }, 'client')
      .mockReturnValueOnce(service).mockReturnValueOnce(user)
    await app.directory.authenticate('alice', 'correct')
    expect(search).toHaveBeenCalledWith(SETTINGS.LDAP_BASE_DN, expect.objectContaining({
      attributes: ['entryUUID', 'uid', 'memberOf'],
    }))
    await app.dispose()
  })
})

describe('LDAP gateway directory — admin membership', () => {
  /** Authenticate one user whose entry carries the given raw `memberOf` value. */
  async function authenticateWithMemberOf(memberOf: unknown): Promise<{ isAdmin: boolean } | undefined> {
    const app = await mounted()
    const entry: Record<string, unknown> = {
      dn: 'uid=alice,ou=people,dc=islab,dc=local', entryUUID: 'uuid-alice', uid: 'alice',
    }
    if (memberOf !== undefined) entry['memberOf'] = memberOf
    const service = {
      bind: vi.fn(async () => {}),
      search: vi.fn(async () => ({ searchEntries: [entry] })),
      unbind: vi.fn(async () => {}),
    } as unknown as Client
    const user = { bind: vi.fn(async () => {}), unbind: vi.fn(async () => {}) } as unknown as Client
    vi.spyOn(app.directory as unknown as { client(url: string): Client }, 'client')
      .mockReturnValueOnce(service).mockReturnValueOnce(user)
    try {
      return await app.directory.authenticate('alice', 'correct')
    } finally {
      await app.dispose()
    }
  }

  const ADMIN_DN = 'cn=lldap_admin,ou=groups,dc=islab,dc=local'
  const OTHER_DN = 'cn=lldap_unix_user,ou=groups,dc=islab,dc=local'

  it('marks isAdmin true for a single-group string memberOf naming lldap_admin', async () => {
    await expect(authenticateWithMemberOf(ADMIN_DN)).resolves.toEqual({
      userId: 'ldap:uuid-alice', username: 'alice', isAdmin: true,
    })
  })

  it('marks isAdmin true when lldap_admin appears in a multi-group array', async () => {
    await expect(authenticateWithMemberOf([OTHER_DN, ADMIN_DN])).resolves.toMatchObject({ isAdmin: true })
  })

  it('marks isAdmin false when memberOf lists only non-admin groups', async () => {
    await expect(authenticateWithMemberOf([OTHER_DN])).resolves.toMatchObject({ isAdmin: false })
  })

  it('marks isAdmin false when the entry has no memberOf at all', async () => {
    await expect(authenticateWithMemberOf(undefined)).resolves.toMatchObject({ isAdmin: false })
  })

  it('normalizes case: CN=LLDAP_ADMIN with a mixed-case cn is still admin', async () => {
    await expect(authenticateWithMemberOf('CN=LLDAP_ADMIN,OU=Groups,DC=islab,DC=local'))
      .resolves.toMatchObject({ isAdmin: true })
  })

  it('does not treat a non-cn RDN or a substring match as admin', async () => {
    await expect(authenticateWithMemberOf([
      'ou=lldap_admin,dc=islab,dc=local',
      'cn=lldap_admin_readonly,ou=groups,dc=islab,dc=local',
    ])).resolves.toMatchObject({ isAdmin: false })
  })
})
