import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import PipelineEngineDefault, { PipelineError, PipelineId, PipelineNodeId, PipelineRunId } from '../src/index.ts'
import type { PipelineEventName, PipelineSaveRequest, WorkflowJson } from '../src/index.ts'

/** A minimal concrete subclass exposing the protected helpers for tests. */
class StubEngine extends PipelineEngineDefault {
  list(): readonly [] {
    return []
  }

  get(): WorkflowJson | undefined {
    return undefined
  }

  async save(request: PipelineSaveRequest): Promise<WorkflowJson> {
    void request
    throw new Error('not under test')
  }

  async delete(): Promise<boolean> {
    return false
  }

  async setEnabled(): Promise<boolean> {
    return false
  }

  startRun(): never {
    throw new Error('not under test')
  }

  emit(name: PipelineEventName, ...args: unknown[]): void {
    this.emitPipelineEvent(name, ...args)
  }

  reject(id: string): never {
    return this.unknownPipeline(PipelineId(id))
  }
}

const INFO = {
  pipelineId: PipelineId('sch-search-arxiv'),
  runId: PipelineRunId('run-1'),
  name: 'arXiv weekly scan',
  trigger: 'manual',
} as const

describe('dsh-pipeline (interface)', () => {
  it('PipelineError carries its code and reads as a typed error', () => {
    const error = new PipelineError('missing', 'PIPELINE_UNKNOWN')
    expect(error.code).toBe('PIPELINE_UNKNOWN')
    expect(error.name).toBe('PipelineError')
  })

  it('registers as ctx.pipelineEngine and unregisters when its fiber is disposed (HMR safety)', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(StubEngine)
    expect(ctx.get('pipelineEngine')).toBeInstanceOf(StubEngine)
    await fiber.dispose()
    expect(ctx.get('pipelineEngine')).toBeUndefined()
  })

  it('emitPipelineEvent dispatches to every listener with the payload tuple', async () => {
    const ctx = new Context()
    await ctx.plugin(StubEngine)
    const seen: unknown[][] = []
    ctx.on('pipeline/run-start', (info) => { seen.push([info]) })
    ctx.on('pipeline/node-start', (info, node) => { seen.push([info, node]) })
    const engine = ctx.pipelineEngine as StubEngine
    engine.emit('pipeline/run-start', INFO)
    engine.emit('pipeline/node-start', INFO, { nodeId: PipelineNodeId('collect'), type: 'builtin' })
    expect(seen).toEqual([
      [INFO],
      [INFO, { nodeId: PipelineNodeId('collect'), type: 'builtin' }],
    ])
  })

  it('contains an asynchronously rejected listener without starving peers', async () => {
    const ctx = new Context()
    await ctx.plugin(StubEngine)
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => ctx.logger)
    const seen: string[] = []
    // Runtime listeners may return thenables even though the declaration's observable result is void.
    // oxlint-disable-next-line typescript/no-misused-promises -- exercises rejected-listener containment
    ctx.on('pipeline/run-start', async () => { throw new Error('async observer failed') })
    ctx.on('pipeline/run-start', () => { seen.push('reached') })
    const engine = ctx.pipelineEngine as StubEngine
    engine.emit('pipeline/run-start', INFO)
    await Promise.resolve()
    expect(seen).toEqual(['reached'])
    expect(String(warn.mock.calls[0]![0])).toContain('listener failed')
  })

  it('contains a throwing listener PER LISTENER: later listeners still run, nothing propagates', async () => {
    const ctx = new Context()
    await ctx.plugin(StubEngine)
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => ctx.logger)
    const reached: string[] = []
    ctx.on('pipeline/definition-changed', () => { throw new Error('bad listener') })
    ctx.on('pipeline/definition-changed', () => { reached.push('later') })
    const engine = ctx.pipelineEngine as StubEngine
    engine.emit('pipeline/run-start', INFO)
    engine.emit('pipeline/definition-changed', { id: PipelineId('sch-search-arxiv'), change: 'saved' })
    engine.emit('pipeline/run-end', INFO, { status: 'completed', nodeCount: 0 })
    expect(reached).toEqual(['later'])
    expect(String(warn.mock.calls[0]![0])).toContain('listener failed')
  })

  it('unknownPipeline throws the typed PIPELINE_UNKNOWN failure', async () => {
    const ctx = new Context()
    await ctx.plugin(StubEngine)
    const engine = ctx.pipelineEngine as StubEngine
    expect(() => engine.reject('nope')).toThrow(PipelineError)
    expect(() => engine.reject('nope')).toThrow(/pipeline "nope" is not persisted/)
    try {
      engine.reject('nope')
    } catch (error: unknown) {
      expect((error as PipelineError).code).toBe('PIPELINE_UNKNOWN')
    }
  })
})
