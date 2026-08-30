/**
 * The Scheduled Search template's search and normalize steps: one arXiv API
 * query (politeness budget: the template issues a single request per run),
 * Atom parsing, and metadata normalization into records with provenance.
 * @module @deepseek-ai/dsh-pipeline-local/steps/arxiv
 */

import { XMLParser } from 'fast-xml-parser'
import type { JsonValue } from '@deepseek-ai/dsh-pipeline'
import type { BuiltinStepContext } from '../engine.ts'

/** One normalized arXiv record with its provenance. */
export type ArxivRecord = {
  /** arXiv id with version (`2401.00001v2`). */
  arxivId: string
  /** Canonical abs URL without the version suffix. */
  canonicalUrl: string
  title: string
  authors: string[]
  summary: string
  published: string
  primaryCategory?: string
  /** The registration DOI when arXiv reports one. */
  doi?: string
  provenance: {
    /** The source provider. */
    provider: 'arxiv'
    /** The provider's stable external id (the arXiv id). */
    externalId: string
    /** The canonical source URL. */
    url: string
    /** RFC 3339 retrieval timestamp. */
    retrievedAt: string
  }
}

/** Config accepted by the `scheduled-search/search` step. */
export interface SearchConfig {
  /** The free-text query sent to the arXiv API. */
  query: string
  /** Fetch cap per run (default 20). */
  maxResults?: number
}

/** Output of the `scheduled-search/search` step: raw Atom beside retrieval metadata. */
export type SearchResult = {
  /** The raw Atom response body. */
  atom: string
  /** RFC 3339 retrieval timestamp. */
  retrievedAt: string
  /** The query actually sent. */
  query: string
}

/** Output of the `scheduled-search/normalize` step. */
export type NormalizedResult = {
  records: ArxivRecord[]
}

const API_BASE = 'https://export.arxiv.org/api/query'

/**
 * Build the arXiv API URL for one search: the free-text query, optionally
 * bounded by a `submittedDate` window (the last successful run through now,
 * arXiv's `YYYYMMDDHHMM` format), newest first.
 * @param config - the search config.
 * @param lastSuccessfulAt - RFC 3339 timestamp of the last successful run, when known.
 * @param nowMs - the current epoch milliseconds.
 * @returns the request URL.
 */
export function buildArxivQueryUrl(config: SearchConfig, lastSuccessfulAt: string | undefined, nowMs: number): string {
  const maxResults = config.maxResults ?? 20
  let searchQuery = `all:${JSON.stringify(config.query)}`
  if (lastSuccessfulAt !== undefined) {
    const from = new Date(lastSuccessfulAt)
    const to = new Date(nowMs)
    const arxivFormat = (date: Date): string => {
      const pad = (value: number, width: number): string => String(value).padStart(width, '0')
      return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1, 2)}${pad(date.getUTCDate(), 2)}${pad(date.getUTCHours(), 2)}${pad(date.getUTCMinutes(), 2)}`
    }
    searchQuery += ` AND submittedDate:[${arxivFormat(from)} TO ${arxivFormat(to)}]`
  }
  const params = new URLSearchParams({
    search_query: searchQuery,
    sortBy: 'submittedDate',
    sortOrder: 'descending',
    max_results: String(maxResults),
  })
  return `${API_BASE}?${params.toString()}`
}

/** Extract the arXiv id (with version) from an Atom entry id URL. */
export function arxivIdFromEntryUrl(url: string): string {
  return url.replace(/^https?:\/\/arxiv\.org\/abs\//, '')
}

/** The canonical abs URL for one arXiv id: the version suffix stripped. */
export function canonicalUrlFor(arxivId: string): string {
  return `https://arxiv.org/abs/${arxivId.replace(/v\d+$/, '')}`
}

/**
 * The `scheduled-search/search` step: one arXiv API request returning the raw
 * Atom body. The template issues a single request per run, within arXiv's
 * three-second politeness budget.
 * @param config - the step config ({@link SearchConfig}).
 * @param _input - the upstream (trigger) output, unused.
 * @param context - the step context; `stateDir` supplies the last-successful-run window.
 */
export const searchStep = async (
  config: JsonValue | undefined,
  _input: JsonValue,
  context: BuiltinStepContext,
): Promise<SearchResult> => {
  const parsed = (config ?? {}) as Partial<SearchConfig>
  if (typeof parsed.query !== 'string' || parsed.query.length === 0) {
    throw new Error('scheduled-search/search requires a non-empty query in its config')
  }
  const searchConfig: SearchConfig = { query: parsed.query, ...(parsed.maxResults !== undefined ? { maxResults: parsed.maxResults } : {}) }
  let lastSuccessfulAt: string | undefined
  try {
    const state = await import('node:fs').then(fs => fs.readFileSync(`${context.stateDir}/lastSuccessful.json`, 'utf8'))
    lastSuccessfulAt = (JSON.parse(state) as { lastSuccessfulAt?: string }).lastSuccessfulAt
  } catch {
    // First run (or unreadable state): the window opens fully and dedupe
    // bounds the result set instead.
    lastSuccessfulAt = undefined
  }
  const url = buildArxivQueryUrl(searchConfig, lastSuccessfulAt, Date.now())
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`arXiv API returned ${String(response.status)}`)
  }
  return { atom: await response.text(), retrievedAt: new Date().toISOString(), query: searchConfig.query }
}

/** Parse one arXiv Atom document into normalized records. */
export function normalizeAtom(atom: string, retrievedAt: string): ArxivRecord[] {
  const parser = new XMLParser({
    removeNSPrefix: true,
    ignoreAttributes: false,
    attributeNamePrefix: '',
    isArray: name => name === 'author' || name === 'entry' || name === 'link',
  })
  const doc = parser.parse(atom) as {
    feed?: { entry?: Array<Record<string, unknown>> }
  }
  const entries = doc.feed?.entry ?? []
  const asString = (value: unknown): string => (typeof value === 'string' ? value : '')
  return entries.map((entry) => {
    const url = asString(entry.id)
    const arxivId = arxivIdFromEntryUrl(url)
    const links: readonly unknown[] = Array.isArray(entry.link) ? entry.link : []
    const doiLink = links.find(link => (link as { title?: unknown }).title === 'doi')
    const entryDoi: unknown = entry.doi
    const record: ArxivRecord = {
      arxivId,
      canonicalUrl: canonicalUrlFor(arxivId),
      title: asString(entry.title),
      authors: (Array.isArray(entry.author) ? entry.author : []).map(author => asString((author as { name?: unknown }).name)),
      summary: asString(entry.summary).trim(),
      published: asString(entry.published),
      ...(typeof entryDoi === 'string' ? { doi: entryDoi } : {}),
      ...(doiLink !== undefined && typeof entryDoi !== 'string' ? { doi: asString((doiLink as { href?: unknown }).href) } : {}),
      provenance: {
        provider: 'arxiv',
        externalId: arxivId,
        url: canonicalUrlFor(arxivId),
        retrievedAt,
      },
    }
    const primaryCategory = entry.primary_category
    if (primaryCategory !== undefined && primaryCategory !== null) {
      record.primaryCategory = asString((primaryCategory as { term?: unknown }).term)
    }
    return record
  })
}

/**
 * The `scheduled-search/normalize` step: raw Atom in, normalized records out.
 * @param _config - unused.
 * @param input - the search step's output.
 */
export const normalizeStep = (_config: JsonValue | undefined, input: JsonValue): Promise<NormalizedResult> => {
  const search = input as Partial<SearchResult>
  if (typeof search.atom !== 'string') return Promise.reject(new Error('scheduled-search/normalize expects the search step output'))
  return Promise.resolve({ records: normalizeAtom(search.atom, search.retrievedAt ?? new Date().toISOString()) })
}
