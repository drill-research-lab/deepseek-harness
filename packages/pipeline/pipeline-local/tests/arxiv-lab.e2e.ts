/**
 * Real-model e2e: the full Scheduled Search template runs against the lab's
 * vLLM endpoint (the summarize llm node asks the real model), while the arXiv
 * request stays on a fixture so the test never depends on arXiv
 * availability. Self-skips when the lab host is unreachable (CI, offline).
 *
 * Run: pnpm vitest run packages/pipeline/pipeline-local/tests/arxiv-lab.e2e.ts
 * @module arxiv-lab.e2e
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { PipelineId } from '@deepseek-ai/dsh-pipeline'
import PipelineLocalEngine from '@deepseek-ai/dsh-pipeline-local'
import { expandScheduledSearch, registerScheduledSearch } from '@deepseek-ai/dsh-pipeline-local'

const LAB_BASE_URL = 'http://192.168.101.70:8888/v1'
const LAB_MODEL = 'deepseek-v4-flash-0731'
const FIXTURE = readFileSync(join(import.meta.dirname, 'fixtures', 'arxiv-atom.xml'), 'utf8')

async function labReachable(): Promise<boolean> {
  try {
    const response = await fetch(`${LAB_BASE_URL}/models`, { signal: AbortSignal.timeout(3000) })
    return response.ok
  } catch {
    return false
  }
}

const skip = !(await labReachable())

const cleanup: string[] = []

afterEach(() => {
  vi.unstubAllGlobals()
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe.skipIf(skip)('Scheduled Search against the lab model', () => {
  it('runs the full template: real arXiv-shaped records, a real model summary, provenance on disk', async () => {
    // The vLLM endpoint ignores auth, but the adapter requires a non-empty
    // credential value; any placeholder works.
    process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY ?? '123456'
    // Only arXiv rides the fixture: the summarize node's request goes to the
    // real lab endpoint through the untouched fetch.
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('export.arxiv.org')) return new Response(FIXTURE, { status: 200 })
      return realFetch(input, init)
    })

    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, {
      providers: {
        'dgx-spark': {
          apiKeyEnv: 'DEEPSEEK_API_KEY',
          baseURL: LAB_BASE_URL,
          api: 'openai-completions',
          compat: { supportsReasoningEffort: false },
          models: [{ id: LAB_MODEL, contextWindow: 384000, maxTokens: 16384 }],
        },
      },
    })
    const storageDir = mkdtempSync(join(tmpdir(), 'pipeline-lab-'))
    cleanup.push(storageDir)
    await ctx.plugin(PipelineLocalEngine, { storageDir, llmProvider: 'dgx-spark', llmModel: LAB_MODEL, scheduler: false })
    const engine = ctx.pipelineEngine as InstanceType<typeof PipelineLocalEngine>
    registerScheduledSearch(engine)

    await engine.save({ definition: expandScheduledSearch('sch-lab', 'Lab run', { query: 'LLM agents', summary: true }) })
    const started = engine.startRun({ id: PipelineId('sch-lab'), trigger: 'manual' })
    if (started.outcome !== 'started') throw new Error('expected a started run')
    const result = await started.result
    expect(result.status).toBe('completed')
    expect(result.nodeCount).toBe(6)

    const jsonl = readFileSync(join(storageDir, 'artifacts', 'sch-lab', 'results.jsonl'), 'utf8').trim().split('\n')
    expect(jsonl).toHaveLength(2)
    const first = JSON.parse(jsonl[0] as string) as { arxivId: string; provenance: { provider: string; retrievedAt: string } }
    expect(first.arxivId).toBe('2401.00001v2')
    expect(first.provenance.provider).toBe('arxiv')
    expect(first.provenance.retrievedAt).toBeDefined()
  }, 240_000)
})
