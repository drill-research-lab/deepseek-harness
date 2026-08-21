import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { describe, expect, it } from 'vitest'
import * as HostOwnershipInvariant from '../src/invariant.ts'
import * as OwnershipInvariant from '../../../identity/ownership/src/invariant.ts'

describe('ownership invariant companions', () => {
  it('register their explained empty runtime invariants', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const ownership = await ctx.plugin(OwnershipInvariant)
    const provider = await ctx.plugin(HostOwnershipInvariant)
    expect(() => ctx.invariants.register('@deepseek-ai/dsh-ownership', () => {})).toThrow(/already registered/)
    expect(() => ctx.invariants.register('@deepseek-ai/dsh-host-ownership-file', () => {})).toThrow(/already registered/)
    await provider.dispose()
    await ownership.dispose()
    await ctx.fiber.dispose()
  })
})
