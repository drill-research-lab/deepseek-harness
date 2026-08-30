/**
 * File-backed provider for the pipeline capability seam: persists
 * `WorkflowJSON` definitions under a configured storage root, projects
 * registry summaries, and runs `builtin` and `llm` nodes. Mounted as a
 * service plugin: `ctx.plugin(PipelineLocalEngine, config)`.
 * @module @deepseek-ai/dsh-pipeline-local
 */

import { PipelineLocalEngine } from './engine.ts'

export { PipelineLocalEngine, topoOrder } from './engine.ts'
export { arxivIdFromEntryUrl, buildArxivQueryUrl, canonicalUrlFor, normalizeAtom } from './steps/arxiv.ts'
export type { ArxivRecord, NormalizedResult, SearchConfig, SearchResult } from './steps/arxiv.ts'
export { dedupeKeyFor, expandScheduledSearch, registerScheduledSearch } from './steps/scheduled-search.ts'
export { dedupeStep, normalizeStep, persistStep, searchStep } from './steps/scheduled-search.ts'
export type { DedupeResult, PersistResult, ScheduledSearchInputs } from './steps/scheduled-search.ts'
export type { BuiltinStep, BuiltinStepContext, Config } from './engine.ts'
export { PipelineRpcService } from './service.ts'
export type { TriggerNowResult } from './service.ts'
export { PipelineFileRegistry } from './registry.ts'
export type { PipelineRunRecord } from './registry.ts'

export default PipelineLocalEngine
