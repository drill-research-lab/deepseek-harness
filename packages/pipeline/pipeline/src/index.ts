/**
 * Service Definition for the pipeline capability seam. Service Providers
 * persist definitions, evaluate the DAG over subagent/LLM/builtin executors,
 * and schedule cron triggers; lifecycle events are observe-only and never
 * expose run control. `save` is the durable parser boundary: it validates the
 * incoming definition on every path.
 * @module @deepseek-ai/dsh-pipeline
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  PipelineDefinitionChange,
  PipelineNodeEndInfo,
  PipelineNodeInfo,
  PipelineRunInfo,
  PipelineRunRequest,
  PipelineRunResultInfo,
  PipelineRunStart,
  PipelineSaveRequest,
  PipelineSummary,
  WorkflowJson,
} from './types.ts'
import { PipelineId } from './types.ts'
import { PipelineError } from './errors.ts'

export { PipelineError, PipelineSchemaError } from './errors.ts'
export type { PipelineErrorCode, PipelineSchemaErrorCode } from './errors.ts'
export { validateWorkflowJson } from './validate.ts'
export { PipelineId, PipelineNodeId, PipelineRunId } from './types.ts'
export type {
  AgentNode,
  BuiltinNode,
  CronTrigger,
  JsonValue,
  LlmNode,
  PipelineDefinitionChange,
  PipelineDefinitionChangeKind,
  PipelineEdge,
  PipelineNode,
  PipelineNodeBase,
  PipelineNodeEndInfo,
  PipelineNodeInfo,
  PipelineNodeOutcome,
  PipelineNodeType,
  PipelineRunInfo,
  PipelineRunRequest,
  PipelineRunResultInfo,
  PipelineRunStart,
  PipelineRunStatus,
  PipelineRunTrigger,
  PipelineSaveRequest,
  PipelineSummary,
  PipelineTrigger,
  TemplateRef,
  TriggerNode,
  WorkflowJson,
  WorkflowJsonVersion,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    pipelineEngine: PipelineEngine
  }

  interface Events {
    /**
     * A persisted definition changed — saved, deleted, paused, or resumed.
     * Fired after the registry mutation commits.
     * @param change - the definition's id and what changed.
     * @mode emit
     */
    'pipeline/definition-changed'(change: PipelineDefinitionChange): void
    /**
     * A run started — the definition validated and accepted past the overlap
     * policy. Paired with {@link Events['pipeline/run-end']}.
     * @param info - the run's identity snapshot.
     * @mode emit
     */
    'pipeline/run-start'(info: PipelineRunInfo): void
    /**
     * One node started executing. Paired with
     * {@link Events['pipeline/node-end']} by `node.nodeId` on every stop
     * path; a node the run never reaches emits neither event.
     * @param info - the run's identity snapshot.
     * @param node - the node's id and type.
     * @mode emit
     */
    'pipeline/node-start'(info: PipelineRunInfo, node: PipelineNodeInfo): void
    /**
     * One node settled (completed, failed, or skipped). Paired with
     * {@link Events['pipeline/node-start']} by `node.nodeId`.
     * @param info - the run's identity snapshot.
     * @param node - the node's settlement (outcome plus failure message).
     * @mode emit
     */
    'pipeline/node-end'(info: PipelineRunInfo, node: PipelineNodeEndInfo): void
    /**
     * A run settled (completed or failed). Fired when the started run's
     * `result` resolves. Paired with {@link Events['pipeline/run-start']}.
     * @param info - the run's identity snapshot.
     * @param result - the outcome data (status, error, node count) —
     *   deliberately WITHOUT node output values.
     * @mode emit
     */
    'pipeline/run-end'(info: PipelineRunInfo, result: PipelineRunResultInfo): void
  }
}

/** The full set of `pipeline/*` event names {@link PipelineEngine.emitPipelineEvent} dispatches. */
export type PipelineEventName =
  | 'pipeline/definition-changed'
  | 'pipeline/run-start'
  | 'pipeline/node-start'
  | 'pipeline/node-end'
  | 'pipeline/run-end'

/**
 * Pipeline Service Definition contract. `save` validates at the durable
 * parser boundary and fails loud; every mutation emits
 * `pipeline/definition-changed` only after it commits; `startRun` applies the
 * overlap policy and reports skips as data, never as a thrown error.
 * Lifecycle listener failures are contained, and `pipeline/run-end` fires
 * exactly once per accepted run.
 */
export abstract class PipelineEngine extends Service {
  constructor(ctx: Context) {
    super(ctx, 'pipelineEngine')
  }

  /**
   * List every persisted pipeline's registry projection, in registry order.
   * @returns the summaries; empty when nothing is persisted.
   */
  abstract list(): readonly PipelineSummary[]

  /**
   * Read one persisted definition.
   * @param id - the pipeline's id.
   * @returns the validated definition, or undefined when the id is unknown.
   */
  abstract get(id: PipelineId): WorkflowJson | undefined

  /**
   * Validate and persist a definition (create or replace by its id).
   * @param request - the candidate definition as raw JSON data; validated
   *   here on every path.
   * @returns the validated definition that was persisted.
   * @throws PipelineSchemaError when the definition fails validation.
   */
  abstract save(request: PipelineSaveRequest): Promise<WorkflowJson>

  /**
   * Delete a definition and its registry entry. Run sessions and output
   * artifacts are kept (deletion never destroys recorded data).
   * @param id - the pipeline's id.
   * @returns true when the definition existed and was deleted; false when unknown.
   */
  abstract delete(id: PipelineId): Promise<boolean>

  /**
   * Pause or resume a pipeline's trigger.
   * @param id - the pipeline's id.
   * @param enabled - true resumes the trigger; false pauses it.
   * @returns true when the definition existed; false when unknown.
   */
  abstract setEnabled(id: PipelineId, enabled: boolean): Promise<boolean>

  /**
   * Start a run of one pipeline, applying the overlap policy: when the
   * pipeline already has a run executing, the trigger is skipped and
   * reported as data.
   * @param request - the pipeline id and the triggering lane.
   * @returns the started run's handle, or the recorded skip.
   * @throws PipelineError with code `'PIPELINE_UNKNOWN'` when the id is unknown.
   */
  abstract startRun(request: PipelineRunRequest): PipelineRunStart

  /**
   * Emit a lifecycle event while containing listener failures: a throwing or
   * rejecting listener logs a warning and never starves later listeners.
   * Listeners run synchronously in registration order; only a returned
   * thenable's rejection is contained asynchronously.
   * @param name - the `pipeline/*` event to dispatch.
   * @param args - the event's payload, matching its declared signature.
   */
  protected emitPipelineEvent(name: PipelineEventName, ...args: unknown[]): void {
    for (const callback of this.ctx.events.dispatch('emit', [name, ...args])) {
      try {
        const returned: unknown = (callback as (...listenerArgs: unknown[]) => unknown)(...args)
        void Promise.resolve(returned).catch((error: unknown) => {
          this.logListenerFailure(name, error)
        })
      } catch (error: unknown) {
        this.logListenerFailure(name, error)
      }
    }
  }

  /**
   * Log one contained listener failure without propagating it.
   * @param name - the event whose listener failed.
   * @param error - the thrown or rejected value.
   */
  private logListenerFailure(name: string, error: unknown): void {
    this.ctx.logger.warn(`pipeline: ${name} listener failed: ${String(error)}`)
  }

  /**
   * Reject an unknown pipeline id with the seam's typed failure.
   * @param id - the id that resolved to nothing.
   * @returns never; the throw is the point.
   */
  protected unknownPipeline(id: PipelineId): never {
    throw new PipelineError(`pipeline ${JSON.stringify(id)} is not persisted`, 'PIPELINE_UNKNOWN')
  }
}

export default PipelineEngine
