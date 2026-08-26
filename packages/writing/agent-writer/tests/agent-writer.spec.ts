import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SubagentRun } from '@deepseek-ai/dsh-subagent'
import { startInProcessRun } from '@deepseek-ai/dsh-subagent-in-process-driver'
import * as agentWriter from '../src/index.ts'

vi.mock('@deepseek-ai/dsh-subagent-in-process-driver', () => ({
  startInProcessRun: vi.fn(),
}))

const runtimes: Context[] = []
const mockedStart = vi.mocked(startInProcessRun)

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
  mockedStart.mockReset()
  await Promise.all(runtimes.splice(0).map(ctx => ctx.fiber.dispose()))
})

function fakeRun(): SubagentRun {
  return {
    id: SessionId('run-1'),
    localAgent: undefined,
    result: Promise.resolve({ output: [], stopReason: 'completed' }),
    dispose: () => Promise.resolve(),
  }
}

function fakeRequest(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    prompt: [],
    parent: {} as Agent,
    signal: new AbortController().signal,
    descriptor: {},
    ...over,
  }
}

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

  it('forces the writing persona and delegates to the in-process driver', async () => {
    mockedStart.mockResolvedValue(fakeRun())
    const ctx = await setup({ persona: 'WRITER_PERSONA' })
    const provider = ctx.subagents.getProvider('writer')
    expect(provider).toBeDefined()

    const run = await provider!.start(fakeRequest() as never)
    expect(mockedStart).toHaveBeenCalledTimes(1)
    expect(mockedStart.mock.calls[0]?.[0]).toMatchObject({ persona: 'WRITER_PERSONA' })
    expect(run).toBeDefined()
  })

  it('appends a caller persona after the writing persona', async () => {
    mockedStart.mockResolvedValue(fakeRun())
    const ctx = await setup({ persona: 'WRITER_PERSONA' })
    const provider = ctx.subagents.getProvider('writer')
    const run = await provider!.start(fakeRequest({ persona: 'CALLER' }) as never)
    expect(mockedStart.mock.calls[0]?.[0]).toMatchObject({ persona: 'WRITER_PERSONA\n\nCALLER' })
    expect(run).toBeDefined()
  })
})
