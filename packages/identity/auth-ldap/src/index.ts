import { Client } from 'ldapts'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { authenticatedUserId, type AuthenticatedUser } from '@deepseek-ai/dsh-auth'
import { credentialRef } from '@deepseek-ai/dsh-credentials'

/** LDAP authentication configuration for the external gateway. */
export interface Config {
  /** Credential reference containing the mandatory LDAPS server URL. */
  urlRef?: string
  /** Credential reference containing the LDAP subtree searched for identities. */
  baseDnRef?: string
  /** Credential reference containing the gateway service-account DN. */
  bindDnRef?: string
  /** Credential reference containing the gateway service-account password. */
  bindPasswordRef?: string
  /** Credential reference containing a filter template with `{{username}}`. */
  userSearchFilterRef?: string
  /** Credential reference naming the immutable LDAP identity attribute. */
  userIdAttributeRef?: string
  /** Credential reference naming the login and RDN attribute. */
  usernameAttributeRef?: string
  /** Maximum milliseconds allowed to establish an LDAP connection. */
  connectTimeoutMs?: number
  /** Maximum milliseconds allowed for one LDAP operation. */
  operationTimeoutMs?: number
}

export const Config: z<Config> = z.object({
  urlRef: z.string().default('LDAP_URL'),
  baseDnRef: z.string().default('LDAP_BASE_DN'),
  bindDnRef: z.string().default('LDAP_BIND_DN'),
  bindPasswordRef: z.string().default('LDAP_BIND_PASSWORD'),
  userSearchFilterRef: z.string().default('LDAP_USER_SEARCH_FILTER'),
  userIdAttributeRef: z.string().default('LDAP_USER_ID_ATTRIBUTE'),
  usernameAttributeRef: z.string().default('LDAP_USERNAME_ATTRIBUTE'),
  connectTimeoutMs: z.natural().min(1).default(10000),
  operationTimeoutMs: z.natural().min(1).default(10000),
})

export const inject = ['credentials']
export const name = 'auth-ldap'

type CredentialSettingKey = 'urlRef' | 'baseDnRef' | 'bindDnRef'
  | 'bindPasswordRef' | 'userSearchFilterRef' | 'userIdAttributeRef' | 'usernameAttributeRef'

function escapeFilter(value: string): string {
  return value.replace(/[\\*()\0]/g, character => `\\${character.charCodeAt(0).toString(16).padStart(2, '0')}`)
}

function firstString(value: unknown): string | undefined {
  const first: unknown = Array.isArray(value) ? (value as unknown[])[0] : value
  return typeof first === 'string' ? first : undefined
}

/** LDAP authentication for a separately deployed authentication gateway. */
export class LdapDirectory extends Service {
  static inject = ['credentials']
  constructor(ctx: Context, private readonly config: Config = {}) { super(ctx, 'ldapDirectory') }

  private async setting(key: CredentialSettingKey, fallback: string): Promise<string> {
    const ref = credentialRef(this.config[key] ?? fallback)
    this.ctx.credentials.reserveDeployment(ref)
    const found = await this.ctx.credentials.resolve(ref)
    if (found === undefined) throw new Error(`auth-ldap: ${ref} is not configured`)
    return found.value
  }

  private client(url: string): Client {
    if (!url.startsWith('ldaps://')) throw new Error('auth-ldap: LDAP_URL must use ldaps://')
    return new Client({
      url,
      connectTimeout: this.config.connectTimeoutMs ?? 10000,
      timeout: this.config.operationTimeoutMs ?? 10000,
      tlsOptions: { ecdhCurve: 'X25519:prime256v1' },
    })
  }

  private identity(entry: Record<string, unknown>, idAttribute: string, usernameAttribute: string): AuthenticatedUser {
    const userId = firstString(entry[idAttribute])
    const username = firstString(entry[usernameAttribute])
    if (userId === undefined || username === undefined) {
      throw new Error('auth-ldap: matched entry lacks configured identity attributes')
    }
    return { userId: authenticatedUserId(`ldap:${userId}`), username }
  }

  /**
   * Verify a password directly against LDAP inside the authentication gateway process.
   * @param username - LDAP login name collected by the gateway.
   * @param password - Password collected by the gateway and discarded after bind.
   * @returns The stable LDAP identity, or undefined when the credentials do not match one entry.
   */
  async authenticate(username: string, password: string): Promise<AuthenticatedUser | undefined> {
    if (username.length === 0 || password.length === 0) return undefined
    const [url, baseDN, bindDN, bindPassword, template, idAttribute, usernameAttribute] = await Promise.all([
      this.setting('urlRef', 'LDAP_URL'), this.setting('baseDnRef', 'LDAP_BASE_DN'),
      this.setting('bindDnRef', 'LDAP_BIND_DN'), this.setting('bindPasswordRef', 'LDAP_BIND_PASSWORD'),
      this.setting('userSearchFilterRef', 'LDAP_USER_SEARCH_FILTER'),
      this.setting('userIdAttributeRef', 'LDAP_USER_ID_ATTRIBUTE'),
      this.setting('usernameAttributeRef', 'LDAP_USERNAME_ATTRIBUTE'),
    ])
    if (!template.includes('{{username}}')) throw new Error('auth-ldap: LDAP_USER_SEARCH_FILTER must contain {{username}}')
    const service = this.client(url)
    try {
      await service.bind(bindDN, bindPassword)
      const result = await service.search(baseDN, {
        scope: 'sub', filter: template.replaceAll('{{username}}', escapeFilter(username)),
        attributes: [idAttribute, usernameAttribute], sizeLimit: 2,
      })
      if (result.searchEntries.length !== 1) {
        this.ctx.logger.warn('auth-ldap: login search returned %d entries', result.searchEntries.length)
        return undefined
      }
      const entry = result.searchEntries[0]
      if (entry === undefined) return undefined
      const user = this.client(url)
      try {
        await user.bind(entry.dn, password)
      } catch (error) {
        const code = (error as { code?: unknown }).code
        const name = error instanceof Error ? error.name : typeof error
        const reportedCode = typeof code === 'string' || typeof code === 'number' ? String(code) : typeof code
        this.ctx.logger.warn('auth-ldap: user bind failed (error=%s code=%s)', name, reportedCode)
        if (code === 49) return undefined
        throw error
      } finally {
        await user.unbind().catch(() => {})
      }
      this.ctx.logger.info('auth-ldap: user bind succeeded')
      return this.identity(entry, idAttribute, usernameAttribute)
    } finally {
      await service.unbind().catch(() => {})
    }
  }

}

declare module '@deepseek-ai/cordis' {
  interface Context {
    ldapDirectory: LdapDirectory
  }
}

export default LdapDirectory
