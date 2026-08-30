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
