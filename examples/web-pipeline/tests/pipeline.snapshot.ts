// Keyless runnable snapshot for the Scheduled-pipeline seam: the composition
// in ../cordis.yml boots through the real Loader, a deterministic builtin
// step stands in for the network-backed template steps, and one manual
// trigger carries the run end to end. The assertions pin the run record, the
// run-session projection (ignorable pipeline/* events folded from the
// persisted log), and the id-uniqueness rule that keeps delete + re-create
// cycles off the persistence layer's id-collision path.
import { readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { boot } from '@deepseek-ai/dsh-app-boot'
import type { WorkflowJson } from '@deepseek-ai/dsh-pipeline'
import { PipelineId } from '@deepseek-ai/dsh-pipeline'
import type { PipelineLocalEngine } from '@deepseek-ai/dsh-pipeline-local'
import { describe, expect, it } from 'vitest'

const configPath = new URL('../cordis.yml', import.meta.url).pathname

async function engineOf(ctx: Context): Promise<PipelineLocalEngine> {
  const engine = ctx.pipelineEngine as PipelineLocalEngine
  engine.registerBuiltin('demo/collect', () => ({
    collected: [
      { id: 'demo-1', title: 'First demo finding' },
      { id: 'demo-2', title: 'Second demo finding' },
    ],
  }))
  return engine
}

const definition = {
  version: 1 as const,
  id: 'demo-digest',
  name: 'Demo digest',
  trigger: { kind: 'cron' as const, expression: '0 9 * * *', timeZone: 'UTC', enabled: true },
  nodes: [
    { type: 'trigger' as const, id: 'trigger' },
    { type: 'builtin' as const, id: 'collect', ref: 'demo/collect' },
  ],
  edges: [{ from: 'trigger', to: 'collect' }],
}

describe('web-pipeline keyless snapshot', () => {
  it('boots the composition, runs a pipeline, and folds the run-session projection', async () => {
    const ctx = await boot('web-pipeline', configPath)
    const engine = await engineOf(ctx)

    const saved = await engine.save({ definition: definition as unknown as WorkflowJson })
    expect(saved.id).toBe(PipelineId('demo-digest'))

    const started = engine.startRun({ id: PipelineId('demo-digest'), trigger: 'manual' })
    if (started.outcome !== 'started') throw new Error('expected a started run')
    const result = await started.result
    expect(result).toMatchObject({ status: 'completed', nodeCount: 2 })

    // The run record points at its session; the projection folds the node
    // outcomes (with the collected JSON) out of the persisted log.
    const detail = await engine.readRunDetail(PipelineId('demo-digest'), 1)
    expect(detail?.sessionId).toMatch(/^demo-digest-run-1-/)
    expect(detail?.nodes).toEqual([
      { nodeId: 'trigger', nodeType: 'trigger', outcome: 'completed', durationMs: expect.any(Number), output: { trigger: 'manual' } },
      { nodeId: 'collect', nodeType: 'builtin', outcome: 'completed', durationMs: expect.any(Number), output: { collected: [{ id: 'demo-1', title: 'First demo finding' }, { id: 'demo-2', title: 'Second demo finding' }] } },
    ])

    // The persisted log carries the ignorable pipeline/* vocabulary. The
    // backend groups sessions under a project directory (`_no-cwd` for runs,
    // which record no cwd), one directory per suffixed session id.
    const sessionsRoot = join(process.cwd(), '.sessions', '_no-cwd')
    const runDirs = (await readdir(sessionsRoot)).filter(dir => dir.startsWith('demo-digest-run-1-'))
    expect(runDirs).toHaveLength(1)
    const raw = await readFile(join(sessionsRoot, runDirs[0] ?? '', 'session.jsonl'), 'utf8')
    const types = raw.trim().split('\n').map(line => (JSON.parse(line) as { type: string }).type)
    expect(types).toEqual([
      'session', 'pipeline/run-descriptor', 'pipeline/node-started', 'pipeline/node-settled',
      'pipeline/node-started', 'pipeline/node-settled', 'pipeline/run-settled',
    ])

    // Id reuse across delete + re-create must stay off the persistence
    // layer's collision path: the suffixed session ids keep each run's log
    // distinct on disk.
    await engine.delete(PipelineId('demo-digest'))
    await engine.save({ definition: definition as unknown as WorkflowJson })
    const replay = engine.startRun({ id: PipelineId('demo-digest'), trigger: 'manual' })
    if (replay.outcome !== 'started') throw new Error('expected a started run')
    const replayResult = await replay.result
    expect(replayResult).toMatchObject({ status: 'completed', nodeCount: 2 })
    const replayDetail = await engine.readRunDetail(PipelineId('demo-digest'), 1)
    expect(replayDetail?.sessionId).toMatch(/^demo-digest-run-1-/)
    expect(replayDetail?.sessionId).not.toBe(detail?.sessionId)

    await ctx.fiber.dispose()
    await rm(join(process.cwd(), '.sessions'), { recursive: true, force: true })
    await rm(join(process.cwd(), '.pipelines'), { recursive: true, force: true })
  }, 120_000)
})
