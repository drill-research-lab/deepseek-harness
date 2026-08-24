import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import DevAuthService from '../src/index.ts'

describe('dsh-auth-dev', () => {
  it('provides a stable loopback user on ctx.auth', async () => {
    const ctx = new Context()
    await ctx.plugin(DevAuthService)
    const user = await ctx.auth.authenticateRequest({ headers: {} })
    expect(user).toBeDefined()
    expect(user?.username).toBe('local')
    expect(user?.userId).toBeTruthy()
    expect(ctx.auth.currentUser()).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('uses a configured username', async () => {
    const ctx = new Context()
    await ctx.plugin(DevAuthService, { username: 'dev-user' })
    const user = await ctx.auth.authenticateRequest({ headers: {} })
    expect(user?.username).toBe('dev-user')
    await ctx.fiber.dispose()
  })
})
