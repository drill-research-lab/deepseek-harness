/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-pipeline-local`:
 * the registry index and the definition files must describe the same set.
 * @module @deepseek-ai/dsh-pipeline-local/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { PipelineLocalEngine } from './engine.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-pipeline-local'

/** Cordis companion plugin name. */
export const name = 'pipeline-local-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Check index/definition consistency over the two id sets.
 * @param listedIds - the index's projected pipeline ids.
 * @param definitionIds - the persisted definition files' ids.
 * @param fail - the package-attributed failure reporter.
 */
export function checkRegistryConsistency(listedIds: readonly string[], definitionIds: readonly string[], fail: InvariantFailure): void {
  for (const id of definitionIds) {
    if (!listedIds.includes(id)) fail(`definition ${JSON.stringify(id)} is not indexed`)
  }
  for (const id of listedIds) {
    if (!definitionIds.includes(id)) fail(`index entry ${JSON.stringify(id)} has no definition`)
  }
}

/** Bridge the live engine's registry into the consistency check. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const engine = ctx.get('pipelineEngine')
  if (!(engine instanceof PipelineLocalEngine)) {
    fail('pipelineEngine is not the file-backed provider')
    return
  }
  checkRegistryConsistency(
    engine.list().map(summary => String(summary.id)),
    engine.registry.definitionIds(),
    fail,
  )
}, { inject: ['pipelineEngine'] })

/**
 * Register the pipeline-local invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
