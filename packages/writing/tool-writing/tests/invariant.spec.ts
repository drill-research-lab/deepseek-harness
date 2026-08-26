import { describe, expect, it } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as ToolInvariant from '../src/invariant.ts'
import { setupHarness } from './helpers.ts'

describe('tool-writing invariants', () => {
  it('registers the companion and runs the install', async () => {
    const { ctx, dispose } = await setupHarness()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(ToolInvariant)).resolves.toBeDefined()
    await new Promise(resolve => setImmediate(resolve))
    await dispose()
  })
})
