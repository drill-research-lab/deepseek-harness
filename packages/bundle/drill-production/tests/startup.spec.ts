/**
 * The A3 production-policy startup assertion (FAIL LOUD, §11) and the
 * disabled directory-picker capability, exercised over a real (but minimal)
 * Cordis composition rather than mocks.
 */

import { Context } from '@deepseek-ai/cordis'
import AgentPresets, { type Config as AgentPresetsConfig } from '@deepseek-ai/dsh-agent-presets'
import PermissionPresetService from '@deepseek-ai/dsh-permission-presets'
import SessionStore from '@deepseek-ai/dsh-session'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import { describe, expect, it } from 'vitest'
import * as drillProductionStartup from '../src/index.ts'
import { validateDrillProductionPolicy, type DrillProductionPolicy } from '../src/index.ts'
import { DisabledDirectoryPicker } from '../src/startup.ts'

type PresetTable = Record<string, { sandbox: string; approval: string }>

async function harness(
  agentPresetsConfig: Partial<AgentPresetsConfig> = {},
  permissionPresets?: PresetTable,
): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  ctx.provide('shell', {
    sandboxMode: 'workspace-write',
    resolve() { throw new Error('policy tests do not execute bash') },
    run() { throw new Error('policy tests do not execute bash') },
    start() { throw new Error('policy tests do not execute bash') },
  } as never)
  ctx.provide('approval', { config: { policy: 'ask' } } as never)
  await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', maximumMode: 'workspace-write' })
  await ctx.plugin(AgentPresets, {
    default: 'drill-production',
    roots: [],
    includeUserRoot: false,
    approvedIds: ['drill-production'],
    ...agentPresetsConfig,
  })
  await ctx.plugin(PermissionPresetService, {
    presets: permissionPresets ?? {
      'workspace-write': { sandbox: 'workspace-write', approval: 'ask' },
    },
  } as never)
  return ctx
}

/** Mount the real function plugin, exactly as `cordis.patch.yml`'s `insert:` row does. */
async function mountCheck(ctx: Context): Promise<unknown> {
  return await ctx.plugin(drillProductionStartup)
}

describe('drill-production startup policy check', () => {
  it('passes silently when the roster is approved and no permission preset offers danger-full-access', async () => {
    const ctx = await harness()

    await expect(mountCheck(ctx)).resolves.toBeDefined()
  })

  const validPolicy: DrillProductionPolicy = {
    approvedIds: ['drill-production'],
    defaultId: 'drill-production',
    includeUserRoot: false,
    permissionNames: ['read-only', 'workspace-write'],
    resolvePermission: name => ({ sandbox: name, approval: 'ask' }),
    sandboxMaximumMode: 'workspace-write',
    sandboxEscalationTargets: ['workspace-write'],
    dynamicCordisRunnerMounted: false,
    sessionQuerySqliteOpenAt: 'never',
  }

  it.each([
    [{ approvedIds: undefined }, /approvedIds must be exactly.*unset/],
    [{ approvedIds: ['drill-production', 'minimal'] }, /approvedIds must be exactly/],
    [{ approvedIds: ['minimal'], defaultId: 'minimal' }, /approvedIds must be exactly/],
    [{ defaultId: 'minimal' }, /default must be "drill-production"/],
    [{ includeUserRoot: true }, /includeUserRoot must be false/],
  ] as const)('rejects preset-policy drift %#', (override, expected) => {
    expect(() => { validateDrillProductionPolicy({ ...validPolicy, ...override }) }).toThrow(expected)
  })

  it.each([
    [['read-only', 'workspace-write', 'danger-full-access']],
    [['read-only', 'workspace-write', 'unexpected-extra']],
    [['workspace-write']],
  ])('rejects permission roster drift: %j', (permissionNames) => {
    expect(() => { validateDrillProductionPolicy({ ...validPolicy, permissionNames }) }).toThrow(
      /permission preset ids must be exactly/,
    )
  })

  it('rejects an approved permission id mapped to a different policy', () => {
    expect(() => { validateDrillProductionPolicy({
      ...validPolicy,
      resolvePermission: name => name === 'read-only'
        ? { sandbox: 'danger-full-access', approval: 'ask' }
        : { sandbox: 'workspace-write', approval: 'ask' },
    }) }).toThrow(/permission preset "read-only" must use sandbox "read-only"/)
  })

  it.each([
    [{ sandboxMaximumMode: 'danger-full-access' }, /maximumMode must be "workspace-write"/],
    [{ sandboxEscalationTargets: ['workspace-write', 'danger-full-access'] }, /targets must be exactly/],
    [{ sandboxEscalationTargets: [] }, /targets must be exactly/],
  ] as const)('rejects sandbox-policy drift %#', (override, expected) => {
    expect(() => { validateDrillProductionPolicy({ ...validPolicy, ...override }) }).toThrow(expected)
  })

  it('rejects a mounted cordis-host-runner even when the preset and permission policy are otherwise exact', () => {
    expect(() => { validateDrillProductionPolicy({ ...validPolicy, dynamicCordisRunnerMounted: true }) })
      .toThrow(/cordis-host-runner must not be mounted/)
  })

  it.each([
    ['startup'],
    ['first-search'],
  ] as const)('rejects session-query-sqlite openAt drift: %j', (sessionQuerySqliteOpenAt) => {
    expect(() => { validateDrillProductionPolicy({ ...validPolicy, sessionQuerySqliteOpenAt }) })
      .toThrow(/session-query-sqlite\.openAt must be "never"/)
  })

  it('accepts session-query-sqlite being unmounted (no sqlite engine to check)', () => {
    expect(() => { validateDrillProductionPolicy({ ...validPolicy, sessionQuerySqliteOpenAt: undefined }) })
      .not.toThrow()
  })

  it('accepts the exact production policy', () => {
    expect(() => { validateDrillProductionPolicy(validPolicy) }).not.toThrow()
  })
})

describe('DisabledDirectoryPicker', () => {
  it('reports an unrecognized capability kind, which the client already hides by documented default', () => {
    const ctx = new Context()
    const picker = new DisabledDirectoryPicker(ctx)

    expect(picker.capability()).toEqual({ kind: 'disabled' })
  })
})
