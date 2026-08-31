/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-pipeline`.
 * @module @deepseek-ai/dsh-pipeline/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type {
  PipelineDefinitionChange,
  PipelineNodeEndInfo,
  PipelineNodeInfo,
  PipelineRunInfo,
  PipelineRunResultInfo,
} from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-pipeline'

/** Cordis companion plugin name. */
export const name = 'pipeline-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** One observed run: its identity snapshot, its open nodes, and whether it ended. */
interface RunTrace {
  /** The `pipeline/run-start` identity snapshot, frozen for divergence checks. */
  identity: string
  /** Node ids with a started but unended lifecycle, mapped to their start type. */
  openNodes: Map<string, string>
  /** Set when the run's `pipeline/run-end` committed. */
  ended: boolean
}

/** Resolve the run's trace or fail when the event has no matching start. */
function traceFor(
  runs: ReadonlyMap<string, RunTrace>,
  info: PipelineRunInfo,
  eventName: string,
  fail: InvariantFailure,
): RunTrace {
  const trace = runs.get(String(info.runId))
  if (trace === undefined) {
    fail(`${eventName} has no matching pipeline/run-start for run ${JSON.stringify(info.runId)}`)
  }
  if (JSON.stringify(info) !== trace.identity) {
    fail(`${eventName} identity diverges from pipeline/run-start for run ${JSON.stringify(info.runId)}`)
  }
  if (trace.ended) fail(`${eventName} arrived after pipeline/run-end for run ${JSON.stringify(info.runId)}`)
  return trace
}

/** Validate the identity snapshot shared by every run-scoped event. */
function validateInfo(info: PipelineRunInfo, eventName: string, fail: InvariantFailure): void {
  if (String(info.pipelineId).length === 0 || String(info.runId).length === 0 || info.name.length === 0) {
    fail(`${eventName} pipelineId, runId, and name must be non-empty`)
  }
}

/** Install `pipeline/*` run and node pairing checks. */
const install: InvariantInstaller = (ctx, fail) => {
  const runs = new Map<string, RunTrace>()
  const stagedInfos = new WeakSet<PipelineRunInfo>()
  const stagedNodes = new WeakSet<PipelineNodeInfo | PipelineNodeEndInfo>()
  const stagedChanges = new WeakSet<PipelineDefinitionChange>()

  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName === 'pipeline/definition-changed') {
      const change = args[0] as PipelineDefinitionChange
      if (String(change.id).length === 0) fail('pipeline/definition-changed id must be non-empty')
      stagedChanges.add(change)
      return
    }
    if (!eventName.startsWith('pipeline/')) return
    const info = args[0] as PipelineRunInfo
    validateInfo(info, eventName, fail)
    if (eventName === 'pipeline/run-start') {
      if (runs.has(String(info.runId))) fail(`pipeline/run-start repeated run id ${JSON.stringify(info.runId)}`)
      // The payload arrives as runtime data: check the discriminant against the declared union.
      const trigger: unknown = info.trigger
      if (trigger !== 'manual' && trigger !== 'scheduled') {
        fail('pipeline/run-start trigger must be "manual" or "scheduled"')
      }
      stagedInfos.add(info)
      return
    }
    const trace = traceFor(runs, info, eventName, fail)
    if (eventName === 'pipeline/node-start') {
      const node = args[1] as PipelineNodeInfo
      if (String(node.nodeId).length === 0) fail('pipeline/node-start nodeId must be non-empty')
      if (trace.openNodes.has(String(node.nodeId))) {
        fail(`pipeline/node-start repeated node id ${JSON.stringify(node.nodeId)}`)
      }
      stagedNodes.add(node)
      return
    }
    if (eventName === 'pipeline/node-end') {
      const node = args[1] as PipelineNodeEndInfo
      const startType = trace.openNodes.get(String(node.nodeId))
      if (startType === undefined) {
        fail(`pipeline/node-end has no matching start for node ${JSON.stringify(node.nodeId)}`)
      }
      if (startType !== node.type) {
        fail(`pipeline/node-end type diverges from pipeline/node-start for node ${JSON.stringify(node.nodeId)}`)
      }
      if (node.outcome === 'failed' ? typeof node.error !== 'string' : node.error !== undefined) {
        fail('pipeline/node-end error must be present exactly for failed outcomes')
      }
      stagedNodes.add(node)
      return
    }
    // The only remaining `pipeline/*` event is run-end: run-start, node-start,
    // and node-end returned above, and definition-changed returned at the top.
    const result = args[1] as PipelineRunResultInfo
    if (result.status === 'failed' ? typeof result.error !== 'string' : result.error !== undefined) {
      fail('pipeline/run-end error must be present exactly for failed runs')
    }
    if (!Number.isSafeInteger(result.nodeCount) || result.nodeCount < 0) {
      fail('pipeline/run-end nodeCount must be a non-negative safe integer')
    }
    if (trace.openNodes.size > 0) {
      fail(`pipeline/run-end leaves ${trace.openNodes.size} node start(s) without pipeline/node-end`)
    }
    stagedInfos.add(info)
  }, { global: true })

  ctx.on('pipeline/definition-changed', (change) => {
    /* v8 ignore next -- internal/dispatch stages the same change object */
    if (!stagedChanges.delete(change)) return
  }, { global: true })

  ctx.on('pipeline/run-start', (info) => {
    /* v8 ignore next -- internal/dispatch stages the same run-info object */
    if (!stagedInfos.delete(info)) return
    runs.set(String(info.runId), { identity: JSON.stringify(info), openNodes: new Map(), ended: false })
  }, { global: true })

  ctx.on('pipeline/node-start', (info, node) => {
    /* v8 ignore next -- internal/dispatch stages the same node object */
    if (!stagedNodes.delete(node)) return
    traceFor(runs, info, 'pipeline/node-start', fail).openNodes.set(String(node.nodeId), node.type)
  }, { global: true })

  ctx.on('pipeline/node-end', (info, node) => {
    /* v8 ignore next -- internal/dispatch stages the same node object */
    if (!stagedNodes.delete(node)) return
    traceFor(runs, info, 'pipeline/node-end', fail).openNodes.delete(String(node.nodeId))
  }, { global: true })

  ctx.on('pipeline/run-end', (info) => {
    /* v8 ignore next -- internal/dispatch stages the same run-info object */
    if (!stagedInfos.delete(info)) return
    traceFor(runs, info, 'pipeline/run-end', fail).ended = true
  }, { global: true })
}

/**
 * Register the pipeline invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
