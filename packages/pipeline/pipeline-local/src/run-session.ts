/**
 * Run-session projection: every pipeline run owns a background session whose
 * log carries the run's node lifecycle — the durable source for per-node
 * input/output, duration, status, and error detail. The registry's run
 * records keep only list metrics; `readRunDetail` folds the full projection
 * back out of the session log.
 *
 * Every `pipeline/*` session event is appended with the envelope's
 * `ignorable` mark: the events are informational records whose loss cannot
 * affect session reconstruction, so readers that do not know the vocabulary
 * skip them instead of refusing the log.
 * @module @deepseek-ai/dsh-pipeline-local/run-session
 */

import { randomBytes } from 'node:crypto'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import { type Session, SessionId, type SessionStore } from '@deepseek-ai/dsh-session'
import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue, PipelineRunStatus } from '@deepseek-ai/dsh-pipeline/types'
import type { PipelineRunNodeOutcome } from './types.ts'

/**
 * The current run-session projection format version, stamped into the
 * descriptor event and required verbatim by {@link foldRunNodes}. Supporting
 * another node outcome kind is a deliberate version change.
 */
export const RUN_SESSION_DESCRIPTOR_VERSION = 1

/** Identity block opening every run session's log. */
export interface PipelineRunDescriptorData {
  /** Descriptor format version ({@link RUN_SESSION_DESCRIPTOR_VERSION}). */
  readonly version: number
  /** The pipeline's id. */
  readonly pipelineId: string
  /** The run's id; also the session's id. */
  readonly runId: string
  /** The pipeline's display name at run time. */
  readonly pipelineName: string
  /** What lane started the run. */
  readonly trigger: 'manual' | 'scheduled'
}

/** One node's execution window opening. */
export interface PipelineNodeStartedData {
  /** The node's id within the definition. */
  readonly nodeId: string
  /** The node's type (`trigger`, `builtin`, or `llm`). */
  readonly nodeType: string
}

/** One node's settled outcome. */
export interface PipelineNodeSettledData {
  /** The node's id within the definition. */
  readonly nodeId: string
  /** The node's type (`trigger`, `builtin`, or `llm`). */
  readonly nodeType: string
  /** How the node settled: executed, failed, or skipped (disabled or unreachable). */
  readonly outcome: 'completed' | 'failed' | 'skipped'
  /** Wall-clock execution time; `0` for skipped nodes. */
  readonly durationMs: number
  /** The node's JSON output (present iff `outcome` is `'completed'`). */
  readonly output?: JsonValue
  /** The failure message (present iff `outcome` is `'failed'`). */
  readonly error?: string
}

/** The run's settled facts, closing the log. */
export interface PipelineRunSettledData {
  /** How the run settled. */
  readonly status: PipelineRunStatus
  /** Wall-clock run time. */
  readonly durationMs: number
  /** How many nodes produced an outcome (skipped nodes excluded). */
  readonly nodeCount: number
  /** The failure message (present iff `status` is `'failed'`). */
  readonly error?: string
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Opens a pipeline run's session log with the run's identity. Log-only
     * and appended with the `ignorable` mark: informational projection whose
     * loss cannot affect session reconstruction.
     */
    'pipeline/run-descriptor': PipelineRunDescriptorData
    /**
     * Marks one node's execution window opening. Log-only and appended with
     * the `ignorable` mark.
     */
    'pipeline/node-started': PipelineNodeStartedData
    /**
     * Closes one node's execution window with its outcome and, when executed,
     * its JSON output. Log-only and appended with the `ignorable` mark.
     */
    'pipeline/node-settled': PipelineNodeSettledData
    /**
     * Closes the run with its settled facts. Log-only and appended with the
     * `ignorable` mark.
     */
    'pipeline/run-settled': PipelineRunSettledData
  }
}

/**
 * One run's session log writer. The session lives in a per-run scope so its
 * teardown rides {@link settled}: disposing the scope detaches the session,
 * which flushes the write-behind persistence and retires the live entry.
 */
/** The detach handle captured by the scope effect; read back at settle. */
interface DetachHolder {
  current?: () => void
}

export class PipelineRunSession {
  private constructor(
    private readonly scope: Scope,
    private readonly detachHolder: DetachHolder,
    readonly id: SessionId,
    private readonly session: Session,
  ) {}

  /**
   * Open one run's session and append its descriptor.
   * @param ctx - the engine's context; the per-run scope hangs off it.
   * @param descriptor - the run identity appended as the log's first event.
   * @returns the writer.
   */
  static open(ctx: Context, descriptor: PipelineRunDescriptorData): PipelineRunSession {
    const scope = createScope(ctx, {})
    const sessions = scope.ctx.get('sessions')
    if (sessions === undefined) {
      throw new Error('no session store is mounted: pipeline run sessions need ctx.sessions')
    }
    // The session id extends the run id with a random suffix: deleting and
    // re-creating a pipeline resets its ordinal sequence, so bare run ids
    // recur across the deployment's lifetime, and the persistence layer
    // (correctly) refuses a second live session colliding with a stored log.
    const session = sessions.prepare(SessionId(`${descriptor.runId}-${randomBytes(4).toString('base64url')}`), { meta: { origin: 'pipeline' } })
    // Fold the store attachment into the per-run scope: create() would pin the
    // detach disposer to the session store's own fiber (never unloaded mid-process),
    // leaking every run session as a live store entry. The detach also rides the
    // scope's unwind as a backstop; settled() reads the holder directly so the
    // retirement never depends on the disposal timing.
    const detachHolder: DetachHolder = {}
    scope.ctx.effect(function* (this: SessionStore) {
      detachHolder.current = this.enter(session)
      this.announce(session)
      yield detachHolder.current
    }.bind(sessions), 'pipeline-run-session')
    session.append('pipeline/run-descriptor', descriptor, { ignorable: true })
    return new PipelineRunSession(scope, detachHolder, session.id, session)
  }

  /**
   * Record one node's execution window opening.
   * @param nodeId - the node's id within the definition.
   * @param nodeType - the node's type (`trigger`, `builtin`, or `llm`).
   */
  nodeStarted(nodeId: string, nodeType: string): void {
    this.session.append('pipeline/node-started', { nodeId, nodeType }, { ignorable: true })
  }

  /**
   * Record one node's settled outcome.
   * @param nodeId - the node's id within the definition.
   * @param nodeType - the node's type.
   * @param outcome - how the node settled.
   * @param durationMs - wall-clock execution time; `0` when skipped.
   * @param output - the node's JSON output; only carried when completed.
   * @param error - the failure message; only carried when failed.
   */
  nodeSettled(
    nodeId: string,
    nodeType: string,
    outcome: PipelineNodeSettledData['outcome'],
    durationMs: number,
    output?: JsonValue,
    error?: string,
  ): void {
    this.session.append('pipeline/node-settled', {
      nodeId,
      nodeType,
      outcome,
      durationMs,
      ...output !== undefined ? { output } : {},
      ...error !== undefined ? { error } : {},
    }, { ignorable: true })
  }

  /**
   * Append the run's settled facts and tear the session down: the scope
   * disposal detaches the session, flushing the log to persistence.
   * @param status - how the run settled.
   * @param durationMs - wall-clock run time.
   * @param nodeCount - how many nodes produced an outcome.
   * @param error - the failure message; only carried when failed.
   */
  async settled(status: PipelineRunStatus, durationMs: number, nodeCount: number, error?: string): Promise<void> {
    try {
      this.session.append('pipeline/run-settled', {
        status,
        durationMs,
        nodeCount,
        ...error !== undefined ? { error } : {},
      }, { ignorable: true })
      // Flush through the store's durability barrier, then detach directly: a
      // reader of the detail projection then always sees the complete log, and
      // the store entry retires without depending on disposal timing.
      const sessions = this.scope.ctx.get('sessions')
      if (sessions !== undefined) await sessions.flush(this.session)
      this.detachHolder.current?.()
      await this.scope.dispose()
    } catch (cause) {
      throw cause
    }
  }
}

/**
 * Fold a run session's event log into the per-node outcome list.
 * @param events - the run session's log; unfolded or foreign logs fold to an
 *   empty list (the record's metrics remain the listing truth).
 * @returns the nodes' settled outcomes in execution order.
 */
export function foldRunNodes(events: readonly { type: string; data: unknown }[]): readonly PipelineRunNodeOutcome[] {
  const nodes: PipelineRunNodeOutcome[] = []
  for (const event of events) {
    if (event.type !== 'pipeline/node-settled') continue
    const data = event.data as PipelineNodeSettledData
    nodes.push({
      nodeId: data.nodeId,
      nodeType: data.nodeType,
      outcome: data.outcome,
      durationMs: data.durationMs,
      ...data.output !== undefined ? { output: data.output } : {},
      ...data.error !== undefined ? { error: data.error } : {},
    })
  }
  return nodes
}
