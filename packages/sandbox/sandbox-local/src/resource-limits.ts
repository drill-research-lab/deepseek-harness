/**
 * systemd user-scope resource-limit resolution, argv construction, and
 * functional probing for the local sandbox provider.
 * @module @deepseek-ai/dsh-sandbox-local/resource-limits
 */

import { spawnSync } from 'node:child_process'

/** User-configurable limits for one local sandbox process tree. */
export interface ResourceLimitConfig {
  /** CPU capacity as a percentage of one logical CPU; values above 100 permit multiple CPUs. */
  cpuQuotaPercent?: number
  /** Maximum resident memory in bytes. Setting this also sets swap to zero unless explicitly bounded. */
  memoryMaxBytes?: number
  /** Maximum swap in bytes; valid only with {@link memoryMaxBytes}. */
  memorySwapMaxBytes?: number
  /** Maximum number of tasks in the scope. */
  maxTasks?: number
  /** Seconds before systemd stops the entire scope. */
  walltimeSeconds?: number
  /** Seconds between systemd's stop request and its SIGKILL escalation. */
  timeoutStopSeconds?: number
}

/** Validated limits used to build a transient systemd scope. */
export interface ResourceLimits {
  cpuQuotaPercent?: number
  memory?: { maxBytes: number; swapMaxBytes: number }
  maxTasks?: number
  walltime?: { runtimeSeconds: number; timeoutStopSeconds: number }
}

const DEFAULT_TIMEOUT_STOP_SECONDS = 2

/** Reject a non-positive or non-finite setting. */
function positive(name: string, value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`sandbox-local: ${name} must be a positive finite number`)
  }
  return value
}

/** Reject a byte/task setting that systemd cannot represent exactly. */
function positiveSafeInteger(name: string, value: number): number {
  positive(name, value)
  if (!Number.isSafeInteger(value)) {
    throw new Error(`sandbox-local: ${name} must be a positive safe integer`)
  }
  return value
}

/** Reject a swap bound that systemd cannot represent exactly. */
function nonnegativeSafeInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`sandbox-local: ${name} must be a non-negative safe integer`)
  }
  return value
}

/**
 * Resolve optional config into one safe systemd policy.
 * @param config - plugin fields supplied by the operator.
 * @returns validated limits, or `undefined` when resource limiting is explicitly not configured.
 */
export function resolveResourceLimits(config: ResourceLimitConfig): ResourceLimits | undefined {
  if (config.memorySwapMaxBytes !== undefined && config.memoryMaxBytes === undefined) {
    throw new Error('sandbox-local: memorySwapMaxBytes requires memoryMaxBytes')
  }
  if (config.timeoutStopSeconds !== undefined && config.walltimeSeconds === undefined) {
    throw new Error('sandbox-local: timeoutStopSeconds requires walltimeSeconds')
  }
  const configured = config.cpuQuotaPercent !== undefined
    || config.memoryMaxBytes !== undefined
    || config.maxTasks !== undefined
    || config.walltimeSeconds !== undefined
  if (!configured) return undefined

  return {
    ...(config.cpuQuotaPercent === undefined ? {} : { cpuQuotaPercent: positive('cpuQuotaPercent', config.cpuQuotaPercent) }),
    ...(config.memoryMaxBytes === undefined ? {} : {
      memory: {
        maxBytes: positiveSafeInteger('memoryMaxBytes', config.memoryMaxBytes),
        swapMaxBytes: config.memorySwapMaxBytes === undefined
          ? 0
          : nonnegativeSafeInteger('memorySwapMaxBytes', config.memorySwapMaxBytes),
      },
    }),
    ...(config.maxTasks === undefined ? {} : { maxTasks: positiveSafeInteger('maxTasks', config.maxTasks) }),
    ...(config.walltimeSeconds === undefined ? {} : {
      walltime: {
        runtimeSeconds: positive('walltimeSeconds', config.walltimeSeconds),
        timeoutStopSeconds: positive('timeoutStopSeconds', config.timeoutStopSeconds ?? DEFAULT_TIMEOUT_STOP_SECONDS),
      },
    }),
  }
}

/**
 * Convert validated limits to systemd transient-unit property arguments.
 * @param limits - validated scope limits.
 * @returns repeated `-p name=value` arguments in stable order.
 */
export function resourceLimitPropertyArgs(limits: ResourceLimits): string[] {
  const args: string[] = []
  if (limits.cpuQuotaPercent !== undefined) args.push('-p', `CPUQuota=${limits.cpuQuotaPercent}%`)
  if (limits.memory !== undefined) {
    args.push('-p', `MemoryMax=${limits.memory.maxBytes}`)
    args.push('-p', `MemorySwapMax=${limits.memory.swapMaxBytes}`)
  }
  if (limits.maxTasks !== undefined) args.push('-p', `TasksMax=${limits.maxTasks}`)
  if (limits.walltime !== undefined) {
    args.push('-p', `RuntimeMaxSec=${limits.walltime.runtimeSeconds}`)
    args.push('-p', `TimeoutStopSec=${limits.walltime.timeoutStopSeconds}`)
  }
  return args
}

/**
 * Wrap one command in a transient user scope.
 * @param limits - validated scope limits.
 * @param argv - complete inner sandbox runner chain.
 * @returns the outer systemd-run invocation.
 */
export function resourceLimitedArgv(limits: ResourceLimits, argv: readonly string[]): string[] {
  return ['systemd-run', '--user', '--scope', '--quiet', ...resourceLimitPropertyArgs(limits), '--', ...argv]
}

const PROBE_SCRIPT = String.raw`path=$(awk -F: '$1 == "0" { print $3 }' /proc/self/cgroup) || exit 1
root=/sys/fs/cgroup$path
printf '%s\n' "$(cat "$root/cpu.max")" "$(cat "$root/memory.max")" "$(cat "$root/memory.swap.max")" "$(cat "$root/pids.max")"`

/**
 * Prove that the user manager can create a scope and write delegated cpu,
 * memory, swap, and pids controller values.
 * @param timeoutMs - synchronous probe deadline.
 * @returns whether the child observed every expected cgroup v2 value.
 */
export function probeResourceLimits(timeoutMs: number): boolean {
  const result = spawnSync('systemd-run', [
    '--user', '--scope', '--quiet',
    '-p', 'CPUQuota=50%',
    '-p', 'MemoryMax=67108864',
    '-p', 'MemorySwapMax=0',
    '-p', 'TasksMax=32',
    '--', '/bin/sh', '-c', PROBE_SCRIPT,
  ], { encoding: 'utf8', timeout: timeoutMs })
  if (result.status !== 0) return false
  const [cpuMax, memoryMax, swapMax, tasksMax] = result.stdout.trim().split('\n')
  const [quotaText, periodText] = cpuMax?.trim().split(/\s+/u) ?? []
  const quota = Number(quotaText)
  const period = Number(periodText)
  return Number.isFinite(quota)
    && Number.isFinite(period)
    && quota / period === 0.5
    && memoryMax === '67108864'
    && swapMax === '0'
    && tasksMax === '32'
}
