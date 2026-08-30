import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as PipelineInvariant from '@deepseek-ai/dsh-pipeline/invariant'

describe('pipeline invariant companion', () => {
  it('installs the empty startup check and disposes cleanly', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(PipelineInvariant)
    expect(typeof fiber.dispose).toBe('function')
    await fiber.dispose()
  })
})
