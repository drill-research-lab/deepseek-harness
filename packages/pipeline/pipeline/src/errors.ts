/**
 * Typed errors for the pipeline seam, machine-routable through two closed
 * code taxonomies: {@link PipelineSchemaError} for WorkflowJSON validation
 * and {@link PipelineError} for the operations around it.
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
 * Typed error for WorkflowJSON schema failures. Extends
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

/**
 * Why a pipeline-seam operation failed outside schema validation. CLOSED
 * union (engine-owned; consumers may exhaust it); it grows only with an
 * operation that can fail that way today.
 */
export type PipelineErrorCode = 'PIPELINE_UNKNOWN'

/**
 * Typed error for pipeline-seam operations. Extends
 * {@link HarnessError}, so the `code` is machine-routable taxonomy. Schema
 * failures use {@link PipelineSchemaError}; this class covers the operations
 * around it (an unknown pipeline id on `startRun`).
 */
export class PipelineError extends HarnessError {
  constructor(message: string, code: PipelineErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'PipelineError'
  }
}
