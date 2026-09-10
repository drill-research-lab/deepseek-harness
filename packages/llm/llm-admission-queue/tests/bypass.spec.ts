import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MockInstance } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { AdmissionQueue } from '../src/queue.ts'
import * as AdmissionQueuePlugin from '../src/index.ts'

const CHUNKS: StreamChunk[] = [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'text-delta', index: 0, text: 'ok' },
  { type: 'block-end', index: 0, block: { type: 'text', text: 'ok' } },
  { type: 'finish', reason: { kind: 'stop' } },
]

class ScriptedAdapter extends LlmAdapter {
  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield* CHUNKS
  }
}

/** A scripted adapter whose stream blocks until `release()` is called, so a slot can be held open. */
class BlockingAdapter extends LlmAdapter {
  private readonly gate = Promise.withResolvers<undefined>()
  release(): void { this.gate.resolve(undefined) }
  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    await this.gate.promise
    yield* CHUNKS
  }
}

let context: Context | undefined
let enqueueSpy: MockInstance | undefined

afterEach(async () => {
  enqueueSpy?.mockRestore()
  enqueueSpy = undefined
  await context?.fiber.dispose()
  context = undefined
})

async function mount(
  config: { limit: number; gatedProviders: string[] },
  opts: { gatedAdapter?: LlmAdapter } = {},
): Promise<Context> {
  const ctx = new Context()
  context = ctx
  await ctx.plugin(LlmRuntime)
  // The internal route may be held open by a blocking adapter; the external
  // routes always answer instantly so a bypassed call cannot deadlock on the
  // adapter itself.
  ctx.llm.registerAdapter(['vllm-local'], opts.gatedAdapter ?? new ScriptedAdapter())
  ctx.llm.registerAdapter(['openai', 'deepseek-official', 'gemini'], new ScriptedAdapter())
  enqueueSpy = vi.spyOn(AdmissionQueue.prototype, 'enqueue')
  await ctx.plugin(AdmissionQueuePlugin, config)
  return ctx
}

async function drain(ctx: Context, provider: string): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of ctx.llm.stream({ provider, model: 'm', messages: [] })) chunks.push(chunk)
  return chunks
}

describe('gatedProviders allowlist', () => {
  it('queues a call to the gated internal provider', async () => {
    const ctx = await mount({ limit: 1, gatedProviders: ['vllm-local'] })
    await drain(ctx, 'vllm-local')
    expect(enqueueSpy).toHaveBeenCalledTimes(1)
  })

  it('lets an external provider pass straight through without enqueue', async () => {
    const ctx = await mount({ limit: 1, gatedProviders: ['vllm-local'] })
    const chunks = await drain(ctx, 'openai')
    expect(enqueueSpy).toHaveBeenCalledTimes(0)
    expect(chunks).toEqual(CHUNKS)
  })

  it('does not queue deepseek-official (verified independently of openai)', async () => {
    const ctx = await mount({ limit: 1, gatedProviders: ['vllm-local'] })
    await drain(ctx, 'deepseek-official')
    expect(enqueueSpy).toHaveBeenCalledTimes(0)
  })

  it('auto-passes an unlisted future provider with no code change', async () => {
    const ctx = await mount({ limit: 1, gatedProviders: ['vllm-local'] })
    await drain(ctx, 'gemini')
    expect(enqueueSpy).toHaveBeenCalledTimes(0)
  })

  it('an external call is not blocked while the single gated slot is fully held', async () => {
    const blocking = new BlockingAdapter()
    const ctx = await mount({ limit: 1, gatedProviders: ['vllm-local'] }, { gatedAdapter: blocking })

    // Start a gated call and let it take the only slot; never release it here.
    const gated = drain(ctx, 'vllm-local')
    await new Promise(resolve => setImmediate(resolve))

    // The external call must complete without waiting on the queue. If it were
    // enqueued behind the held slot, this await would hang until the timeout.
    const external = await drain(ctx, 'openai')
    expect(external).toEqual(CHUNKS)
    // Only the vllm-local call was enqueued, so no external entry ever joined
    // the wait line.
    expect(enqueueSpy).toHaveBeenCalledTimes(1)

    blocking.release()
    await gated
  })
})
