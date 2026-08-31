/**
 * Typert Remote face over the local pipeline engine: the BFF's `pipelines`
 * namespace. Wire payloads are the engine's plain-JSON views (definitions,
 * summaries, run records); ids travel as strings and are branded here.
 * @module @deepseek-ai/dsh-pipeline-local/service
 */

import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { PipelineId } from '@deepseek-ai/dsh-pipeline'
import type { PipelineSummary, WorkflowJson } from '@deepseek-ai/dsh-pipeline/types'
import type { PipelineRunDetail, PipelineRunRecord, TriggerNowResult } from './types.ts'
import { expandScheduledSearch, type ScheduledSearchInputs } from './steps/scheduled-search.ts'
import type { PipelineLocalEngine } from './engine.ts'

/**
 * The pipelines Remote service over one {@link PipelineLocalEngine}. Mounted
 * by that engine, so the engine lookup cannot fail on a live composition.
 */
export class PipelineRpcService extends TypertRemoteService {
  /**
   * Register the service under the `pipelines` Remote namespace.
   * @param ctx - owning Cordis Context.
   */
  constructor(ctx: Context) {
    super(ctx, 'pipelines')
  }

  /** The concrete engine; mounted only by `PipelineLocalEngine`, so the seam key resolves it. */
  private get engine(): PipelineLocalEngine {
    return this.ctx.pipelineEngine as PipelineLocalEngine
  }

  /**
   * List every pipeline's projection with live run status.
   * @returns the summaries, in definition-id order.
   */
  @Remote('list')
  list(): readonly PipelineSummary[] {
    return this.engine.list()
  }

  /**
   * Read one pipeline's definition.
   * @param id - the pipeline's id.
   * @returns the definition, or `undefined` when unknown.
   */
  @Remote('get')
  get(id: string): WorkflowJson | undefined {
    return this.engine.get(PipelineId(id))
  }

  /**
   * Validate and persist one definition (the JSON import path).
   * @param definition - the WorkflowJSON document.
   * @returns the stored definition.
   */
  @Remote('save')
  save(definition: WorkflowJson): Promise<WorkflowJson> {
    return this.engine.save({ definition })
  }

  /**
   * Delete one pipeline and its runs.
   * @param id - the pipeline's id.
   * @returns whether anything was deleted.
   */
  @Remote('delete')
  delete(id: string): Promise<boolean> {
    return this.engine.delete(PipelineId(id))
  }

  /**
   * Pause (`false`) or resume (`true`) one pipeline's scheduled triggers.
   * @param id - the pipeline's id.
   * @param enabled - the enabled flag.
   * @returns whether the pipeline exists.
   */
  @Remote('setEnabled')
  setEnabled(id: string, enabled: boolean): Promise<boolean> {
    return this.engine.setEnabled(PipelineId(id), enabled)
  }

  /**
   * Start a manual run and wait for it to settle. A pipeline that is already
   * running reports the overlap skip instead of queueing (D12).
   * @param id - the pipeline's id.
   * @returns the settled run facts, or the skip.
   */
  @Remote('triggerNow')
  async triggerNow(id: string): Promise<TriggerNowResult> {
    const started = this.engine.startRun({ id: PipelineId(id), trigger: 'manual' })
    if (started.outcome === 'skipped') return { outcome: 'skipped', reason: started.reason }
    return { outcome: 'started', runId: started.runId, result: await started.result }
  }

  /**
   * Create one Scheduled Search pipeline from template inputs: the id is
   * minted from the name (deduplicated with a suffix when taken), the
   * definition is expanded server-side, and the validated result is
   * persisted. The template-gallery submit path.
   * @param request - the display name plus the Scheduled Search inputs.
   * @returns the stored definition.
   */
  @Remote('createFromTemplate')
  createFromTemplate(request: { name: string; inputs: ScheduledSearchInputs }): Promise<WorkflowJson> {
    /* v8 ignore next 2 -- the second disjunct covers a name with no slug-safe
     * characters; the shipped template gallery always submits a real name. */
    const base = request.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'sch-pipeline'
    const id = this.engine.hasPipeline(PipelineId(base)) ? `${base}-${Date.now().toString(36)}` : base
    return this.save(expandScheduledSearch(id, request.name, request.inputs) as unknown as WorkflowJson)
  }

  /**
   * List one pipeline's settled runs, oldest first.
   * @param id - the pipeline's id.
   * @returns the run records.
   */
  @Remote('runs')
  runs(id: string): readonly PipelineRunRecord[] {
    return this.engine.listRuns(PipelineId(id))
  }

  /**
   * Read one settled run with its node projection.
   * @param id - the pipeline's id.
   * @param ordinal - the run's ordinal.
   * @returns the run detail, or `undefined` when unknown.
   */
  @Remote('run')
  run(id: string, ordinal: number): Promise<PipelineRunDetail | undefined> {
    return this.engine.readRunDetail(PipelineId(id), ordinal)
  }
}
