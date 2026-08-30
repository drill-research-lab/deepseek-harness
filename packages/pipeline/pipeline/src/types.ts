/**
 * Pipeline seam vocabulary: the durable `WorkflowJSON` definition format a
 * pipeline engine consumes, plus the branded ids that identify pipelines,
 * runs, and nodes across package boundaries. Types only (plus the id-brand
 * factories), per the package convention.
 *
 * @module @deepseek-ai/dsh-pipeline/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies one persisted pipeline definition. */
export type PipelineId = Branded<'PipelineId'>

/**
 * Brand a string as a {@link PipelineId}.
 * @param id - the raw id string (stable across renames; the validator enforces its shape).
 * @returns the same string, branded.
 */
export function PipelineId(id: string): PipelineId {
  return id as PipelineId
}

/** Identifies one pipeline run. */
export type PipelineRunId = Branded<'PipelineRunId'>

/**
 * Brand a string as a {@link PipelineRunId}.
 * @param id - the raw id string (the engine provider mints these; tests may pass fixtures).
 * @returns the same string, branded.
 */
export function PipelineRunId(id: string): PipelineRunId {
  return id as PipelineRunId
}

/** Identifies one node inside a pipeline definition. */
export type PipelineNodeId = Branded<'PipelineNodeId'>

/**
 * Brand a string as a {@link PipelineNodeId}.
 * @param id - the raw id string (unique within one definition; display names live beside it).
 * @returns the same string, branded.
 */
export function PipelineNodeId(id: string): PipelineNodeId {
  return id as PipelineNodeId
}

/** Any JSON-representable value (recursively). Builtin node `config` and template `inputs` admit only these. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

/** The only `WorkflowJSON` version this vocabulary defines. */
export type WorkflowJsonVersion = 1

/**
 * One cron-scheduled trigger. `expression` is a standard five-field cron
 * expression (minute, hour, day-of-month, month, day-of-week); semantic
 * range/step validation belongs to the scheduler provider that parses it.
 * `timeZone` is an IANA zone name; DST gap/overlap resolution follows the
 * scheduler provider's documented semantics.
 */
export interface CronTrigger {
  /** Trigger discriminant; merge-extensible union — future kinds add members. */
  readonly kind: 'cron'
  /** Five-field cron expression, structurally validated at load. */
  readonly expression: string
  /** IANA time zone the schedule fires in. */
  readonly timeZone: string
  /** Paused pipelines keep their definition and schedule but fire nothing. */
  readonly enabled: boolean
}

/**
 * How a pipeline starts runs. v1 carries only {@link CronTrigger}; the
 * discriminant (`kind`) keeps the union merge-extensible for future trigger
 * kinds, and internal switches must fall through a documented default.
 */
export type PipelineTrigger = CronTrigger

/** Fields shared by every node regardless of type. */
export interface PipelineNodeBase {
  /** Stable node id, unique within the definition; edges reference it (rename-safe: display names live in `notes` or the UI layer). */
  readonly id: PipelineNodeId
  /** Disabled nodes stay in the definition but a run skips them and their downstream edges. */
  readonly disabled?: boolean
  /** Optional free-form maintainer note; never shown to the model. */
  readonly notes?: string
}

/** The single entry node of a definition; a run starts here and no edge may target it. */
export interface TriggerNode extends PipelineNodeBase {
  /** Node-type discriminant. */
  readonly type: 'trigger'
}

/**
 * A registered built-in step owned by the engine provider (a named pure
 * transformation such as a template's normalize/dedupe step). `ref` must be
 * one the provider registered — unknown refs fail loud at load.
 */
export interface BuiltinNode extends PipelineNodeBase {
  /** Node-type discriminant. */
  readonly type: 'builtin'
  /** The provider-registered step name. */
  readonly ref: string
  /** Optional step configuration, passed to the step as plain JSON data. */
  readonly config?: JsonValue
}

/** One single LLM ask; the response (JSON data) is the node output. */
export interface LlmNode extends PipelineNodeBase {
  /** Node-type discriminant. */
  readonly type: 'llm'
  /** The prompt; the run composes it with the node's upstream input. */
  readonly prompt: string
  /** Optional model override; the run resolves it against the session's model selection. */
  readonly model?: string
}

/** One multistep subagent execution with its own prompt, skills, and tools. */
export interface AgentNode extends PipelineNodeBase {
  /** Node-type discriminant. */
  readonly type: 'agent'
  /** The task prompt for the subagent. */
  readonly prompt: string
  /** Optional skill names mounted for the subagent. */
  readonly skills?: readonly string[]
  /** Optional tool names the subagent may use. */
  readonly tools?: readonly string[]
}

/**
 * One node in the definition graph. Merge-extensible union on the `type`
 * discriminant: future node kinds (for example a general `code` node) add
 * members, and internal switches must fall through a documented default
 * rather than `assertNever`.
 */
export type PipelineNode = TriggerNode | BuiltinNode | LlmNode | AgentNode

/** Every node-type discriminant the vocabulary currently defines. */
export type PipelineNodeType = PipelineNode['type']

/** One directed edge: the `from` node's output feeds the `to` node's input. */
export interface PipelineEdge {
  /** Source node id. */
  readonly from: PipelineNodeId
  /** Target node id; must not be the trigger node. */
  readonly to: PipelineNodeId
}

/** Provenance of a definition created from a built-in template. */
export interface TemplateRef {
  /** The template name the definition was expanded from. */
  readonly ref: string
  /** The template inputs the definition was expanded with, as plain JSON data. */
  readonly inputs?: { readonly [key: string]: JsonValue }
}

/**
 * The durable pipeline definition. Plain JSON data on disk and over the wire;
 * {@link !validateWorkflowJson} validates and brands it before anything
 * executes. v1 graphs are linear (the evaluator follows edges from the
 * trigger); branching and fan-out fields land with the execution slice that
 * evaluates them.
 */
export interface WorkflowJson {
  /** Format version; the only defined value is `1`. */
  readonly version: WorkflowJsonVersion
  /** Stable pipeline id (never reused across definitions). */
  readonly id: PipelineId
  /** Human-readable display name. */
  readonly name: string
  /** Optional one-line description. */
  readonly description?: string
  /** Present when the definition was created from a built-in template. */
  readonly template?: TemplateRef
  /** How runs start. */
  readonly trigger: PipelineTrigger
  /** The node set; exactly one node has type `'trigger'`. */
  readonly nodes: readonly PipelineNode[]
  /** The edges; acyclic, endpoint-checked, and never into the trigger. */
  readonly edges: readonly PipelineEdge[]
}

/** How a run was triggered. */
export type PipelineRunTrigger = 'manual' | 'scheduled'

/**
 * Identity snapshot carried by every `pipeline/*` event as borrowed immutable
 * data — the definition's display fields beside the two ids, never a live
 * handle.
 */
export interface PipelineRunInfo {
  /** The definition's id. */
  readonly pipelineId: PipelineId
  /** The run's id (fresh per run). */
  readonly runId: PipelineRunId
  /** The definition's display name at run start. */
  readonly name: string
  /** Which lane triggered the run. */
  readonly trigger: PipelineRunTrigger
}

/** One node's identity within a run (the `pipeline/node-start` payload). */
export interface PipelineNodeInfo {
  /** The node's id inside the definition. */
  readonly nodeId: PipelineNodeId
  /** The node's type discriminant. */
  readonly type: PipelineNodeType
}

/** How one node settled. `skipped` marks a node the run never reached or a disabled node. */
export type PipelineNodeOutcome = 'completed' | 'failed' | 'skipped'

/** One node's settlement (the `pipeline/node-end` payload). */
export interface PipelineNodeEndInfo extends PipelineNodeInfo {
  /** How the node settled. */
  readonly outcome: PipelineNodeOutcome
  /** The failure message (present iff `outcome` is `'failed'`). */
  readonly error?: string
}

/** Why a run settled. CLOSED union (engine-owned; consumers may exhaust it). */
export type PipelineRunStatus = 'completed' | 'failed'

/**
 * A settled run's outcome as event data (the `pipeline/run-end` payload):
 * deliberately WITHOUT any node output values — a listener observing outcomes
 * must not receive a mutable alias of run data; node inputs and outputs live
 * in the run's own session log.
 */
export interface PipelineRunResultInfo {
  /** Why the run settled. */
  readonly status: PipelineRunStatus
  /** The failure message (present iff `status` is `'failed'`). */
  readonly error?: string
  /** How many nodes the run attempted (ends included, `skipped` excluded). */
  readonly nodeCount: number
}

/** What changed about a persisted definition (the `pipeline/definition-changed` payload). */
export type PipelineDefinitionChangeKind = 'saved' | 'deleted' | 'enabled' | 'disabled'

/** One registry mutation (the `pipeline/definition-changed` payload). */
export interface PipelineDefinitionChange {
  /** The definition's id. */
  readonly id: PipelineId
  /** Which mutation happened. */
  readonly change: PipelineDefinitionChangeKind
}

/** Registry list projection for UIs and queries; derived from the durable registry. */
export interface PipelineSummary {
  /** The definition's id. */
  readonly id: PipelineId
  /** Display name. */
  readonly name: string
  /** Paused pipelines keep their definition and schedule but fire nothing. */
  readonly enabled: boolean
  /** Whether a run is executing right now. */
  readonly status: 'idle' | 'running'
  /** Next scheduled fire (RFC 3339 UTC); absent for a paused or spent schedule. */
  readonly nextRunAt?: string
  /** Last run's start (RFC 3339 UTC); absent before the first run. */
  readonly lastRunAt?: string
  /** How the last run settled. */
  readonly lastStatus?: PipelineRunStatus
  /** Last run's failure message (present iff `lastStatus` is `'failed'`). */
  readonly lastError?: string
  /** Consecutive failed runs at the tail of the run history. */
  readonly failureStreak: number
  /** Total runs ever recorded for the pipeline. */
  readonly runCount: number
  /** Triggers skipped under the overlap policy (one executing run per pipeline). */
  readonly skippedCount: number
}

/** What a caller asks for when starting a run. */
export interface PipelineRunRequest {
  /** The pipeline to run. */
  readonly id: PipelineId
  /** Which lane triggered the run. */
  readonly trigger: PipelineRunTrigger
}

/**
 * A save request. The definition arrives as raw JSON data — `save` is the
 * durable parser boundary and validates it, whether it came from an RPC
 * payload, an import, or already-validated in-process callers.
 */
export interface PipelineSaveRequest {
  /** The candidate definition, as parsed JSON data. */
  readonly definition: unknown
}

/**
 * The outcome of a run start under the overlap policy: either a live handle,
 * or a recorded skip when the pipeline already has a run executing.
 * CLOSED union (engine-owned; consumers may exhaust it).
 */
export type PipelineRunStart =
  | {
    /** The run was accepted. */
    readonly outcome: 'started'
    /** The pipeline's id. */
    readonly pipelineId: PipelineId
    /** The fresh run's id. */
    readonly runId: PipelineRunId
    /** Settles when the run finishes; never rejects. */
    readonly result: Promise<PipelineRunResultInfo>
  }
  | {
    /** The trigger was skipped under the overlap policy. */
    readonly outcome: 'skipped'
    /** The pipeline's id. */
    readonly pipelineId: PipelineId
    /** Why the trigger was skipped. */
    readonly reason: 'already-running'
  }
