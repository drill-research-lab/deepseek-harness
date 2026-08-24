import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as WriterInvariant from '../src/invariant.ts'

describe('agent-writer invariants', () => {
  it('registers the companion and runs the install', async () => {
    const ctx = new Context()
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(WriterInvariant)).resolves.toBeDefined()
    await new Promise(resolve => setImmediate(resolve))
    await ctx.fiber.dispose()
  })
})
