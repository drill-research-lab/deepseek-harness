/**
 * @deepseek-ai/dsh-drill-production — the Drill multi-user production
 * capability-closure bundle patch. Most of this package's substance is
 * `cordis.patch.yml`, declared by the `dsh.bundle.patch` manifest field and
 * resolved by the profile composer through that field. This module is the
 * one piece of runtime logic the patch needs: a startup assertion (A3 §11,
 * FAIL LOUD) that the resolved production policy still holds after every
 * later patch layer (an operator's `$DSH_HOME/cordis.patch.yml`, a
 * `--patch` overlay) has applied — so a later layer that accidentally
 * re-widens the roster, the permission table, re-enables `cordis-host-runner`,
 * or reopens `session-query-sqlite`'s `openAt` phase fails the whole boot
 * with a named diagnostic instead of silently shipping an unsafe composition.
 * @module @deepseek-ai/dsh-drill-production
 */

import type { Context } from '@deepseek-ai/cordis'
// Side-effect type imports: declaration-merge `ctx.agentPresets`/`ctx.permissionPresets`/
// `ctx.sessionQuery` (the capability facts this check reads), without a value
// dependency on any of those three seams.
import type {} from '@deepseek-ai/dsh-agent-presets'
// Side-effect type import: declaration-merges `ctx.dynamicCordisRunner`, read
// through `ctx.get` below so this check observes whichever mount state (absent,
// or reopened by a later patch layer) the fully-patched composition resolves to.
import type {} from '@deepseek-ai/dsh-cordis-host-runner'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-session-query'
// Value import: the check narrows `ctx.sessionQuery` to this concrete engine
// before reading its sqlite-specific `openAt` field, which the abstract
// `SessionQueryEngine` service does not declare.
import { SqliteSessionQueryEngine } from '@deepseek-ai/dsh-session-query-sqlite'

/** Cordis plugin name. */
export const name = 'drill-production-startup-check'
/** Services this check reads before asserting the closed policy. */
export const inject = ['agentPresets', 'permissionPresets', 'sandboxPolicy']

const PRODUCTION_PRESET_ID = 'drill-production'
const PRODUCTION_PERMISSION_SPECS = new Map([
  ['read-only', { sandbox: 'read-only', approval: 'ask' }],
  ['workspace-write', { sandbox: 'workspace-write', approval: 'ask' }],
] as const)

/** Values read from the composed preset, permission, and host-plane services at startup. */
export interface DrillProductionPolicy {
  approvedIds: readonly string[] | undefined
  defaultId: string
  includeUserRoot: boolean
  permissionNames: readonly string[]
  resolvePermission(name: string): { sandbox: string; approval: string }
  /** Widest sandbox mode the resolved production policy permits. */
  sandboxMaximumMode: string
  /** One-call escalation targets exposed by the resolved production policy. */
  sandboxEscalationTargets: readonly string[]
  /** Whether `ctx.dynamicCordisRunner` is mounted in the fully-patched composition. */
  dynamicCordisRunnerMounted: boolean
  /**
   * `session-query-sqlite`'s resolved `openAt` phase, or `undefined` when no
   * sqlite session-query engine is mounted (a different or absent
   * `sessionQuery` provider is outside this check's concern).
   */
  sessionQuerySqliteOpenAt: string | undefined
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

  if (policy.sandboxMaximumMode !== 'workspace-write') {
    throw new Error(
      'dsh-drill-production: sandbox-policy.maximumMode must be "workspace-write"; received '
      + JSON.stringify(policy.sandboxMaximumMode),
    )
  }
  const escalationTargets = new Set(policy.sandboxEscalationTargets)
  if (escalationTargets.size !== 1
    || !escalationTargets.has('workspace-write')
    || policy.sandboxEscalationTargets.length !== escalationTargets.size) {
    throw new Error(
      'dsh-drill-production: sandbox escalation targets must be exactly {workspace-write}; received {'
      + `${policy.sandboxEscalationTargets.join(', ')}}`,
    )
  }

  if (policy.dynamicCordisRunnerMounted) {
    throw new Error(
      'dsh-drill-production: cordis-host-runner must not be mounted; '
      + 'a patch layer re-enabled the "cordis-host-runner" row',
    )
  }
  if (policy.sessionQuerySqliteOpenAt !== undefined && policy.sessionQuerySqliteOpenAt !== 'never') {
    throw new Error(
      'dsh-drill-production: session-query-sqlite.openAt must be "never"; received '
      + JSON.stringify(policy.sessionQuerySqliteOpenAt),
    )
  }
}

/**
 * Assert the production capability policy at startup: the preset roster is
 * explicitly approved (not merely "matches what this file shipped"), no
 * permission preset offers `danger-full-access`, `cordis-host-runner` is not
 * mounted, and `session-query-sqlite` (when mounted) keeps `openAt: 'never'`.
 * Throws — never silently clamps a security-sensitive value — because a
 * later patch layer widening any of these is a deployment misconfiguration
 * this bundle exists to catch, not a supported override.
 * @param ctx - Cordis context carrying the injected services.
 */
export function apply(ctx: Context): void {
  const sessionQuery = ctx.get('sessionQuery')
  validateDrillProductionPolicy({
    approvedIds: ctx.agentPresets.config.approvedIds,
    defaultId: ctx.agentPresets.defaultId,
    includeUserRoot: ctx.agentPresets.config.includeUserRoot,
    permissionNames: ctx.permissionPresets.names,
    resolvePermission: presetName => ctx.permissionPresets.resolve(presetName),
    sandboxMaximumMode: ctx.sandboxPolicy.maximumMode,
    sandboxEscalationTargets: ctx.sandboxPolicy.escalationTargets,
    dynamicCordisRunnerMounted: ctx.get('dynamicCordisRunner') !== undefined,
    sessionQuerySqliteOpenAt: sessionQuery instanceof SqliteSessionQueryEngine
      ? sessionQuery.config.openAt
      : undefined,
  })
}
