/**
 * File-backed provider for `ctx.pipelineEngine`. Owns the registry on disk,
 * applies the overlap policy, evaluates definitions in topological order, and
 * executes `builtin` and `llm` nodes; agent nodes fail loud until the
 * background-agent runtime slice lands.
 * @module @deepseek-ai/dsh-pipeline-local/engine
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import { createMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import {
  PipelineEngine,
  PipelineError,
  PipelineId,
  PipelineRunId,
  validateWorkflowJson,
} from '@deepseek-ai/dsh-pipeline'
import type {
  JsonValue,
  PipelineNode,
  PipelineRunInfo,
  PipelineRunRequest,
  PipelineRunResultInfo,
  PipelineRunStart,
  PipelineRunStatus,
  PipelineSaveRequest,
  PipelineSummary,
  WorkflowJson,
} from '@deepseek-ai/dsh-pipeline'
import { PipelineFileRegistry } from './registry.ts'
import type { PipelineRunRecord } from './registry.ts'

/** One registered builtin step: a pure transformation over its config and the upstream input. */
export type BuiltinStep = (
  config: JsonValue | undefined,
  input: JsonValue,
  context: BuiltinStepContext,
) => JsonValue | Promise<JsonValue>

/** What a builtin step may reach besides its inputs. */
export interface BuiltinStepContext {
  /** The running pipeline's id. */
  readonly pipelineId: PipelineId
  /** Per-pipeline directory for cross-run state (dedupe indexes and similar). */
  readonly stateDir: string
}

/** Configuration for the file-backed engine provider. */
export interface Config {
  /**
   * Absolute storage root for definitions, the registry index, run records,
   * and builtin-step state. Required — there is no deployment-independent
   * default location, and a mount without one fails at load.
   */
  storageDir: string
  /** Retained run records per pipeline; older records are pruned. The schema default is 50. */
  retainedRuns?: number
  /** Provider route for llm nodes; required to run one, checked at node execution. */
  llmProvider?: string
  /** Model for llm nodes that carry no own `model` override. */
  llmModel?: string
}

/**
 * Topologically order the definition's nodes (Kahn's algorithm). The
 * validator already rejected cycles; disabled and unreachable nodes keep
 * their place so their skipped lifecycle still renders in run views.
 */
export function topoOrder(nodes: readonly PipelineNode[], edges: ReadonlyMap<string, readonly string[]>): PipelineNode[] {
  const byId = new Map(nodes.map(node => [String(node.id), node]))
  const indegree = new Map<string, number>()
  for (const node of nodes) indegree.set(String(node.id), 0)
  for (const targets of edges.values()) {
    for (const target of targets) {
      // The schema rejects edges referencing non-node ids, so the seed always resolves.
      indegree.set(target, (indegree.get(target) as number) + 1)
    }
  }
  const ordered: PipelineNode[] = []
  const ready = nodes.filter(node => indegree.get(String(node.id)) === 0).map(node => String(node.id))
  while (ready.length > 0) {
    // Ready ids come from the node list and schema-validated edge targets, so both lookups resolve.
    const id = ready.shift() as string
    ordered.push(byId.get(id) as PipelineNode)
    for (const target of edges.get(id) ?? []) {
      const remaining = (indegree.get(target) as number) - 1
      indegree.set(target, remaining)
      if (remaining === 0) ready.push(target)
    }
  }
  return ordered
}

/**
 * The file-backed engine. `startRun` marks the pipeline running, emits the
 * run lifecycle around awaited node execution, records metrics under
 * `runs/`, and settles the returned `result` promise exactly once.
 */
export class PipelineLocalEngine extends PipelineEngine {
  static Config: Schema<Config> = z.object({
    storageDir: z.string().required(),
    retainedRuns: z.number().default(50),
    llmProvider: z.string(),
    llmModel: z.string(),
  })

  /** The file-backed registry this provider owns (exposed for the invariant companion). */
  readonly registry: PipelineFileRegistry

  private readonly llmProvider: string | undefined
  private readonly llmModel: string | undefined
  private readonly running = new Set<string>()
  private readonly builtins = new Map<string, BuiltinStep>()

  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.registry = new PipelineFileRegistry(config.storageDir, config.retainedRuns)
    this.llmProvider = config.llmProvider
    this.llmModel = config.llmModel
  }

  /**
   * Register one builtin step under a `ref` definitions may reference.
   * @param ref - the step name (`builtin.ref` in definitions).
   * @param step - the transformation.
   * @returns a disposer removing the registration.
   */
  registerBuiltin(ref: string, step: BuiltinStep): () => void {
    this.builtins.set(ref, step)
    return () => {
      if (this.builtins.get(ref) === step) this.builtins.delete(ref)
    }
  }

  list(): readonly PipelineSummary[] {
    return this.registry.list().map(summary => ({
      ...summary,
      status: this.running.has(String(summary.id)) ? ('running' as const) : ('idle' as const),
    }))
  }

  get(id: PipelineId): WorkflowJson | undefined {
    return this.registry.get(id)
  }

  async save(request: PipelineSaveRequest): Promise<WorkflowJson> {
    // Validation happens before the await: its synchronous throw becomes this
    // call's rejection (async seam semantics).
    const definition = validateWorkflowJson(request.definition)
    await this.registry.save(definition)
    this.emitPipelineEvent('pipeline/definition-changed', { id: definition.id, change: 'saved' })
    return definition
  }

  async delete(id: PipelineId): Promise<boolean> {
    const deleted = await this.registry.delete(id)
    if (deleted) this.emitPipelineEvent('pipeline/definition-changed', { id, change: 'deleted' })
    return deleted
  }

  async setEnabled(id: PipelineId, enabled: boolean): Promise<boolean> {
    const before = this.registry.enabledOf(id)
    if (before === undefined) return false
    await this.registry.setEnabled(id, enabled)
    if (before !== enabled) {
      this.emitPipelineEvent('pipeline/definition-changed', { id, change: enabled ? 'enabled' : 'disabled' })
    }
    return true
  }

  startRun(request: PipelineRunRequest): PipelineRunStart {
    const definition = this.registry.get(request.id)
    if (definition === undefined) this.unknownPipeline(request.id)
    const key = String(request.id)
    if (this.running.has(key)) {
      return { outcome: 'skipped', pipelineId: request.id, reason: 'already-running' }
    }
    const ordinal = this.registry.nextOrdinal(request.id)
    const info: PipelineRunInfo = {
      pipelineId: request.id,
      runId: PipelineRunId(`${key}-run-${ordinal}`),
      name: definition.name,
      trigger: request.trigger,
    }
    this.running.add(key)
    this.emitPipelineEvent('pipeline/run-start', info)
    const result = this.executeRun(definition, info, ordinal)
    return { outcome: 'started', pipelineId: request.id, runId: info.runId, result }
  }

  /**
   * Evaluate one run end to end. Node failures fail the run and leave the
   * remaining nodes skipped; an unexpected engine failure is converted into a
   * failed run so `pipeline/run-end` and the metrics record fire exactly once
   * on every path.
   */
  private async executeRun(definition: WorkflowJson, info: PipelineRunInfo, ordinal: number): Promise<PipelineRunResultInfo> {
    const startedAt = Date.now()
    let status: PipelineRunStatus = 'completed'
    let error: string | undefined
    let nodeCount = 0
    const outputs = new Map<string, JsonValue>()
    const edges = new Map<string, readonly string[]>()
    for (const edge of definition.edges) {
      edges.set(String(edge.from), [...(edges.get(String(edge.from)) ?? []), String(edge.to)])
    }
    const order = topoOrder(definition.nodes, edges)
    const reachable = this.reachableFromTrigger(definition, edges)
    for (const node of order) {
      const nodeInfo = { nodeId: node.id, type: node.type }
      this.emitPipelineEvent('pipeline/node-start', info, nodeInfo)
      if (node.disabled === true || !reachable.has(String(node.id))) {
        this.emitPipelineEvent('pipeline/node-end', info, { ...nodeInfo, outcome: 'skipped' })
        continue
      }
      try {
        const output = await this.executeNode(node, this.nodeInput(node, outputs, definition), info)
        outputs.set(String(node.id), output)
        nodeCount += 1
        this.emitPipelineEvent('pipeline/node-end', info, { ...nodeInfo, outcome: 'completed' })
      } catch (cause) {
        nodeCount += 1
        error = cause instanceof Error ? cause.message : String(cause)
        status = 'failed'
        this.emitPipelineEvent('pipeline/node-end', info, { ...nodeInfo, outcome: 'failed', error })
        break
      }
    }
    const result: PipelineRunResultInfo = { status, ...error !== undefined ? { error } : {}, nodeCount }
    this.emitPipelineEvent('pipeline/run-end', info, result)
    const record: Omit<PipelineRunRecord, 'runId'> = {
      startedAt,
      finishedAt: Date.now(),
      status,
      ...error !== undefined ? { error } : {},
      nodeCount,
    }
    await this.registry.recordRun(definition.id, ordinal, record)
    this.running.delete(String(definition.id))
    return result
  }

  /**
   * Collect the node ids the run reaches from the trigger. A disabled node
   * is skipped together with its downstream edges: the traversal expands a
   * disabled node's id but not its outgoing edges.
   */
  private reachableFromTrigger(definition: WorkflowJson, edges: ReadonlyMap<string, readonly string[]>): Set<string> {
    // The schema guarantees exactly one trigger node.
    const trigger = definition.nodes.find(node => node.type === 'trigger') as PipelineNode
    const disabled = new Set(definition.nodes.filter(node => node.disabled === true).map(node => String(node.id)))
    const seen = new Set<string>([String(trigger.id)])
    const queue = [String(trigger.id)]
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      if (disabled.has(id)) continue
      for (const target of edges.get(id) ?? []) {
        if (!seen.has(target)) {
          seen.add(target)
          queue.push(target)
        }
      }
    }
    return seen
  }

  /**
   * Compose one node's input: the single upstream's output, or — when several
   * edges feed the node — a record keyed by upstream node id. A node with no
   * upstream receives `null`.
   */
  private nodeInput(node: PipelineNode, outputs: ReadonlyMap<string, JsonValue>, definition: WorkflowJson): JsonValue {
    const upstreams = definition.edges.filter(edge => String(edge.to) === String(node.id)).map(edge => String(edge.from))
    if (upstreams.length === 0) return null
    if (upstreams.length === 1) {
      for (const upstream of upstreams) {
        // Topological order plus fail-stop mean every executed node's upstreams have recorded outputs.
        /* v8 ignore next */
        return outputs.get(upstream) ?? null
      }
    }
    const merged: Record<string, JsonValue> = {}
    for (const upstream of upstreams) {
      /* v8 ignore next */
      merged[upstream] = outputs.get(upstream) ?? null
    }
    return merged
  }

  /** Dispatch one node to its executor. */
  private async executeNode(node: PipelineNode, input: JsonValue, info: PipelineRunInfo): Promise<JsonValue> {
    if (node.type === 'trigger') return { trigger: info.trigger }
    if (node.type === 'builtin') {
      const step = this.builtins.get(node.ref)
      if (step === undefined) {
        throw new PipelineError(`builtin step ${JSON.stringify(node.ref)} is not registered`, 'STEP_UNKNOWN')
      }
      return step(node.config, input, { pipelineId: info.pipelineId, stateDir: this.registry.stateDirFor(info.pipelineId) })
    }
    if (node.type === 'llm') return this.executeLlm(node, input)
    throw new PipelineError(
      'agent nodes need the background-agent runtime, which lands with the wiring slice',
      'AGENT_NODE_RUNTIME_UNAVAILABLE',
    )
  }

  /** One single LLM ask: the node prompt beside the upstream input, streamed to its joined text. */
  private async executeLlm(node: Extract<PipelineNode, { type: 'llm' }>, input: JsonValue): Promise<JsonValue> {
    const provider = this.llmProvider
    const model = node.model ?? this.llmModel
    if (provider === undefined || model === undefined) {
      throw new PipelineError(
        'llm nodes need the llmProvider/llmModel config defaults or a node-level model override',
        'LLM_NODE_UNCONFIGURED',
      )
    }
    const llm = this.ctx.get('llm')
    if (llm === undefined) {
      throw new PipelineError('no llm runtime is mounted for llm nodes', 'LLM_NODE_UNCONFIGURED')
    }
    const options: GenerateOptions = {
      provider,
      model,
      messages: [createMessage({
        role: 'user',
        content: [{ type: 'text', text: `${node.prompt}\n\nInput:\n${JSON.stringify(input, null, 2)}` }],
        source: { kind: 'user' },
      })],
    }
    let text = ''
    for await (const chunk of llm.stream(options)) {
      if (chunk.type === 'text-delta') text += chunk.text
    }
    return { text }
  }
}
