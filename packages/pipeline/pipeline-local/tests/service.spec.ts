import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { PipelineId, validateWorkflowJson } from '@deepseek-ai/dsh-pipeline'
import PipelineLocalEngine, { PipelineRpcService } from '@deepseek-ai/dsh-pipeline-local'
import type { BuiltinStepContext, Config } from '@deepseek-ai/dsh-pipeline-local'

const CLEANUP: string[] = []

function tempStorage(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pipeline-rpc-'))
  CLEANUP.push(dir)
  return dir
}

/** One valid single-builtin-node definition with a disabled cron trigger. */
function definition(id: string): Record<string, unknown> {
  return {
    version: 1,
    id,
    name: `Pipeline ${id}`,
    trigger: { kind: 'cron', expression: '0 9 * * 1', timeZone: 'UTC', enabled: true },
    nodes: [
      { id: 'trigger', type: 'trigger' },
      { id: 'collect', type: 'builtin', ref: 'test/echo', config: { value: 1 } },
    ],
    edges: [{ from: 'trigger', to: 'collect' }],
  }
}

const ECHO_STEP = async (_config: unknown, _input: unknown, _context: BuiltinStepContext) => ({ echoed: true })

async function setup(config: Partial<Config> = {}): Promise<{ ctx: Context; engine: PipelineLocalEngine; rpc: PipelineRpcService }> {
  const ctx = new Context()
  await ctx.plugin(PipelineLocalEngine, { storageDir: tempStorage(), scheduler: false, ...config })
  const engine = ctx.pipelineEngine as PipelineLocalEngine
  engine.registerBuiltin('test/echo', ECHO_STEP)
  const rpc = (ctx as Context & { pipelines?: PipelineRpcService }).pipelines as PipelineRpcService
  return { ctx, engine, rpc }
}

afterEach(() => {
  for (const dir of CLEANUP.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('PipelineRpcService', () => {
  it('saves, lists, and reads definitions back through the wire face', async () => {
    const { engine, rpc } = await setup()
    const saved = await rpc.save(validateWorkflowJson(definition('sch-a')))
    expect(saved.id).toBe('sch-a')
    expect(rpc.list()).toHaveLength(1)
    expect(rpc.list()[0]?.status).toBe('idle')
    expect(rpc.get('sch-a')?.name).toBe('Pipeline sch-a')
    expect(rpc.get('sch-missing')).toBeUndefined()
    expect(engine.get(PipelineId('sch-a'))).toBeDefined()
  })

  it('rejects an invalid save and deletes only known pipelines', async () => {
    const { rpc } = await setup()
    await expect(rpc.save({ ...definition('sch-b'), nodes: [] } as unknown as Parameters<PipelineRpcService['save']>[0])).rejects.toThrow()
    await expect(rpc.delete('sch-b')).resolves.toBe(false)
    await rpc.save(validateWorkflowJson(definition('sch-b')))
    await expect(rpc.delete('sch-b')).resolves.toBe(true)
    expect(rpc.get('sch-b')).toBeUndefined()
  })

  it('pauses and resumes through setEnabled', async () => {
    const { rpc } = await setup()
    await expect(rpc.setEnabled('sch-c', false)).resolves.toBe(false)
    await rpc.save(validateWorkflowJson(definition('sch-c')))
    await expect(rpc.setEnabled('sch-c', false)).resolves.toBe(true)
    expect(rpc.list()[0]?.enabled).toBe(false)
    await expect(rpc.setEnabled('sch-c', true)).resolves.toBe(true)
    expect(rpc.list()[0]?.enabled).toBe(true)
  })

  it('runs a pipeline through triggerNow and serves the run records', async () => {
    const { rpc } = await setup()
    await rpc.save(validateWorkflowJson(definition('sch-d')))
    const outcome = await rpc.triggerNow('sch-d')
    expect(outcome).toMatchObject({ outcome: 'started', result: { status: 'completed', nodeCount: 2 } })
    if (outcome.outcome !== 'started') throw new Error('unreachable')
    expect(outcome.runId).toBe('sch-d-run-1')
    expect(rpc.runs('sch-d')).toHaveLength(1)
    expect(rpc.run('sch-d', 1)?.status).toBe('completed')
    expect(rpc.run('sch-d', 99)).toBeUndefined()
    expect(rpc.runs('sch-missing')).toEqual([])
    // A second run lands after the first; records list oldest first.
    await rpc.triggerNow('sch-d')
    expect(rpc.runs('sch-d').map(record => record.runId)).toEqual(['sch-d-run-1', 'sch-d-run-2'])
  })

  it('reports the overlap skip instead of queueing a second run', async () => {
    const { engine, rpc } = await setup()
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    engine.registerBuiltin('test/slow', async () => {
      await gate
      return { done: true }
    })
    await engine.save({
      definition: validateWorkflowJson({
        ...definition('sch-e'),
        nodes: [
          { id: 'trigger', type: 'trigger' },
          { id: 'slow', type: 'builtin', ref: 'test/slow' },
        ],
        edges: [{ from: 'trigger', to: 'slow' }],
      }),
    })
    const started = engine.startRun({ id: PipelineId('sch-e'), trigger: 'manual' })
    if (started.outcome !== 'started') throw new Error('expected a started run')
    // The gated run occupies the pipeline: a concurrent triggerNow skips.
    await expect(rpc.triggerNow('sch-e')).resolves.toEqual({ outcome: 'skipped', reason: 'already-running' })
    release?.()
    await expect(started.result).resolves.toMatchObject({ status: 'completed' })
  })
})
