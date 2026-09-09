/**
 * Real-composition guard: LlmRuntime and llm-admission-queue boot from a
 * test-only cordis.yml through the actual Loader + Include path. The gate
 * wraps the real `llm/stream` waterfall, `ctx.llmAdmissionQueue` is served,
 * and disposing the tree drains every waiting admission.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MockInstance } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { AdmissionQueue } from '../src/queue.ts'
import type { PositionChange } from '../src/types.ts'
import * as AdmissionQueuePlugin from '../src/index.ts'

const CHUNKS: StreamChunk[] = [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'text-delta', index: 0, text: 'ok' },
  { type: 'block-end', index: 0, block: { type: 'text', text: 'ok' } },
  { type: 'finish', reason: { kind: 'stop' } },
]

/** Each stream() invocation awaits its own gate; gates open in call order. */
class FifoBlockingAdapter extends LlmAdapter {
  private readonly gates: PromiseWithResolvers<undefined>[] = []
  private opened = 0
  releaseNext(): void {
    const gate = this.gates[this.opened]
    if (gate === undefined) { this.opened += 1; return }
    this.opened += 1
    gate.resolve(undefined)
  }
  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    const gate = Promise.withResolvers<undefined>()
    this.gates.push(gate)
    await gate.promise
    yield* CHUNKS
  }
}

let context: Context | undefined
let root: string | undefined
let drainSpy: MockInstance | undefined

afterEach(async () => {
  drainSpy?.mockRestore()
  drainSpy = undefined
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function boot(config: { limit: number; gatedProviders: string[] }): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-admission-queue-'))
  vi.stubEnv('DSH_HOME', root)
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    '- id: llm',
    "  name: 'test-llm-service'",
    '- id: llm-admission-queue',
    "  name: '@deepseek-ai/dsh-llm-admission-queue'",
    '  config:',
    `    limit: ${String(config.limit)}`,
    `    gatedProviders: ${JSON.stringify(config.gatedProviders)}`,
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['test-llm-service', LlmRuntime],
    ['@deepseek-ai/dsh-llm-admission-queue', AdmissionQueuePlugin],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return ctx
}

const settle = (): Promise<void> => new Promise(resolve => setImmediate(resolve))

describe('llm-admission-queue real composition', () => {
  it('gates the real llm/stream waterfall in enqueue/admission order and serves ctx.llmAdmissionQueue', async () => {
    const ctx = await boot({ limit: 1, gatedProviders: ['vllm-local'] })
    const adapter = new FifoBlockingAdapter()
    ctx.llm.registerAdapter(['vllm-local', 'openai'], adapter)

    expect(ctx.get('llmAdmissionQueue')).toBeDefined()
    const changes: PositionChange[] = []
    ctx.llmAdmissionQueue.onChange(change => changes.push(change))

    const drained: string[] = []
    const run = (provider: string, tag: string): Promise<void> => (async () => {
      for await (const _chunk of ctx.llm.stream({ provider, model: 'm', messages: [] })) { /* drain */ }
      drained.push(tag)
    })()

    const a = run('vllm-local', 'a')
    await settle()
    const b = run('vllm-local', 'b')
    await settle()
    const c = run('vllm-local', 'c')
    await settle()

    // a admitted (one 'running'), b waiting at 1, c waiting at 2.
    expect(changes.filter(x => x.state === 'running')).toHaveLength(1)
    expect(changes.filter(x => x.state === 'waiting').map(x => x.position)).toEqual([1, 2])
    expect(ctx.llmAdmissionQueue.listAll().map(e => e.state)).toEqual(['waiting', 'waiting', 'running'])

    adapter.releaseNext() // finish a -> b admitted, c moves to 1
    await a
    await settle()
    expect(drained).toEqual(['a'])
    expect(changes.filter(x => x.state === 'running')).toHaveLength(2)

    adapter.releaseNext() // finish b -> c admitted
    await b
    await settle()
    adapter.releaseNext() // finish c
    await c
    expect(drained).toEqual(['a', 'b', 'c'])
    expect(ctx.llmAdmissionQueue.listAll()).toHaveLength(0)
  })

  it('disposing the tree drains every waiting admission', async () => {
    const ctx = await boot({ limit: 1, gatedProviders: ['vllm-local'] })
    const adapter = new FifoBlockingAdapter()
    ctx.llm.registerAdapter(['vllm-local'], adapter)
    drainSpy = vi.spyOn(AdmissionQueue.prototype, 'drain')

    const outcomes: string[] = []
    const run = (tag: string): Promise<void> => (async () => {
      try {
        for await (const _chunk of ctx.llm.stream({ provider: 'vllm-local', model: 'm', messages: [] })) { /* drain */ }
        outcomes.push('ok')
      } catch (error) {
        outcomes.push(`${tag}:${(error as Error).message}`)
      }
    })()

    const running = run('running')
    await settle()
    const waiting = run('waiting')
    await settle()
    expect(outcomes).toEqual([]) // both still in flight

    await ctx.fiber.dispose()
    context = undefined

    expect(drainSpy).toHaveBeenCalledTimes(1)
    await waiting
    expect(outcomes).toContain('waiting:llm-admission-queue plugin disposed')

    // Let the still-blocked running generator settle so the test leaves nothing pending.
    adapter.releaseNext()
    await running.catch(() => undefined)
  })
})
