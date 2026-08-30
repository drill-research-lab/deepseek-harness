/**
 * Pipeline capability seam vocabulary: the durable `WorkflowJSON` definition
 * format, its pure validation, and branded ids. The `ctx.pipelineEngine`
 * Service Definition and the `pipeline/*` events land with the engine
 * provider; this module stays model-agnostic.
 * @module @deepseek-ai/dsh-pipeline
 */

export { PipelineSchemaError } from './errors.ts'
export type { PipelineSchemaErrorCode } from './errors.ts'
export { validateWorkflowJson } from './validate.ts'
export { PipelineId, PipelineNodeId, PipelineRunId } from './types.ts'
export type {
  AgentNode,
  BuiltinNode,
  CronTrigger,
  JsonValue,
  LlmNode,
  PipelineEdge,
  PipelineNode,
  PipelineNodeBase,
  PipelineNodeType,
  PipelineTrigger,
  TemplateRef,
  TriggerNode,
  WorkflowJson,
  WorkflowJsonVersion,
} from './types.ts'
