import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { PipelineError, PipelineId, validateWorkflowJson } from '@deepseek-ai/dsh-pipeline'
import type { PipelineDefinitionChange, PipelineRunInfo } from '@deepseek-ai/dsh-pipeline'
import PipelineLocalEngine, { PipelineFileRegistry } from '@deepseek-ai/dsh-pipeline-local'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Config } from '@deepseek-ai/dsh-pipeline-local'

class ScriptedAdapter extends LlmAdapter {
  constructor(private script: StreamChunk[]) {
    super()
  }

  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield * this.script
  }
}

class RecordingAdapter extends ScriptedAdapter {
  lastOptions: GenerateOptions | undefined

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.lastOptions = options
    yield * super.stream(options)
  }
}

const LLML_SCRIPT: StreamChunk[] = [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'text-delta', index: 0, text: 'summary: ' },
  { type: 'text-delta', index: 0, text: 'ok' },
  { type: 'block-end', index: 0, block: { type: 'text', text: 'summary: ok' } },
  { type: 'finish', reason: { kind: 'stop' } },
]

const CLEANUP: string[] = []

function tempStorage(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pipeline-local-'))
  CLEANUP.push(dir)
  return dir
}

/** One valid two-step definition: builtin search feeding an llm ask. */
function definition(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    id: 'sch-search-test',
    name: 'Test pipeline',
    trigger: { kind: 'cron', expression: '0 9 * * 1', timeZone: 'UTC', enabled: true },
    nodes: [
      { id: 'trigger', type: 'trigger' },
      { id: 'collect', type: 'builtin', ref: 'test/search', config: { source: 'fixture' } },
      { id: 'ask', type: 'llm', prompt: 'Summarize.' },
    ],
    edges: [{ from: 'trigger', to: 'collect' }, { from: 'collect', to: 'ask' }],
    ...overrides,
  }
}

async function setup(config: Partial<Config> = {}, adapter?: LlmAdapter): Promise<{
  ctx: Context
  engine: PipelineLocalEngine
  storageDir: string
  sessionRoot: string
}> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  ctx.llm.registerAdapter(['test-provider'], adapter ?? new ScriptedAdapter(LLML_SCRIPT))
  const storageDir = tempStorage()
  // Run sessions persist under their own root so the log survives the run scope's teardown.
  const sessionRoot = tempStorage()
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, { root: sessionRoot, compression: 'none' })
  await ctx.plugin(PipelineLocalEngine, { storageDir, llmProvider: 'test-provider', llmModel: 'test-model', ...config })
  return { ctx, engine: ctx.pipelineEngine as PipelineLocalEngine, storageDir, sessionRoot }
}

/** Mount the session vocabulary pipeline runs project their logs into. */
async function mountSessionStore(ctx: Context): Promise<void> {
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, { root: tempStorage(), compression: 'none' })
}

/** Record the pipeline/* event stream as compact tuples for sequence assertions. */
function trackEvents(ctx: Context): { shapes: string[]; changes: PipelineDefinitionChange[] } {
  const shapes: string[] = []
  const changes: PipelineDefinitionChange[] = []
  ctx.on('pipeline/run-start', (info: PipelineRunInfo) => { shapes.push([`run-start:${String(info.runId)}`, info.trigger].join('|')) })
  ctx.on('pipeline/node-start', (_info, node) => { shapes.push(`node-start:${String(node.nodeId)}`) })
  ctx.on('pipeline/node-end', (_info, node) => { shapes.push(`node-end:${String(node.nodeId)}:${node.outcome}`) })
  ctx.on('pipeline/run-end', (info, result) => { shapes.push(`run-end:${String(info.runId)}:${result.status}`) })
  ctx.on('pipeline/definition-changed', (change) => { changes.push(change) })
  return { shapes, changes }
}

afterEach(() => {
  for (const dir of CLEANUP.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('PipelineLocalEngine registry', () => {
  it('persists a definition atomically and reads it back', async () => {
    const { engine, storageDir } = await setup()
    const saved = await engine.save({ definition: definition() })
    expect(saved.id).toBe('sch-search-test')
    expect(existsSync(join(storageDir, 'definitions', 'sch-search-test.json'))).toBe(true)
    expect(existsSync(join(storageDir, 'registry.json'))).toBe(true)
    expect(engine.get(PipelineId('sch-search-test'))?.name).toBe('Test pipeline')
    expect(engine.list()).toEqual([
      expect.objectContaining({ id: PipelineId('sch-search-test'), name: 'Test pipeline', enabled: true, status: 'idle', failureStreak: 0, runCount: 0 }),
    ])
  })

  it('rejects an invalid definition without persisting anything', async () => {
    const { engine, storageDir } = await setup()
    const broken = definition()
    broken.name = ''
    await expect(engine.save({ definition: broken })).rejects.toMatchObject({ code: 'NAME_INVALID' })
    expect(existsSync(join(storageDir, 'definitions'))).toBe(true)
    expect(readdirSync(join(storageDir, 'definitions'))).toEqual([])
    expect(engine.list()).toEqual([])
  })

  it('emits definition-changed with the saved definition after commit', async () => {
    const { ctx, engine } = await setup()
    const changes: PipelineDefinitionChange[] = []
    ctx.on('pipeline/definition-changed', (change) => { changes.push(change) })
    await engine.save({ definition: definition() })
    expect(changes).toEqual([{ id: PipelineId('sch-search-test'), change: 'saved' }])
  })

  it('deletes the definition and index entry but keeps run records', async () => {
    const { ctx, engine, storageDir } = await setup()
    const changes: PipelineDefinitionChange[] = []
    ctx.on('pipeline/definition-changed', (change) => { changes.push(change) })
    await engine.save({ definition: definition() })
    const started = engine.startRun({ id: PipelineId('sch-search-test'), trigger: 'manual' })
    if (started.outcome !== 'started') throw new Error('expected a started run')
    await started.result
    expect(await engine.delete(PipelineId('sch-search-test'))).toBe(true)
    expect(existsSync(join(storageDir, 'definitions', 'sch-search-test.json'))).toBe(false)
    expect(engine.get(PipelineId('sch-search-test'))).toBeUndefined()
    expect(existsSync(join(storageDir, 'runs', 'sch-search-test', '1.json'))).toBe(true)
    expect(changes.map(entry => entry.change)).toEqual(['saved', 'deleted'])
  })

  it('pauses and resumes the trigger', async () => {
    const { ctx, engine } = await setup()
    const changes: PipelineDefinitionChange[] = []
    ctx.on('pipeline/definition-changed', (change) => { changes.push(change) })
    expect(await engine.setEnabled(PipelineId('nope'), false)).toBe(false)
    expect(await engine.delete(PipelineId('nope'))).toBe(false)
    await engine.save({ definition: definition() })
    expect(await engine.setEnabled(PipelineId('sch-search-test'), false)).toBe(true)
    expect(await engine.setEnabled(PipelineId('sch-search-test'), false)).toBe(true)
    expect(engine.list()[0]).toMatchObject({ enabled: false })
    expect(await engine.setEnabled(PipelineId('sch-search-test'), true)).toBe(true)
    expect(changes.map(entry => entry.change)).toEqual(['saved', 'disabled', 'enabled'])
  })

  it('reloads definitions and metrics from disk into a fresh engine', async () => {
    const { engine, storageDir } = await setup()
    engine.registerBuiltin('test/search', () => ({ hits: [] }))
    await engine.save({ definition: definition() })
    const started = engine.startRun({ id: PipelineId('sch-search-test'), trigger: 'manual' })
    if (started.outcome !== 'started') throw new Error('expected a started run')
    await started.result
    const revivedCtx = new Context()
    await revivedCtx.plugin(PipelineLocalEngine, { storageDir, llmProvider: 'test-provider', llmModel: 'test-model' })
    const revived = revivedCtx.pipelineEngine as PipelineLocalEngine
    expect(revived.get(PipelineId('sch-search-test'))?.name).toBe('Test pipeline')
    expect(revived.list()[0]).toMatchObject({ runCount: 1, lastStatus: 'completed' })
  })

  it('fails loud when the index references a missing definition file', async () => {
    const storageDir = tempStorage()
    writeFileSync(join(storageDir, 'registry.json'), JSON.stringify({ orphan: { name: 'x', enabled: true, nextOrdinal: 1 } }))
    const ctx = new Context()
    await expect(ctx.plugin(PipelineLocalEngine, { storageDir })).rejects.toThrow(/orphan.*has no definition file/)
  })

  it('fails loud on an unreadable definition file', async () => {
    const storageDir = tempStorage()
    mkdirSync(join(storageDir, 'definitions'), { recursive: true })
    writeFileSync(join(storageDir, 'definitions', 'broken.json'), '{ not json')
    const ctx = new Context()
    await expect(ctx.plugin(PipelineLocalEngine, { storageDir })).rejects.toThrow(/not readable JSON/)
  })

  it('adopts a hand-placed definition and ignores non-JSON scratch files', async () => {
    const storageDir = tempStorage()
    mkdirSync(join(storageDir, 'definitions'), { recursive: true })
    writeFileSync(join(storageDir, 'definitions', 'solo.json'), `${JSON.stringify(definition({ id: 'solo' }))}\n`)
    writeFileSync(join(storageDir, 'definitions', 'scratch.tmp'), 'partial write')
    const ctx = new Context()
    await ctx.plugin(PipelineLocalEngine, { storageDir })
    expect(ctx.pipelineEngine.list().map(summary => String(summary.id))).toEqual(['solo'])
  })

  it('setEnabled is idempotent at the registry level', async () => {
    const registry = new PipelineFileRegistry(tempStorage())
    await registry.save(validateWorkflowJson(definition()))
    expect(await registry.setEnabled(PipelineId('sch-search-test'), false)).toBe(true)
    expect(await registry.setEnabled(PipelineId('sch-search-test'), false)).toBe(true)
    expect(await registry.setEnabled(PipelineId('ghost'), true)).toBe(false)
    expect(registry.enabledOf(PipelineId('sch-search-test'))).toBe(false)
    expect(registry.enabledOf(PipelineId('ghost'))).toBeUndefined()
  })
})

describe('PipelineLocalEngine runs', () => {
  it('runs builtin and llm nodes in order and records metrics', async () => {
    const recording = new RecordingAdapter(LLML_SCRIPT)
    const { ctx, engine, storageDir } = await setup({}, recording)
    const { shapes } = trackEvents(ctx)
    const seenInputs: unknown[] = []
    let stepContext: unknown
    engine.registerBuiltin('test/search', (config, input, context) => {
      seenInputs.push(input)
      stepContext = context
      return { hits: [(config as { source: string }).source] }
    })
    await engine.save({ definition: definition() })
    const started = engine.startRun({ id: PipelineId('sch-search-test'), trigger: 'manual' })
    if (started.outcome !== 'started') throw new Error('expected a started run')
    expect(started.runId).toBe('sch-search-test-run-1')
    const result = await started.result
    expect(result).toEqual({ status: 'completed', nodeCount: 3 })
    expect(shapes).toEqual([
      'run-start:sch-search-test-run-1|manual',
      'node-start:trigger',
      'node-end:trigger:completed',
      'node-start:collect',
      'node-end:collect:completed',
      'node-start:ask',
      'node-end:ask:completed',
      'run-end:sch-search-test-run-1:completed',
    ])
    expect(seenInputs).toEqual([{ trigger: 'manual' }])
    expect(stepContext).toMatchObject({ pipelineId: PipelineId('sch-search-test') })
    expect(recording.lastOptions?.provider).toBe('test-provider')
    expect(recording.lastOptions?.model).toBe('test-model')
    const promptText = recording.lastOptions?.messages[0]?.content[0]
    expect(promptText).toMatchObject({ type: 'text' })
    expect((promptText as { text: string }).text).toContain('"hits"')
    expect((promptText as { text: string }).text).toContain('Summarize.')
    expect(engine.list()[0]).toMatchObject({ status: 'idle', runCount: 1, lastStatus: 'completed', failureStreak: 0 })
    const record = JSON.parse(readFileSync(join(storageDir, 'runs', 'sch-search-test', '1.json'), 'utf8')) as { runId: string; status: string; nodeCount: number; sessionId?: string }
    expect(record).toMatchObject({ runId: 'sch-search-test-run-1', status: 'completed', nodeCount: 3, sessionId: 'sch-search-test-run-1' })

    // The run's session log carries the full node projection; the detail RPC
    // folds it back out after the run scope's teardown flushed persistence.
    const detail = await engine.readRunDetail(PipelineId('sch-search-test'), 1)
    expect(detail?.nodes).toHaveLength(3)
    expect(detail?.nodes[0]).toMatchObject({ nodeId: 'trigger', outcome: 'completed', output: { trigger: 'manual' } })
    expect(detail?.nodes[1]).toMatchObject({ nodeId: 'collect', outcome: 'completed', output: { hits: ['fixture'] } })
    expect(detail?.nodes[2]).toMatchObject({ nodeId: 'ask', nodeType: 'llm', outcome: 'completed', output: { text: 'summary: ok' } })
    expect(detail?.nodes.every(node => typeof node.durationMs === 'number' && node.durationMs >= 0)).toBe(true)
  })

  it('opens the run session with an ignorable descriptor and closes it with the settled facts', async () => {
    const { engine, sessionRoot } = await setup()
    engine.registerBuiltin('test/search', () => ({ hits: 1 }))
    const short: Record<string, unknown> = definition()
    ;(short as { nodes: unknown[] }).nodes = [
      { id: 'trigger', type: 'trigger' },
      { id: 'collect', type: 'builtin', ref: 'test/search' },
    ]
    ;(short as { edges: unknown[] }).edges = [{ from: 'trigger', to: 'collect' }]
    await engine.save({ definition: short })
    const started = engine.startRun({ id: PipelineId('sch-search-test'), trigger: 'scheduled' })
    if (started.outcome !== 'started') throw new Error('expected a started run')
    await started.result

    // The persisted log: descriptor opens, both nodes settle, the run settles.
    const logLines = readFileSync(join(sessionRoot, '_no-cwd', 'sch-search-test-run-1', 'session.jsonl'), 'utf8').trim().split('\n')
    const events = logLines.map(line => JSON.parse(line) as { type: string; ignorable?: true; data: Record<string, unknown> })
    expect(events.map(event => event.type)).toEqual([
      'session', 'pipeline/run-descriptor', 'pipeline/node-started', 'pipeline/node-settled',
      'pipeline/node-started', 'pipeline/node-settled', 'pipeline/run-settled',
    ])
    for (const event of events.filter(event => event.type.startsWith('pipeline/'))) {
      expect(event.ignorable).toBe(true)
    }
    expect(events[1]?.data).toMatchObject({
      version: 1, pipelineId: 'sch-search-test', runId: 'sch-search-test-run-1',
      pipelineName: 'Test pipeline', trigger: 'scheduled',
    })
    expect(events.at(-1)?.data).toMatchObject({ status: 'completed', nodeCount: 2 })
  })

  it('retires pruned run-session logs with their records (D13 retention)', async () => {
    const { ctx, engine, sessionRoot } = await setup({ retainedRuns: 1 })
    engine.registerBuiltin('test/search', () => ({ hits: 1 }))
    const short: Record<string, unknown> = definition()
    ;(short as { nodes: unknown[] }).nodes = [
      { id: 'trigger', type: 'trigger' },
      { id: 'collect', type: 'builtin', ref: 'test/search' },
    ]
    ;(short as { edges: unknown[] }).edges = [{ from: 'trigger', to: 'collect' }]
    await engine.save({ definition: short })
    const first = engine.startRun({ id: PipelineId('sch-search-test'), trigger: 'manual' })
    if (first.outcome !== 'started') throw new Error('expected a started run')
    await first.result
    expect(existsSync(join(sessionRoot, '_no-cwd', 'sch-search-test-run-1', 'session.jsonl'))).toBe(true)

    const second = engine.startRun({ id: PipelineId('sch-search-test'), trigger: 'manual' })
    if (second.outcome !== 'started') throw new Error('expected a started run')
    await second.result
    // The pruned record's run log retired with it; the retained run's log stays.
    expect(existsSync(join(sessionRoot, '_no-cwd', 'sch-search-test-run-1'))).toBe(false)
    expect(existsSync(join(sessionRoot, '_no-cwd', 'sch-search-test-run-2', 'session.jsonl'))).toBe(true)
    expect(engine.listRuns(PipelineId('sch-search-test')).map(r => r.runId)).toEqual(['sch-search-test-run-2'])
    void ctx
  })

  it('fails the run loudly when the run session cannot be created', async () => {
    const { ctx, engine } = await setup()
    await engine.save({ definition: definition() })
    // A live session owning the deterministic run id makes the open throw.
    ctx.sessions.create(SessionId('sch-search-test-run-1'))
    const started = engine.startRun({ id: PipelineId('sch-search-test'), trigger: 'manual' })
    if (started.outcome !== 'started') throw new Error('expected a started run')
    const result = await started.result
    expect(result).toMatchObject({ status: 'failed', nodeCount: 0 })
    expect(result.error).toContain('already exists')
    expect(engine.list()[0]).toMatchObject({ status: 'idle', lastStatus: 'failed' })
  })

  it('keeps the record metrics when the run session log is unreadable', async () => {
    const { ctx, engine, storageDir, sessionRoot } = await setup()
    engine.registerBuiltin('test/search', () => ({ hits: 1 }))
    await engine.save({ definition: definition() })
    const started = engine.startRun({ id: PipelineId('sch-search-test'), trigger: 'manual' })
    if (started.outcome !== 'started') throw new Error('expected a started run')
    await started.result
    // Simulate retention or loss: the record points at a log that does not
    // exist, and the detail projection keeps the record's metrics.
    const stale = JSON.parse(readFileSync(join(storageDir, 'runs', 'sch-search-test', '1.json'), 'utf8')) as Record<string, unknown>
    stale.sessionId = 'sch-search-test-run-99'
    writeFileSync(join(storageDir, 'runs', 'sch-search-test', '1.json'), JSON.stringify(stale))
    const detail = await engine.readRunDetail(PipelineId('sch-search-test'), 1)
    expect(detail).toMatchObject({ status: 'completed', nodeCount: 3, nodes: [] })
    // Legacy records without a sessionId project an empty node list too.
    const legacy = JSON.parse(readFileSync(join(storageDir, 'runs', 'sch-search-test', '1.json'), 'utf8')) as Record<string, unknown>
    delete legacy.sessionId
    writeFileSync(join(storageDir, 'runs', 'sch-search-test', '1.json'), JSON.stringify(legacy))
    const detailWithoutLog = await engine.readRunDetail(PipelineId('sch-search-test'), 1)
    expect(detailWithoutLog).toMatchObject({ status: 'completed', nodes: [] })
    void ctx
    void sessionRoot
  })

  it('reports already-running as a data skip and keeps one executing run', async () => {
    const { engine } = await setup()
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    engine.registerBuiltin('test/search', async () => {
      await gate
      return { hits: [] }
    })
    await engine.save({ definition: definition() })
    const first = engine.startRun({ id: PipelineId('sch-search-test'), trigger: 'scheduled' })
    if (first.outcome !== 'started') throw new Error('expected a started run')
    const second = engine.startRun({ id: PipelineId('sch-search-test'), trigger: 'manual' })
    expect(second).toEqual({ outcome: 'skipped', pipelineId: PipelineId('sch-search-test'), reason: 'already-running' })
    expect(engine.list()[0]).toMatchObject({ status: 'running' })
    release?.()
    expect((await first.result).status).toBe('completed')
    expect(engine.list()[0]).toMatchObject({ status: 'idle' })
  })

  it('fails the run when a builtin step throws and stops downstream execution', async () => {
    const { ctx, engine, storageDir } = await setup()
    const { shapes } = trackEvents(ctx)
    let llmReached = false
    engine.registerBuiltin('test/search', () => {
      throw new Error('arXiv 5xx')
    })
    engine.registerBuiltin('unused', () => {
      llmReached = false
      return { hits: [] }
    })
    await engine.save({ definition: definition() })
    const started = engine.startRun({ id: PipelineId('sch-search-test'), trigger: 'manual' })
    if (started.outcome !== 'started') throw new Error('expected a started run')
    const result = await started.result
    expect(result).toEqual({ status: 'failed', error: 'arXiv 5xx', nodeCount: 2 })
    expect(shapes).toEqual([
      'run-start:sch-search-test-run-1|manual',
      'node-start:trigger',
      'node-end:trigger:completed',
      'node-start:collect',
      'node-end:collect:failed',
      'run-end:sch-search-test-run-1:failed',
    ])
    expect(llmReached).toBe(false)
    expect(engine.list()[0]).toMatchObject({ failureStreak: 1, lastStatus: 'failed', lastError: 'arXiv 5xx' })
    const record = JSON.parse(readFileSync(join(storageDir, 'runs', 'sch-search-test', '1.json'), 'utf8')) as { error?: string }
    expect(record.error).toBe('arXiv 5xx')
  })

  it('resets the failure streak on the next successful run', async () => {
    const { engine } = await setup()
    let fail = true
    engine.registerBuiltin('test/search', () => {
      if (fail) throw new Error('flaky')
      return { hits: [] }
    })
    await engine.save({ definition: definition() })
    const first = engine.startRun({ id: PipelineId('sch-search-test'), trigger: 'manual' })
    if (first.outcome !== 'started') throw new Error('expected a started run')
    await first.result
    fail = false
    const second = engine.startRun({ id: PipelineId('sch-search-test'), trigger: 'manual' })
    if (second.outcome !== 'started') throw new Error('expected a started run')
    await second.result
    expect(engine.list()[0]).toMatchObject({ runCount: 2, failureStreak: 0, lastStatus: 'completed' })
  })

  it('renders a non-Error step throw as the run failure message', async () => {
    const { engine } = await setup()
    engine.registerBuiltin('test/search', (): never => {
      throw 'plain string failure'
    })
    await engine.save({
      definition: definition({
        nodes: [
          { id: 'trigger', type: 'trigger' },
          { id: 'collect', type: 'builtin', ref: 'test/search' },
        ],
        edges: [{ from: 'trigger', to: 'collect' }],
      }),
    })
    const started = engine.startRun({ id: PipelineId('sch-search-test'), trigger: 'manual' })
    if (started.outcome !== 'started') throw new Error('expected a started run')
    await expect(started.result).resolves.toMatchObject({ status: 'failed', error: 'plain string failure' })
  })

  it('fails an llm node when no llm runtime is mounted', async () => {
    const ctx = new Context()
    const storageDir = tempStorage()
    await mountSessionStore(ctx)
    await ctx.plugin(PipelineLocalEngine, { storageDir, llmProvider: 'test-provider', llmModel: 'test-model' })
    const engine = ctx.pipelineEngine as PipelineLocalEngine
    await engine.save({
      definition: definition({
        nodes: [
          { id: 'trigger', type: 'trigger' },
          { id: 'ask', type: 'llm', prompt: 'Ask.' },
        ],
        edges: [{ from: 'trigger', to: 'ask' }],
      }),
    })
    const started = engine.startRun({ id: PipelineId('sch-search-test'), trigger: 'manual' })
    if (started.outcome !== 'started') throw new Error('expected a started run')
    const result = await started.result
    expect(result.status).toBe('failed')
    expect(result.error).toContain('no llm runtime')
  })

  it('unregistering a builtin step makes later runs fail loud', async () => {
    const { engine } = await setup()
    const dispose = engine.registerBuiltin('test/search', () => ({ hits: [] }))
    await engine.save({
      definition: definition({
        nodes: [
          { id: 'trigger', type: 'trigger' },
          { id: 'collect', type: 'builtin', ref: 'test/search' },
        ],
        edges: [{ from: 'trigger', to: 'collect' }],
      }),
    })
    dispose()
    dispose()
    const started = engine.startRun({ id: PipelineId('sch-search-test'), trigger: 'manual' })
    if (started.outcome !== 'started') throw new Error('expected a started run')
    const result = await started.result
    expect(result.status).toBe('failed')
    expect(result.error).toContain('not registered')
  })

  it('fails loud on an unknown builtin ref', async () => {
    const ctx = new Context()
    const storageDir = tempStorage()
    await mountSessionStore(ctx)
    await ctx.plugin(PipelineLocalEngine, { storageDir })
    const engine = ctx.pipelineEngine as PipelineLocalEngine
    await engine.save({
      definition: definition({
        nodes: [
          { id: 'trigger', type: 'trigger' },
          { id: 'ghost', type: 'builtin', ref: 'no/such-step' },
        ],
        edges: [{ from: 'trigger', to: 'ghost' }],
      }),
    })
    const started = engine.startRun({ id: PipelineId('sch-search-test'), trigger: 'manual' })
    if (started.outcome !== 'started') throw new Error('expected a started run')
    const result = await started.result
    expect(result.status).toBe('failed')
    expect(result.error).toContain('not registered')
  })

  it('fails an llm node when no provider default is configured', async () => {
    const ctx = new Context()
    const storageDir = tempStorage()
    await mountSessionStore(ctx)
    await ctx.plugin(PipelineLocalEngine, { storageDir })
    const engine = ctx.pipelineEngine as PipelineLocalEngine
    await engine.save({
      definition: definition({
        nodes: [
          { id: 'trigger', type: 'trigger' },
          { id: 'ask', type: 'llm', prompt: 'Ask.' },
        ],
        edges: [{ from: 'trigger', to: 'ask' }],
      }),
    })
    const started = engine.startRun({ id: PipelineId('sch-search-test'), trigger: 'manual' })
    if (started.outcome !== 'started') throw new Error('expected a started run')
    const result = await started.result
    expect(result.status).toBe('failed')
    expect(result.error).toContain('llmProvider/llmModel')
  })

  it('skips disabled nodes and their downstream edges', async () => {
    const { ctx, engine } = await setup()
    const { shapes } = trackEvents(ctx)
    const executed: string[] = []
    engine.registerBuiltin('test/search', () => {
      executed.push('search')
      return { hits: [] }
    })
    await engine.save({
      definition: definition({
        nodes: [
          { id: 'trigger', type: 'trigger' },
          { id: 'collect', type: 'builtin', ref: 'test/search', disabled: true },
          { id: 'ask', type: 'llm', prompt: 'Summarize.' },
        ],
        edges: [{ from: 'trigger', to: 'collect' }, { from: 'collect', to: 'ask' }],
      }),
    })
    const started = engine.startRun({ id: PipelineId('sch-search-test'), trigger: 'manual' })
    if (started.outcome !== 'started') throw new Error('expected a started run')
    const result = await started.result
    expect(result).toEqual({ status: 'completed', nodeCount: 1 })
    expect(executed).toEqual([])
    expect(shapes).toContain('node-end:collect:skipped')
    expect(shapes).toContain('node-end:ask:skipped')
  })

  it('fails an agent node with the typed runtime-unavailable error', async () => {
    const { engine } = await setup()
    await engine.save({
      definition: definition({
        nodes: [
          { id: 'trigger', type: 'trigger' },
          { id: 'worker', type: 'agent', prompt: 'Work.' },
        ],
        edges: [{ from: 'trigger', to: 'worker' }],
      }),
    })
    const started = engine.startRun({ id: PipelineId('sch-search-test'), trigger: 'manual' })
    if (started.outcome !== 'started') throw new Error('expected a started run')
    const result = await started.result
    expect(result.status).toBe('failed')
    expect(result.error).toContain('background-agent runtime')
  })

  it('throws the typed unknown-pipeline failure on an unknown id', async () => {
    const { engine } = await setup()
    expect(() => engine.startRun({ id: PipelineId('ghost'), trigger: 'manual' })).toThrow(PipelineError)
    try {
      engine.startRun({ id: PipelineId('ghost'), trigger: 'manual' })
    } catch (error: unknown) {
      expect((error as PipelineError).code).toBe('PIPELINE_UNKNOWN')
    }
  })

  it('merges multiple upstream outputs into a record keyed by node id', async () => {
    const { engine } = await setup()
    const seenInputs: unknown[] = []
    engine.registerBuiltin('test/merge', (_config, input) => {
      seenInputs.push(input)
      return { merged: true }
    })
    await engine.save({
      definition: definition({
        nodes: [
          { id: 'trigger', type: 'trigger' },
          { id: 'a', type: 'llm', prompt: 'A.' },
          { id: 'b', type: 'llm', prompt: 'B.' },
          { id: 'merge', type: 'builtin', ref: 'test/merge' },
        ],
        edges: [{ from: 'trigger', to: 'a' }, { from: 'trigger', to: 'b' }, { from: 'a', to: 'merge' }, { from: 'b', to: 'merge' }],
      }),
    })
    const started = engine.startRun({ id: PipelineId('sch-search-test'), trigger: 'manual' })
    if (started.outcome !== 'started') throw new Error('expected a started run')
    await started.result
    expect(seenInputs[0]).toMatchObject({ a: { text: 'summary: ok' }, b: { text: 'summary: ok' } })
  })

  it('prunes run records past the retention bound', async () => {
    const { engine, storageDir } = await setup({ retainedRuns: 2 })
    engine.registerBuiltin('test/search', () => ({ hits: [] }))
    await engine.save({
      definition: definition({
        nodes: [
          { id: 'trigger', type: 'trigger' },
          { id: 'collect', type: 'builtin', ref: 'test/search' },
        ],
        edges: [{ from: 'trigger', to: 'collect' }],
      }),
    })
    for (let index = 0; index < 3; index += 1) {
      const started = engine.startRun({ id: PipelineId('sch-search-test'), trigger: 'manual' })
      if (started.outcome !== 'started') throw new Error('expected a started run')
      await started.result
    }
    const records = readdirSync(join(storageDir, 'runs', 'sch-search-test'))
    expect(records).toEqual(['2.json', '3.json'])
    expect(engine.list()[0]).toMatchObject({ runCount: 3 })
  })

  it('gives builtin steps a per-pipeline state directory that survives across runs', async () => {
    const { engine } = await setup()
    const seenStateDirs: string[] = []
    engine.registerBuiltin('test/search', (_config, _input, context) => {
      seenStateDirs.push(context.stateDir)
      writeFileSync(join(context.stateDir, 'seen.json'), '{}')
      return { hits: [] }
    })
    await engine.save({
      definition: definition({
        nodes: [
          { id: 'trigger', type: 'trigger' },
          { id: 'collect', type: 'builtin', ref: 'test/search' },
        ],
        edges: [{ from: 'trigger', to: 'collect' }],
      }),
    })
    for (let index = 0; index < 2; index += 1) {
      const started = engine.startRun({ id: PipelineId('sch-search-test'), trigger: 'manual' })
      if (started.outcome !== 'started') throw new Error('expected a started run')
      await started.result
    }
    expect(new Set(seenStateDirs).size).toBe(1)
    expect(seenStateDirs[0]).toContain(join('state', 'sch-search-test'))
    expect(existsSync(join(seenStateDirs[0]!, 'seen.json'))).toBe(true)
  })

  it('keeps the validator as the durable boundary on every save', async () => {
    const { engine } = await setup()
    const cyclic = definition({
      nodes: [
        { id: 'trigger', type: 'trigger' },
        { id: 'a', type: 'llm', prompt: 'A.' },
        { id: 'b', type: 'llm', prompt: 'B.' },
      ],
      edges: [{ from: 'trigger', to: 'a' }, { from: 'a', to: 'b' }, { from: 'b', to: 'a' }],
    })
    await expect(engine.save({ definition: cyclic })).rejects.toMatchObject({ code: 'CYCLE_DETECTED' })
    expect(validateWorkflowJson(definition()).version).toBe(1)
  })

  it('warns and continues when one event listener throws', async () => {
    const { ctx, engine } = await setup()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => ctx.logger)
    const seen: string[] = []
    ctx.on('pipeline/node-start', () => { throw new Error('bad listener') })
    ctx.on('pipeline/node-start', (_info, node) => { seen.push(String(node.nodeId)) })
    engine.registerBuiltin('test/search', () => ({ hits: [] }))
    await engine.save({
      definition: definition({
        nodes: [
          { id: 'trigger', type: 'trigger' },
          { id: 'collect', type: 'builtin', ref: 'test/search' },
        ],
        edges: [{ from: 'trigger', to: 'collect' }],
      }),
    })
    const started = engine.startRun({ id: PipelineId('sch-search-test'), trigger: 'manual' })
    if (started.outcome !== 'started') throw new Error('expected a started run')
    await started.result
    expect(seen).toEqual(['trigger', 'collect'])
    expect(warn).toHaveBeenCalled()
  })
})

describe('PipelineLocalEngine scheduler', () => {
  it('initializes the next fire time without firing a future schedule', async () => {
    const { engine } = await setup()
    engine.registerBuiltin('test/search', () => ({ hits: [] }))
    await engine.save({
      definition: definition({
        nodes: [
          { id: 'trigger', type: 'trigger' },
          { id: 'collect', type: 'builtin', ref: 'test/search' },
        ],
        edges: [{ from: 'trigger', to: 'collect' }],
      }),
    })
    await engine.tick()
    const nextRunAt = engine.registry.nextRunAtOf(PipelineId('sch-search-test'))
    expect(nextRunAt).toBeDefined()
    expect(Date.parse(nextRunAt as string)).toBeGreaterThan(Date.now())
    expect(engine.list()[0]).toMatchObject({ runCount: 0 })
  })

  it('fires a due schedule and recomputes the next fire time', async () => {
    const { ctx, engine } = await setup()
    const { shapes } = trackEvents(ctx)
    engine.registerBuiltin('test/search', () => ({ hits: [] }))
    await engine.save({
      definition: definition({
        nodes: [
          { id: 'trigger', type: 'trigger' },
          { id: 'collect', type: 'builtin', ref: 'test/search' },
        ],
        edges: [{ from: 'trigger', to: 'collect' }],
      }),
    })
    await engine.tick()
    await engine.registry.setNextRunAt(PipelineId('sch-search-test'), new Date(Date.now() - 1000).toISOString())
    const ended = new Promise<void>((resolve) => {
      ctx.on('pipeline/run-end', () => {
        resolve()
      })
    })
    await engine.tick()
    await ended
    expect(shapes).toContain('run-start:sch-search-test-run-1|scheduled')
    const nextRunAt = engine.registry.nextRunAtOf(PipelineId('sch-search-test')) as string
    expect(Date.parse(nextRunAt)).toBeGreaterThan(Date.now())
    expect(engine.list()[0]).toMatchObject({ runCount: 1, lastStatus: 'completed' })
  })

  it('records an overlap skip when the pipeline is already running', async () => {
    const { engine } = await setup()
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    engine.registerBuiltin('test/search', async () => {
      await gate
      return { hits: [] }
    })
    await engine.save({
      definition: definition({
        nodes: [
          { id: 'trigger', type: 'trigger' },
          { id: 'collect', type: 'builtin', ref: 'test/search' },
        ],
        edges: [{ from: 'trigger', to: 'collect' }],
      }),
    })
    await engine.tick()
    await engine.registry.setNextRunAt(PipelineId('sch-search-test'), new Date(Date.now() - 1000).toISOString())
    await engine.tick()
    await engine.registry.setNextRunAt(PipelineId('sch-search-test'), new Date(Date.now() - 1000).toISOString())
    await engine.tick()
    expect(engine.list()[0]).toMatchObject({ skippedCount: 1 })
    release?.()
  })

  it('does not fire a paused pipeline', async () => {
    const { engine } = await setup()
    let fired = false
    engine.registerBuiltin('test/search', () => {
      fired = true
      return { hits: [] }
    })
    await engine.save({
      definition: definition({
        nodes: [
          { id: 'trigger', type: 'trigger' },
          { id: 'collect', type: 'builtin', ref: 'test/search' },
        ],
        edges: [{ from: 'trigger', to: 'collect' }],
      }),
    })
    await engine.setEnabled(PipelineId('sch-search-test'), false)
    await engine.registry.setNextRunAt(PipelineId('sch-search-test'), new Date(Date.now() - 1000).toISOString())
    await engine.tick()
    expect(fired).toBe(false)
  })

  it('recomputes the fire time after resume instead of firing retroactively', async () => {
    const { engine } = await setup()
    let fired = false
    engine.registerBuiltin('test/search', () => {
      fired = true
      return { hits: [] }
    })
    await engine.save({
      definition: definition({
        nodes: [
          { id: 'trigger', type: 'trigger' },
          { id: 'collect', type: 'builtin', ref: 'test/search' },
        ],
        edges: [{ from: 'trigger', to: 'collect' }],
      }),
    })
    await engine.setEnabled(PipelineId('sch-search-test'), false)
    await engine.setEnabled(PipelineId('sch-search-test'), true)
    expect(engine.registry.nextRunAtOf(PipelineId('sch-search-test'))).toBeUndefined()
    await engine.tick()
    expect(fired).toBe(false)
    const nextRunAt = engine.registry.nextRunAtOf(PipelineId('sch-search-test')) as string
    expect(Date.parse(nextRunAt)).toBeGreaterThan(Date.now())
  })

  it('clears the fire time on save so the scheduler recomputes it', async () => {
    const { engine } = await setup()
    engine.registerBuiltin('test/search', () => ({ hits: [] }))
    await engine.save({
      definition: definition({
        nodes: [
          { id: 'trigger', type: 'trigger' },
          { id: 'collect', type: 'builtin', ref: 'test/search' },
        ],
        edges: [{ from: 'trigger', to: 'collect' }],
      }),
    })
    await engine.tick()
    expect(engine.registry.nextRunAtOf(PipelineId('sch-search-test'))).toBeDefined()
    await engine.save({
      definition: definition({
        nodes: [
          { id: 'trigger', type: 'trigger' },
          { id: 'collect', type: 'builtin', ref: 'test/search' },
        ],
        edges: [{ from: 'trigger', to: 'collect' }],
      }),
    })
    expect(engine.registry.nextRunAtOf(PipelineId('sch-search-test'))).toBeUndefined()
  })

  it('can mount with the scheduler disabled', async () => {
    const { engine } = await setup({ scheduler: false, tickSeconds: 5 })
    expect(engine.registry).toBeDefined()
  })

  it('applies scheduler defaults on a raw construction', () => {
    // A raw construction bypasses the plugin's Config resolution: both ?? fallbacks fire.
    const engine = new PipelineLocalEngine(new Context(), { storageDir: tempStorage() })
    expect(engine.registry).toBeDefined()
  })
})

describe('PipelineLocalEngine scheduler lifecycle', () => {
  it('drives ticks from the mounted interval and stops on dispose', async () => {
    const ctx = new Context()
    let ticks = 0
    const fiber = await ctx.plugin(PipelineLocalEngine, { storageDir: tempStorage(), tickSeconds: 0.001 })
    const engine = ctx.pipelineEngine as PipelineLocalEngine
    const originalTick = engine.tick.bind(engine)
    engine.tick = async () => {
      ticks += 1
      await originalTick()
    }
    await new Promise((resolve) => { setTimeout(resolve, 30) })
    expect(ticks).toBeGreaterThan(0)
    const before = ticks
    await fiber.dispose()
    await new Promise((resolve) => { setTimeout(resolve, 30) })
    expect(ticks).toBe(before)
  })
})
