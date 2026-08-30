/**
 * The Scheduled Search template: the dedupe and persist steps, the template
 * expansion into a WorkflowJSON definition, and the builtin-step
 * registration that wires them onto an engine.
 * @module @deepseek-ai/dsh-pipeline-local/steps/scheduled-search
 */

import { existsSync, readFileSync } from 'node:fs'
import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { JsonValue } from '@deepseek-ai/dsh-pipeline'
import type { BuiltinStep, BuiltinStepContext, PipelineLocalEngine } from '../engine.ts'
import type { ArxivRecord, NormalizedResult } from './arxiv.ts'
import { normalizeStep, searchStep } from './arxiv.ts'
export { normalizeStep, searchStep } from './arxiv.ts'

/** Inputs accepted by the Scheduled Search template. */
import type { ScheduledSearchInputs } from '../types.ts'

export type { ScheduledSearchInputs } from '../types.ts'

/** Output of the `scheduled-search/dedupe` step. */
export type DedupeResult = {
  /** Records not seen by any previous run. */
  new: ArxivRecord[]
  /** How many records the dedupe keys had already recorded. */
  skipped: number
}

/** Output of the `scheduled-search/persist` step (passes the new records through). */
export type PersistResult = DedupeResult & {
  /** How many records were appended to the destination. */
  persisted: number
  /** The destination directory the records were written to. */
  destination: string
}

/** The per-pipeline dedupe state (`state/seen.json`). */
interface SeenState {
  /** Dedupe key (arXiv id, else DOI, else canonical URL) → first-seen metadata. */
  keys: Record<string, { firstSeenRun: string }>
}

/** The dedupe key for one record: arXiv id, else DOI, else canonical URL. */
export function dedupeKeyFor(record: ArxivRecord): string {
  if (record.arxivId !== '') return record.arxivId
  if (record.doi !== undefined && record.doi !== '') return record.doi
  return record.canonicalUrl
}

/** Read the per-pipeline seen state, or an empty state when absent. */
function readSeenState(context: BuiltinStepContext): SeenState {
  const path = join(context.stateDir, 'seen.json')
  if (!existsSync(path)) return { keys: {} }
  return JSON.parse(readFileSync(path, 'utf8')) as SeenState
}

/**
 * The `scheduled-search/dedupe` step: partitions normalized records into new
 * and already-seen by the arXiv-id → DOI → canonical-URL key priority. Pure
 * with respect to the state: it writes nothing — the persist step records
 * keys only after the artifacts land (a crash between the two re-processes
 * safely, never silently drops).
 * @param _config - unused.
 * @param input - the normalize step's output.
 * @param context - the step context; `stateDir` holds the seen state.
 */
export const dedupeStep = async (_config: JsonValue | undefined, input: JsonValue, context: BuiltinStepContext): Promise<DedupeResult> => {
  const { records } = input as Partial<NormalizedResult>
  if (!Array.isArray(records)) return Promise.reject(new Error('scheduled-search/dedupe expects the normalize step output'))
  const seen = readSeenState(context)
  const fresh: ArxivRecord[] = []
  let skipped = 0
  for (const record of records) {
    if (seen.keys[dedupeKeyFor(record)] !== undefined) {
      skipped += 1
    } else {
      fresh.push(record)
    }
  }
  return { new: fresh, skipped }
}

/**
 * The `scheduled-search/persist` step: appends the new records (with
 * provenance) to the destination's `results.jsonl`, records their dedupe
 * keys, and stamps the last-successful-run window.
 * @param config - the step config (`destination` overrides the context's artifact directory).
 * @param input - the dedupe step's output.
 * @param context - the step context (`stateDir` for state, `runId` for provenance).
 */
export const persistStep = async (config: JsonValue | undefined, input: JsonValue, context: BuiltinStepContext): Promise<PersistResult> => {
  const { new: fresh, skipped } = input as Partial<DedupeResult>
  if (!Array.isArray(fresh)) throw new Error('scheduled-search/persist expects the dedupe step output')
  const destination = (config as { destination?: string } | undefined)?.destination ?? context.artifactsDir
  await mkdir(destination, { recursive: true })
  const retrievedAt = new Date().toISOString()
  for (const record of fresh) {
    const line = `${JSON.stringify({ ...record, pipelineId: String(context.pipelineId), runId: String(context.runId), persistedAt: retrievedAt })}\n`
    await appendFile(join(destination, 'results.jsonl'), line)
  }
  const seen = readSeenState(context)
  for (const record of fresh) {
    seen.keys[dedupeKeyFor(record)] = { firstSeenRun: String(context.runId) }
  }
  await writeFile(join(context.stateDir, 'seen.json'), `${JSON.stringify(seen, null, 2)}\n`)
  await writeFile(join(context.stateDir, 'lastSuccessful.json'), `${JSON.stringify({ lastSuccessfulAt: retrievedAt }, null, 2)}\n`)
  return { new: fresh, skipped: skipped ?? 0, persisted: fresh.length, destination }
}

/**
 * Expand the Scheduled Search template into a concrete definition: trigger →
 * search → normalize → dedupe → persist, with the optional LLM summary node
 * appended when `inputs.summary` is on (D14).
 * @param id - the new pipeline's id (kebab-case).
 * @param name - the new pipeline's display name.
 * @param inputs - the template inputs.
 * @returns the definition, ready for `engine.save`.
 */
export function expandScheduledSearch(id: string, name: string, inputs: ScheduledSearchInputs): Record<string, unknown> {
  const trigger = {
    kind: 'cron',
    expression: inputs.cron ?? '0 9 * * 1',
    timeZone: inputs.timeZone ?? 'UTC',
    enabled: true,
  }
  const nodes: Array<Record<string, unknown>> = [
    { id: 'trigger', type: 'trigger' },
    { id: 'search', type: 'builtin', ref: 'scheduled-search/search', config: { query: inputs.query, ...(inputs.maxResults !== undefined ? { maxResults: inputs.maxResults } : {}) } },
    { id: 'normalize', type: 'builtin', ref: 'scheduled-search/normalize' },
    { id: 'dedupe', type: 'builtin', ref: 'scheduled-search/dedupe' },
    { id: 'persist', type: 'builtin', ref: 'scheduled-search/persist', config: inputs.destination !== undefined ? { destination: inputs.destination } : undefined },
  ]
  if (inputs.summary === true) {
    nodes.push({ id: 'summarize', type: 'llm', prompt: 'Summarize the newly collected records for the researcher.' })
  }
  const edges: Array<Record<string, unknown>> = [
    { from: 'trigger', to: 'search' },
    { from: 'search', to: 'normalize' },
    { from: 'normalize', to: 'dedupe' },
    { from: 'dedupe', to: 'persist' },
  ]
  if (inputs.summary === true) edges.push({ from: 'persist', to: 'summarize' })
  return {
    version: 1,
    id,
    name,
    template: {
      ref: 'scheduled-search',
      inputs: {
        query: inputs.query,
        ...(inputs.cron !== undefined ? { cron: inputs.cron } : {}),
        ...(inputs.timeZone !== undefined ? { timeZone: inputs.timeZone } : {}),
        ...(inputs.maxResults !== undefined ? { maxResults: inputs.maxResults } : {}),
      },
    },
    trigger,
    nodes,
    edges,
  }
}

/**
 * Register the Scheduled Search template's builtin steps onto an engine.
 * @param engine - the provider whose `registerBuiltin` the steps mount on.
 */
export function registerScheduledSearch(engine: PipelineLocalEngine): void {
  const steps: Array<[string, BuiltinStep]> = [
    ['scheduled-search/search', searchStep],
    ['scheduled-search/normalize', normalizeStep],
    ['scheduled-search/dedupe', dedupeStep],
    ['scheduled-search/persist', persistStep],
  ]
  for (const [ref, step] of steps) engine.registerBuiltin(ref, step)
}
