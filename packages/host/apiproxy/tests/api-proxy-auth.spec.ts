import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { AuthService, authenticatedUserId, type AuthenticatedUser } from '@deepseek-ai/dsh-auth'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { createApiProxy, RpcId, type RpcRequest } from '@deepseek-ai/dsh-host-apiproxy'

class TestAuthService extends AuthService {
  authenticateRequest(): Promise<AuthenticatedUser | undefined> {
    return Promise.resolve(undefined)
  }
}

const request: RpcRequest<{}> = { rpcId: RpcId('auth-me'), payload: {} }

async function harness() {
  const ctx = new Context()
  await ctx.plugin(TestAuthService)
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  return {
    ctx,
    api: createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
      cwd: '/tmp',
    }),
  }
}

describe('auth.me', () => {
  it('returns the identity from the current authenticated request scope', async () => {
    const { ctx, api } = await harness()
    const alice = { userId: authenticatedUserId('ldap:alice'), username: 'Alice', isAdmin: true }
    const bob = { userId: authenticatedUserId('ldap:bob'), username: 'Bob', isAdmin: false }

    await expect(ctx.auth.runAs(alice, () => api.auth.me(request))).resolves.toMatchObject({
      result: { ok: true, value: { userId: 'ldap:alice', username: 'Alice', isAdmin: true } },
    })
    await expect(ctx.auth.runAs(bob, () => api.auth.me(request))).resolves.toMatchObject({
      result: { ok: true, value: { userId: 'ldap:bob', username: 'Bob', isAdmin: false } },
    })
  })

  it('refuses invocation outside an authenticated request scope', async () => {
    const { api } = await harness()
    await expect(api.auth.me(request)).rejects.toThrow(/authenticated request scope/)
  })
})
