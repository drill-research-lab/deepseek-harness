import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SANDBOX_UNAVAILABLE } from '@deepseek-ai/dsh-sandbox'
import { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local'
import {
  resolveResourceLimits,
  resourceLimitedArgv,
  resourceLimitPropertyArgs,
} from '../src/resource-limits.ts'

async function provider(config: ConstructorParameters<typeof LocalSandboxProvider>[1]) {
  const ctx = new Context()
  await ctx.plugin(LocalSandboxProvider, config)
  const sandbox = ctx.sandbox as LocalSandboxProvider
  sandbox.internals = { platform: 'linux', probeBwrap: () => true }
  return sandbox
}

describe('resource-limit config', () => {
  it('leaves the systemd rung absent when no limit is configured', () => {
    expect(resolveResourceLimits({})).toBeUndefined()
  })

  it('turns a memory maximum into a hard limit by defaulting swap to zero', () => {
    const limits = resolveResourceLimits({ memoryMaxBytes: 104_857_600 })
    expect(limits).toEqual({ memory: { maxBytes: 104_857_600, swapMaxBytes: 0 } })
    expect(resourceLimitPropertyArgs(limits!)).toEqual([
      '-p', 'MemoryMax=104857600',
      '-p', 'MemorySwapMax=0',
    ])
  })

  it('retains an explicit finite swap allowance beside its memory maximum', () => {
    expect(resolveResourceLimits({ memoryMaxBytes: 1000, memorySwapMaxBytes: 250 }))
      .toEqual({ memory: { maxBytes: 1000, swapMaxBytes: 250 } })
  })

  it('rejects swap without a resident-memory maximum', () => {
    expect(() => resolveResourceLimits({ memorySwapMaxBytes: 0 })).toThrow(
      'memorySwapMaxBytes requires memoryMaxBytes',
    )
  })

  it('defaults the SIGTERM-to-SIGKILL escalation and permits an explicit bound', () => {
    expect(resolveResourceLimits({ walltimeSeconds: 3 }))
      .toEqual({ walltime: { runtimeSeconds: 3, timeoutStopSeconds: 2 } })
    expect(resolveResourceLimits({ walltimeSeconds: 3, timeoutStopSeconds: 1 }))
      .toEqual({ walltime: { runtimeSeconds: 3, timeoutStopSeconds: 1 } })
  })

  it('rejects a stop timeout without a walltime owner', () => {
    expect(() => resolveResourceLimits({ timeoutStopSeconds: 1 })).toThrow(
      'timeoutStopSeconds requires walltimeSeconds',
    )
  })

  it.each([
    ['cpuQuotaPercent', { cpuQuotaPercent: 0 }],
    ['memoryMaxBytes', { memoryMaxBytes: 1.5 }],
    ['memorySwapMaxBytes', { memoryMaxBytes: 1, memorySwapMaxBytes: -1 }],
    ['maxTasks', { maxTasks: Number.POSITIVE_INFINITY }],
    ['walltimeSeconds', { walltimeSeconds: Number.NaN }],
    ['timeoutStopSeconds', { walltimeSeconds: 1, timeoutStopSeconds: 0 }],
  ])('rejects invalid %s', (_name, config) => {
    expect(() => resolveResourceLimits(config)).toThrow(/sandbox-local:/u)
  })

  it('renders every systemd property in a stable outer invocation', () => {
    const limits = resolveResourceLimits({
      cpuQuotaPercent: 50,
      memoryMaxBytes: 1000,
      memorySwapMaxBytes: 20,
      maxTasks: 12,
      walltimeSeconds: 4,
      timeoutStopSeconds: 1,
    })!
    expect(resourceLimitedArgv(limits, ['pid-isolate-run', '--', 'true'])).toEqual([
      'systemd-run', '--user', '--scope', '--quiet',
      '-p', 'CPUQuota=50%',
      '-p', 'MemoryMax=1000',
      '-p', 'MemorySwapMax=20',
      '-p', 'TasksMax=12',
      '-p', 'RuntimeMaxSec=4',
      '-p', 'TimeoutStopSec=1',
      '--', 'pid-isolate-run', '--', 'true',
    ])
  })
})

describe('resource-limit runner rung', () => {
  it('wraps the selected sandbox chain outermost after one passing probe', async () => {
    const probeResourceLimits = vi.fn(() => true)
    const sandbox = await provider({ cpuQuotaPercent: 50, memoryMaxBytes: 1024, maxTasks: 8 })
    sandbox.internals.probeResourceLimits = probeResourceLimits

    const first = sandbox.confine(['true'], { mode: 'read-only', workspaceRoot: '/ws' })
    const second = sandbox.confine(['false'], { mode: 'read-only', workspaceRoot: '/ws' })

    expect(first.argv).toEqual([
      'systemd-run', '--user', '--scope', '--quiet',
      '-p', 'CPUQuota=50%',
      '-p', 'MemoryMax=1024',
      '-p', 'MemorySwapMax=0',
      '-p', 'TasksMax=8',
      '--', 'bwrap', '--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--die-with-parent',
      '--ro-bind', '/ws', '/workspace', '--chdir', '/workspace', '--', 'true',
    ])
    expect(first.runnerFailureRules[0]).toEqual({
      fatalSignatures: ['Failed to connect to bus', 'Failed to start transient scope unit'],
    })
    expect(second.argv.at(-1)).toBe('false')
    expect(probeResourceLimits).toHaveBeenCalledTimes(1)
  })

  it('fails closed and caches an unavailable user manager', async () => {
    const probeResourceLimits = vi.fn(() => false)
    const sandbox = await provider({ walltimeSeconds: 1 })
    sandbox.internals.probeResourceLimits = probeResourceLimits
    const policy = { mode: 'read-only' as const, workspaceRoot: '/ws' }

    expect(() => sandbox.confine(['true'], policy)).toThrow(expect.objectContaining({ code: SANDBOX_UNAVAILABLE }))
    expect(() => sandbox.confine(['true'], policy)).toThrow(expect.objectContaining({ code: SANDBOX_UNAVAILABLE }))
    expect(probeResourceLimits).toHaveBeenCalledTimes(1)
  })

  it('does not require systemd when resource limiting is not configured', async () => {
    const probeResourceLimits = vi.fn(() => false)
    const sandbox = await provider({})
    sandbox.internals.probeResourceLimits = probeResourceLimits
    expect(sandbox.confine(['true'], { mode: 'read-only', workspaceRoot: '/ws' }).argv[0]).toBe('bwrap')
    expect(probeResourceLimits).not.toHaveBeenCalled()
  })
})
