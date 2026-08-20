/**
 * @deepseek-ai/dsh-drill-production — the Drill multi-user production
 * capability-closure bundle patch. Most of this package's substance is
 * `cordis.patch.yml`, declared by the `dsh.bundle.patch` manifest field and
 * resolved by the profile composer through that field. This module is the
 * one piece of runtime logic the patch needs: a startup assertion (A3 §11,
 * FAIL LOUD) that the resolved production policy still holds after every
 * later patch layer (an operator's `$DSH_HOME/cordis.patch.yml`, a
 * `--patch` overlay) has applied — so a later layer that accidentally
 * re-widens the roster or the permission table fails the whole boot with a
 * named diagnostic instead of silently shipping an unsafe composition.
 * @module @deepseek-ai/dsh-drill-production
 */

import type { Context } from '@deepseek-ai/cordis'
// Side-effect type imports: declaration-merge `ctx.agentPresets`/`ctx.permissionPresets`
// (the capability facts this check reads), without a value dependency on either seam.
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-permission-presets'

/** Cordis plugin name. */
export const name = 'drill-production-startup-check'
/** Services this check reads before asserting the closed policy. */
export const inject = ['agentPresets', 'permissionPresets']

const PRODUCTION_PRESET_ID = 'drill-production'
const PRODUCTION_PERMISSION_SPECS = new Map([
  ['read-only', { sandbox: 'read-only', approval: 'ask' }],
  ['workspace-write', { sandbox: 'workspace-write', approval: 'ask' }],
] as const)

/** Values read from the composed preset and permission services at startup. */
export interface DrillProductionPolicy {
  approvedIds: readonly string[] | undefined
  defaultId: string
  includeUserRoot: boolean
  permissionNames: readonly string[]
  resolvePermission(name: string): { sandbox: string; approval: string }
}

/**
 * Validate the exact Drill production policy after all composition patches apply.
 * @param policy - resolved preset and permission service values.
 */
export function validateDrillProductionPolicy(policy: DrillProductionPolicy): void {
  const approved = policy.approvedIds
  if (approved === undefined) {
    throw new Error('dsh-drill-production: agent-presets.approvedIds must be exactly {drill-production}; received unset')
  }
  const approvedSet = new Set(approved)
  if (approvedSet.size !== 1 || !approvedSet.has(PRODUCTION_PRESET_ID) || approved.length !== approvedSet.size) {
    throw new Error(`dsh-drill-production: agent-presets.approvedIds must be exactly {drill-production}; received {${approved.join(', ')}}`)
  }
  if (policy.defaultId !== PRODUCTION_PRESET_ID) {
    throw new Error(`dsh-drill-production: agent-presets.default must be "drill-production"; received ${JSON.stringify(policy.defaultId)}`)
  }
  if (policy.includeUserRoot) {
    throw new Error('dsh-drill-production: agent-presets.includeUserRoot must be false')
  }

  const actualNames = new Set(policy.permissionNames)
  const expectedNames = new Set(PRODUCTION_PERMISSION_SPECS.keys())
  if (actualNames.size !== expectedNames.size
    || [...expectedNames].some(name => !actualNames.has(name))
    || policy.permissionNames.length !== actualNames.size) {
    throw new Error(
      'dsh-drill-production: permission preset ids must be exactly {read-only, workspace-write}; '
      + `received {${policy.permissionNames.join(', ')}}`,
    )
  }
  for (const [name, expected] of PRODUCTION_PERMISSION_SPECS) {
    const actual = policy.resolvePermission(name)
    if (actual.sandbox !== expected.sandbox || actual.approval !== expected.approval) {
      throw new Error(
        `dsh-drill-production: permission preset ${JSON.stringify(name)} must use sandbox `
        + `${JSON.stringify(expected.sandbox)} and approval ${JSON.stringify(expected.approval)}`,
      )
    }
  }
}

/**
 * Assert the production capability policy at startup: the preset roster is
 * explicitly approved (not merely "matches what this file shipped"), and no
 * permission preset offers `danger-full-access`. Throws — never silently
 * clamps a security-sensitive value — because a later patch layer widening
 * either is a deployment misconfiguration this bundle exists to catch, not
 * a supported override.
 * @param ctx - Cordis context carrying the injected services.
 */
export function apply(ctx: Context): void {
  validateDrillProductionPolicy({
    approvedIds: ctx.agentPresets.config.approvedIds,
    defaultId: ctx.agentPresets.defaultId,
    includeUserRoot: ctx.agentPresets.config.includeUserRoot,
    permissionNames: ctx.permissionPresets.names,
    resolvePermission: presetName => ctx.permissionPresets.resolve(presetName),
  })
}
