import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as agentWriter from '../src/index.ts'

const runtimes: Context[] = []

async function setup(config: { providerName?: string; persona?: string } = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(agentWriter, {
    providerName: config.providerName ?? 'writer',
    persona: config.persona ?? 'You are the Writing agent.',
  })
  runtimes.push(ctx)
  return ctx
}

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map(ctx => ctx.fiber.dispose()))
})

describe('dsh-agent-writer', () => {
  it('registers a `writer` provider with the spawn-like capabilities', async () => {
    const ctx = await setup()
    const provider = ctx.subagents.getProvider('writer')
    expect(provider).toBeDefined()
    expect(provider?.name).toBe('writer')
    expect(provider?.inheritsParentContext).toBe(false)
    expect(provider?.capabilities).toEqual({
      outputSchema: true,
      depthLimit: true,
      toolFilter: true,
      persona: true,
    })
  })

  it('registers under a configured provider name', async () => {
    const ctx = await setup({ providerName: 'academic-writer' })
    expect(ctx.subagents.getProvider('academic-writer')).toBeDefined()
    expect(ctx.subagents.getProvider('writer')).toBeUndefined()
  })

  it('emits provider-added with the writer provider', async () => {
    const ctx = new Context()
    const added: string[] = []
    ctx.on('subagent/provider-added', (provider) => { added.push(provider.name) })
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(agentWriter, { providerName: 'writer', persona: 'p' })
    expect(added).toContain('writer')
    await ctx.fiber.dispose()
    runtimes.push(ctx)
  })
})
