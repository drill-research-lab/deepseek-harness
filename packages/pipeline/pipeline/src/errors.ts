/**
 * Typed error for WorkflowJSON schema failures. Machine-routable through the
 * {@link PipelineSchemaErrorCode} taxonomy.
 * @module @deepseek-ai/dsh-pipeline/errors
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/**
 * Why a pipeline definition failed validation. CLOSED union (validator-owned;
 * consumers may exhaust it). Every rejection happens at load — before anything
 * executes — and carries one of these codes.
 */
export type PipelineSchemaErrorCode =
  | 'DEFINITION_INVALID'
  | 'VERSION_UNSUPPORTED'
  | 'ID_INVALID'
  | 'NAME_INVALID'
  | 'DESCRIPTION_INVALID'
  | 'TEMPLATE_REF_INVALID'
  | 'TRIGGER_INVALID'
  | 'TRIGGER_KIND_UNKNOWN'
  | 'CRON_EXPRESSION_INVALID'
  | 'TIME_ZONE_INVALID'
  | 'NODES_INVALID'
  | 'NODE_INVALID'
  | 'NODE_ID_INVALID'
  | 'NODE_ID_DUPLICATE'
  | 'NODE_TYPE_UNKNOWN'
  | 'NODE_FIELD_INVALID'
  | 'EDGES_INVALID'
  | 'EDGE_ENDPOINT_UNKNOWN'
  | 'EDGE_DUPLICATE'
  | 'EDGE_TARGET_TRIGGER'
  | 'CYCLE_DETECTED'

/**
 * Typed error for pipeline-seam schema failures. Extends
 * {@link HarnessError}, so the `code` is machine-routable taxonomy. The
 * message names the offending field path (`nodes[2].prompt`) so a rejected
 * LLM-authored or hand-authored definition pinpoints its first defect.
 */
export class PipelineSchemaError extends HarnessError {
  constructor(message: string, code: PipelineSchemaErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'PipelineSchemaError'
  }
}
