import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildArxivQueryUrl,
  dedupeKeyFor,
  dedupeStep,
  expandScheduledSearch,
  normalizeAtom,
  normalizeStep,
  persistStep,
  searchStep,
} from '@deepseek-ai/dsh-pipeline-local'
import type { ArxivRecord } from '@deepseek-ai/dsh-pipeline-local'

const CLEANUP: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'steps-'))
  CLEANUP.push(dir)
  return dir
}

function context(overrides: { stateDir?: string; artifactsDir?: string } = {}): {
  pipelineId: never
  runId: never
  stateDir: string
  artifactsDir: string
} {
  return {
    pipelineId: 'p1' as never,
    runId: 'p1-run-1' as never,
    stateDir: overrides.stateDir ?? tempDir(),
    artifactsDir: overrides.artifactsDir ?? tempDir(),
  }
}

const record: ArxivRecord = {
  arxivId: '2401.00001v2',
  canonicalUrl: 'https://arxiv.org/abs/2401.00001',
  title: 'T',
  authors: [],
  summary: 'S',
  published: '2026-08-28',
  provenance: { provider: 'arxiv', externalId: '2401.00001v2', url: 'https://arxiv.org/abs/2401.00001', retrievedAt: '2026-08-30T00:00:00Z' },
}

afterEach(() => {
  vi.unstubAllGlobals()
  for (const dir of CLEANUP.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('buildArxivQueryUrl', () => {
  it('omits the date window without a last-successful timestamp', () => {
    const url = buildArxivQueryUrl({ query: 'q', maxResults: 5 }, undefined, 0)
    expect(url).not.toContain('%5B')
    expect(url).toContain('max_results=5')
  })

  it('includes the window with both bounds', () => {
    const url = buildArxivQueryUrl({ query: 'q' }, '2026-08-01T00:00:00Z', Date.parse('2026-08-30T00:00:00Z'))
    expect(url).toContain('202608010000')
    expect(url).toContain('202608300000')
  })
})

describe('searchStep', () => {
  it('rejects a missing or empty query', async () => {
    await expect(searchStep(undefined, null, context())).rejects.toThrow('requires a non-empty query')
    await expect(searchStep({ query: '' }, null, context())).rejects.toThrow('requires a non-empty query')
  })

  it('fetches the API and returns the Atom body with retrieval metadata', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<feed/>', { status: 200 })))
    const result = await searchStep({ query: 'q', maxResults: 3 }, null, context())
    expect(result.atom).toBe('<feed/>')
    expect(result.query).toBe('q')
    expect(result.retrievedAt).toBeDefined()
  })

  it('uses the last-successful window from state when present', async () => {
    const stateDir = tempDir()
    writeFileSync(join(stateDir, 'lastSuccessful.json'), JSON.stringify({ lastSuccessfulAt: '2026-08-01T00:00:00Z' }))
    let requested = ''
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      requested = String(url)
      return new Response('<feed/>', { status: 200 })
    }))
    await searchStep({ query: 'q' }, null, { ...context(), stateDir })
    expect(requested).toContain('submittedDate')
  })

  it('survives unreadable or malformed state and opens the window fully', async () => {
    const stateDir = tempDir()
    writeFileSync(join(stateDir, 'lastSuccessful.json'), '{ broken')
    let requested = ''
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      requested = String(url)
      return new Response('<feed/>', { status: 200 })
    }))
    await searchStep({ query: 'q' }, null, { ...context(), stateDir })
    expect(requested).not.toContain('%5B')
  })

  it('throws on a non-ok arXiv response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 503 })))
    await expect(searchStep({ query: 'q' }, null, context())).rejects.toThrow('503')
  })
})

describe('normalizeAtom / normalizeStep', () => {
  it('tolerates a degraded entry with missing fields and attributes', () => {
    const atom = '<?xml version="1.0"?><feed><entry><id>http://arxiv.org/abs/1v1</id><author></author><link title="doi" rel="related"/><primary_category/></entry></feed>'
    const records = normalizeAtom(atom, '2026-08-30T00:00:00Z')
    expect(records[0]).toMatchObject({ arxivId: '1v1', title: '', authors: [''], summary: '', published: '', primaryCategory: '' })
  })

  it('returns no records for an empty feed', () => {
    expect(normalizeAtom('<feed></feed>', '2026-08-30T00:00:00Z')).toEqual([])
  })

  it('falls back to the doi link href when the bare doi field is absent', () => {
    const records = normalizeAtom(
      '<?xml version="1.0"?><feed><entry><id>http://arxiv.org/abs/2v1</id><link title="doi" href="http://dx.doi.org/10.1/x" rel="related"/></entry></feed>',
      '2026-08-30T00:00:00Z',
    )
    expect(records[0]?.doi).toBe('http://dx.doi.org/10.1/x')
  })

  it('rejects an input without the search atom', async () => {
    await expect(normalizeStep(undefined, {})).rejects.toThrow('expects the search step output')
  })

  it('stamps its own retrieval time when the search output lacks one', async () => {
    const result = await normalizeStep(undefined, { atom: '<feed><entry><id>http://arxiv.org/abs/1v1</id></entry></feed>' })
    expect(result.records[0]?.provenance.retrievedAt).toBeDefined()
  })
})

describe('dedupeStep / persistStep', () => {
  it('rejects a dedupe input without the normalize records', async () => {
    await expect(dedupeStep(undefined, {}, context())).rejects.toThrow('expects the normalize step output')
  })

  it('rejects a persist input without the dedupe records', async () => {
    await expect(persistStep(undefined, {}, context())).rejects.toThrow('expects the dedupe step output')
  })

  it('persists to the destination config override and records the seen state', async () => {
    const stateDir = tempDir()
    const destination = tempDir()
    const result = await persistStep({ destination }, { new: [record], skipped: 2 }, { ...context(), stateDir })
    expect(result).toMatchObject({ persisted: 1, skipped: 2, destination })
    const jsonl = readFileSync(join(destination, 'results.jsonl'), 'utf8')
    expect(jsonl).toContain('2401.00001v2')
    expect(readFileSync(join(stateDir, 'seen.json'), 'utf8')).toContain('firstSeenRun')
    expect(readFileSync(join(stateDir, 'lastSuccessful.json'), 'utf8')).toContain('lastSuccessfulAt')
  })

  it('counts an empty-arxiv-id record under its doi key, and an empty doi under the url', () => {
    const doiRecord: ArxivRecord = { ...record, arxivId: '', doi: '10.1/y' }
    expect(dedupeKeyFor(doiRecord)).toBe('10.1/y')
    expect(dedupeKeyFor({ ...record, arxivId: '', doi: '' })).toBe('https://arxiv.org/abs/2401.00001')
  })

  it('defaults the skip count when the dedupe output omits it', async () => {
    const destination = tempDir()
    const result = await persistStep({ destination }, { new: [record] }, context())
    expect(result.skipped).toBe(0)
    expect(result.destination).toBe(destination)
  })
})

describe('expandScheduledSearch', () => {
  it('carries the destination config and max results into the expanded definition', () => {
    const destination = tempDir()
    const json = JSON.stringify(expandScheduledSearch('sch-x', 'X', { query: 'q', maxResults: 7, destination }))
    expect(json).toContain('"maxResults":7')
    expect(json).toContain(destination)
  })
})
