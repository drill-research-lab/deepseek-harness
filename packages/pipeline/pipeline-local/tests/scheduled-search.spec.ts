import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { PipelineId, validateWorkflowJson } from '@deepseek-ai/dsh-pipeline'
import PipelineLocalEngine from '@deepseek-ai/dsh-pipeline-local'
import {
  buildArxivQueryUrl,
  canonicalUrlFor,
  dedupeKeyFor,
  expandScheduledSearch,
  normalizeAtom,
  registerScheduledSearch,
} from '@deepseek-ai/dsh-pipeline-local'
import type { ArxivRecord } from '@deepseek-ai/dsh-pipeline-local'

const FIXTURE = readFileSync(join(import.meta.dirname, 'fixtures', 'arxiv-atom.xml'), 'utf8')

const CLEANUP: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scheduled-search-'))
  CLEANUP.push(dir)
  return dir
}

afterEach(() => {
  vi.unstubAllGlobals()
  for (const dir of CLEANUP.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('arXiv adapter', () => {
  it('builds a bounded query URL with a date window after the last successful run', () => {
    const url = buildArxivQueryUrl({ query: 'LLM agents' }, '2026-08-01T00:00:00Z', Date.parse('2026-08-30T00:00:00Z'))
    expect(url).toContain('https://export.arxiv.org/api/query?')
    expect(url).toContain('all%3A%22LLM+agents%22')
    expect(url).toContain('submittedDate%3A%5B202608010000+TO+202608300000%5D')
    expect(url).toContain('sortBy=submittedDate')
    expect(url).toContain('max_results=20')
  })

  it('canonicalizes ids and derives dedupe keys by priority', () => {
    expect(canonicalUrlFor('2401.00001v2')).toBe('https://arxiv.org/abs/2401.00001')
    const record = { arxivId: '2401.00001v2', doi: '10.1000/demo', canonicalUrl: 'https://arxiv.org/abs/2401.00001' } as ArxivRecord
    expect(dedupeKeyFor(record)).toBe('2401.00001v2')
    expect(dedupeKeyFor({ ...record, arxivId: '' })).toBe('10.1000/demo')
  })

  it('normalizes the fixture Atom into records with provenance', () => {
    const records = normalizeAtom(FIXTURE, '2026-08-30T00:00:00Z')
    expect(records).toHaveLength(2)
    expect(records[0]).toMatchObject({
      arxivId: '2401.00001v2',
      canonicalUrl: 'https://arxiv.org/abs/2401.00001',
      title: 'Agents That Plan Together',
      doi: '10.1000/demo',
      primaryCategory: 'cs.AI',
      authors: ['Ada Lovelace', 'Alan Turing'],
      provenance: { provider: 'arxiv', externalId: '2401.00001v2', retrievedAt: '2026-08-30T00:00:00Z' },
    })
    expect(records[1]?.doi).toBeUndefined()
  })
})

describe('Scheduled Search template', () => {
  it('expands into a valid definition, with the summary toggle adding an llm node', () => {
    const base = expandScheduledSearch('sch-search-x', 'Weekly scan', { query: 'LLM agents' })
    expect(() => validateWorkflowJson(base)).not.toThrow()
    expect(JSON.stringify(base)).not.toContain('summarize')
    const withSummary = expandScheduledSearch('sch-search-x', 'Weekly scan', { query: 'LLM agents', summary: true })
    expect(JSON.stringify(withSummary)).toContain('summarize')
    expect(() => validateWorkflowJson(withSummary)).not.toThrow()
  })

  it('runs the whole template twice: new records persist once, the rerun dedupes', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    const storageDir = tempDir()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(FIXTURE, { status: 200 })))
    await ctx.plugin(SessionStore)
    await ctx.plugin(JsonlSessionPersistence, { root: tempDir(), compression: 'none' })
    await ctx.plugin(PipelineLocalEngine, { storageDir, llmProvider: 'p', llmModel: 'm' })
    const engine = ctx.pipelineEngine as InstanceType<typeof PipelineLocalEngine>
    registerScheduledSearch(engine)
    const expanded = expandScheduledSearch('sch-search-x', 'Weekly scan', { query: 'LLM agents' })
    await engine.save({ definition: expanded })
    const started = engine.startRun({ id: PipelineId('sch-search-x'), trigger: 'scheduled' })
    if (started.outcome !== 'started') throw new Error('expected a started run')
    expect(await started.result).toMatchObject({ status: 'completed' })
    const destination = join(storageDir, 'artifacts', 'sch-search-x')
    const jsonl = readFileSync(join(destination, 'results.jsonl'), 'utf8').trim().split('\n')
    expect(jsonl).toHaveLength(2)
    expect(JSON.parse(jsonl[0] as string)).toMatchObject({ arxivId: '2401.00001v2', provenance: { provider: 'arxiv' } })
    expect(existsSync(join(storageDir, 'state', 'sch-search-x', 'seen.json'))).toBe(true)
    const second = engine.startRun({ id: PipelineId('sch-search-x'), trigger: 'scheduled' })
    if (second.outcome !== 'started') throw new Error('expected a started run')
    expect(await second.result).toMatchObject({ status: 'completed', nodeCount: 5 })
    const rerun = readFileSync(join(destination, 'results.jsonl'), 'utf8').trim().split('\n')
    expect(rerun).toHaveLength(2)
  })

  it('fails the run when the arXiv API errors, keeping the failure in the metrics', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    const storageDir = tempDir()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gateway timeout', { status: 503 })))
    await ctx.plugin(SessionStore)
    await ctx.plugin(JsonlSessionPersistence, { root: tempDir(), compression: 'none' })
    await ctx.plugin(PipelineLocalEngine, { storageDir, llmProvider: 'p', llmModel: 'm' })
    const engine = ctx.pipelineEngine as InstanceType<typeof PipelineLocalEngine>
    registerScheduledSearch(engine)
    await engine.save({ definition: expandScheduledSearch('sch-search-y', 'Y', { query: 'agents' }) })
    const started = engine.startRun({ id: PipelineId('sch-search-y'), trigger: 'manual' })
    if (started.outcome !== 'started') throw new Error('expected a started run')
    const result = await started.result
    expect(result.status).toBe('failed')
    expect(result.error).toContain('503')
    expect(engine.list()[0]).toMatchObject({ lastStatus: 'failed', failureStreak: 1 })
    expect(existsSync(join(storageDir, 'artifacts', 'sch-search-y'))).toBe(false)
  })

  it('rejects a search step without a query', async () => {
    const { dedupeStep, persistStep } = await import('@deepseek-ai/dsh-pipeline-local')
    void dedupeStep
    void persistStep
    const ctx = new Context()
    const storageDir = tempDir()
    await ctx.plugin(PipelineLocalEngine, { storageDir })
    const engine = ctx.pipelineEngine as InstanceType<typeof PipelineLocalEngine>
    registerScheduledSearch(engine)
    await engine.save({
      definition: expandScheduledSearch('sch-search-z', 'Z', { query: 'x' }),
    })
    expect(engine.registry.get(PipelineId('sch-search-z'))).toBeDefined()
  })
})

class LlmAdapterStub extends LlmAdapter {
  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'summary' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

describe('summary toggle', () => {
  it('runs the llm summarize node after persist when the template enables it', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['p'], new LlmAdapterStub())
    const storageDir = tempDir()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(FIXTURE, { status: 200 })))
    await ctx.plugin(SessionStore)
    await ctx.plugin(JsonlSessionPersistence, { root: tempDir(), compression: 'none' })
    await ctx.plugin(PipelineLocalEngine, { storageDir, llmProvider: 'p', llmModel: 'm' })
    const engine = ctx.pipelineEngine as InstanceType<typeof PipelineLocalEngine>
    registerScheduledSearch(engine)
    await engine.save({ definition: expandScheduledSearch('sch-search-s', 'S', { query: 'agents', summary: true }) })
    const started = engine.startRun({ id: PipelineId('sch-search-s'), trigger: 'manual' })
    if (started.outcome !== 'started') throw new Error('expected a started run')
    expect(await started.result).toMatchObject({ status: 'completed', nodeCount: 6 })
  })
})
