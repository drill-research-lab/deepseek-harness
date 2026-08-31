import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { PipelineId, PipelineNodeId, PipelineRunId } from '@deepseek-ai/dsh-pipeline'
import type {
  PipelineDefinitionChange,
  PipelineNodeEndInfo,
  PipelineNodeInfo,
  PipelineRunInfo,
  PipelineRunResultInfo,
} from '@deepseek-ai/dsh-pipeline'
import * as PipelineInvariant from '@deepseek-ai/dsh-pipeline/invariant'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(PipelineInvariant)
  return ctx
}

const run = (overrides: Partial<PipelineRunInfo> = {}): PipelineRunInfo => ({
  pipelineId: PipelineId('sch-search-arxiv'),
  runId: PipelineRunId('run-1'),
  name: 'arXiv weekly scan',
  trigger: 'manual',
  ...overrides,
})

const node = (overrides: Partial<PipelineNodeInfo> = {}): PipelineNodeInfo => ({
  nodeId: PipelineNodeId('collect'),
  type: 'builtin',
  ...overrides,
})

const nodeEnd = (overrides: Partial<PipelineNodeEndInfo> = {}): PipelineNodeEndInfo => ({
  ...node(),
  outcome: 'completed',
  ...overrides,
})

const result = (overrides: Partial<PipelineRunResultInfo> = {}): PipelineRunResultInfo => ({
  status: 'completed',
  nodeCount: 1,
  ...overrides,
})

const change = (overrides: Partial<PipelineDefinitionChange> = {}): PipelineDefinitionChange => ({
  id: PipelineId('sch-search-arxiv'),
  change: 'saved',
  ...overrides,
})

describe('pipeline invariants', () => {
  it('accepts a complete run lifecycle with node pairing', async () => {
    const ctx = await setup()
    ctx.emit('pipeline/definition-changed', change())
    ctx.emit('pipeline/run-start', run())
    ctx.emit('pipeline/node-start', run(), node())
    ctx.emit('pipeline/node-end', run(), nodeEnd())
    ctx.emit('pipeline/run-end', run(), result())
    ctx.emit('pipeline/definition-changed', change({ change: 'deleted' }))
    ctx.emit('tools/change')
  })

  it('accepts a failed node and a skipped node inside one run', async () => {
    const ctx = await setup()
    ctx.emit('pipeline/run-start', run())
    ctx.emit('pipeline/node-start', run(), node())
    ctx.emit('pipeline/node-end', run(), nodeEnd({ outcome: 'failed', error: 'arXiv 5xx' }))
    ctx.emit('pipeline/node-start', run(), node({ nodeId: PipelineNodeId('ask'), type: 'llm' }))
    ctx.emit('pipeline/node-end', run(), nodeEnd({ nodeId: PipelineNodeId('ask'), type: 'llm', outcome: 'skipped' }))
    ctx.emit('pipeline/run-end', run(), result({ status: 'failed', error: 'arXiv 5xx' }))
  })

  it('rejects malformed identity on run events', async () => {
    const ctx = await setup()
    expect(() => { ctx.emit('pipeline/run-start', run({ pipelineId: PipelineId('') })) }).toThrow(/must be non-empty/)
    expect(() => { ctx.emit('pipeline/run-start', run({ runId: PipelineRunId('') })) }).toThrow(/must be non-empty/)
    expect(() => { ctx.emit('pipeline/run-start', run({ name: '' })) }).toThrow(/must be non-empty/)
    expect(() => { ctx.emit('pipeline/run-start', run({ trigger: 'webhook' as PipelineRunInfo['trigger'] })) }).toThrow(/trigger must be/)
  })

  it('rejects unpaired and repeated run starts', async () => {
    const ctx = await setup()
    expect(() => { ctx.emit('pipeline/node-start', run(), node()) }).toThrow(/no matching pipeline\/run-start/)
    ctx.emit('pipeline/run-start', run())
    expect(() => { ctx.emit('pipeline/run-start', run()) }).toThrow(/repeated run id/)
  })

  it('rejects identity divergence mid-run', async () => {
    const ctx = await setup()
    ctx.emit('pipeline/run-start', run())
    expect(() => { ctx.emit('pipeline/node-start', run({ name: 'Renamed' }), node()) }).toThrow(/identity diverges/)
    expect(() => { ctx.emit('pipeline/node-start', run({ pipelineId: PipelineId('other') }), node()) }).toThrow(/identity diverges/)
  })

  it('rejects node lifecycle violations', async () => {
    const ctx = await setup()
    ctx.emit('pipeline/run-start', run())
    expect(() => { ctx.emit('pipeline/node-start', run(), node({ nodeId: PipelineNodeId('') })) }).toThrow(/nodeId must be non-empty/)
    expect(() => { ctx.emit('pipeline/node-end', run(), nodeEnd()) }).toThrow(/no matching start/)
    ctx.emit('pipeline/node-start', run(), node())
    expect(() => { ctx.emit('pipeline/node-start', run(), node()) }).toThrow(/repeated node id/)
    expect(() => { ctx.emit('pipeline/node-end', run(), nodeEnd({ type: 'llm' })) }).toThrow(/type diverges/)
    expect(() => { ctx.emit('pipeline/node-end', run(), nodeEnd({ outcome: 'failed' })) }).toThrow(/error must be present exactly for failed outcomes/)
    expect(() => { ctx.emit('pipeline/node-end', run(), nodeEnd({ outcome: 'completed', error: 'unexpected' })) }).toThrow(/error must be present exactly for failed outcomes/)
    ctx.emit('pipeline/node-end', run(), nodeEnd({ outcome: 'skipped' }))
  })

  it('rejects run-end violations', async () => {
    const ctx = await setup()
    ctx.emit('pipeline/run-start', run())
    ctx.emit('pipeline/node-start', run(), node())
    expect(() => { ctx.emit('pipeline/run-end', run(), result()) }).toThrow(/without pipeline\/node-end/)
    expect(() => { ctx.emit('pipeline/run-end', run(), result({ nodeCount: -1 })) }).toThrow(/nodeCount must be a non-negative safe integer/)
    ctx.emit('pipeline/node-end', run(), nodeEnd())
    expect(() => { ctx.emit('pipeline/run-end', run(), result({ status: 'failed' })) }).toThrow(/error must be present exactly for failed runs/)
    ctx.emit('pipeline/run-end', run(), result())
  })

  it('rejects events after the run ended', async () => {
    const ctx = await setup()
    ctx.emit('pipeline/run-start', run())
    ctx.emit('pipeline/node-start', run(), node())
    ctx.emit('pipeline/node-end', run(), nodeEnd())
    ctx.emit('pipeline/run-end', run(), result())
    expect(() => { ctx.emit('pipeline/node-start', run(), node()) }).toThrow(/after pipeline\/run-end/)
    expect(() => { ctx.emit('pipeline/node-end', run(), nodeEnd()) }).toThrow(/after pipeline\/run-end/)
    expect(() => { ctx.emit('pipeline/run-start', run()) }).toThrow(/repeated run id/)
    expect(() => { ctx.emit('pipeline/run-end', run(), result()) }).toThrow(/after pipeline\/run-end/)
  })

  it('rejects a definition change with an empty id', async () => {
    const ctx = await setup()
    expect(() => { ctx.emit('pipeline/definition-changed', change({ id: PipelineId('') })) }).toThrow(/id must be non-empty/)
  })
})
