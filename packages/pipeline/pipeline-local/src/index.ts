/**
 * File-backed provider for the pipeline capability seam: persists
 * `WorkflowJSON` definitions under a configured storage root, projects
 * registry summaries, and runs `builtin` and `llm` nodes. Mounted as a
 * service plugin: `ctx.plugin(PipelineLocalEngine, config)`.
 * @module @deepseek-ai/dsh-pipeline-local
 */

import { PipelineLocalEngine } from './engine.ts'

export { PipelineLocalEngine, topoOrder } from './engine.ts'
export type { BuiltinStep, BuiltinStepContext, Config } from './engine.ts'
export { PipelineFileRegistry } from './registry.ts'
export type { PipelineRunRecord } from './registry.ts'

export default PipelineLocalEngine
