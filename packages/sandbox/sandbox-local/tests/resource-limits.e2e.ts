import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { probeResourceLimits, resourceLimitedArgv } from '../src/resource-limits.ts'

const systemdUsable = process.platform === 'linux' && probeResourceLimits(10_000)
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

function run(limits: Parameters<typeof resourceLimitedArgv>[0], argv: readonly string[], timeout = 30_000) {
  const command = resourceLimitedArgv(limits, argv)
  return spawnSync(command[0] as string, command.slice(1), { encoding: 'utf8', timeout })
}

describe.skipIf(!systemdUsable)('sandbox-local: real systemd user-scope resource limits', () => {
  it('throttles one CPU-bound process to half a logical CPU', () => {
    const script = String.raw`const start = process.hrtime.bigint(); const cpu = process.cpuUsage();
while (Number(process.hrtime.bigint() - start) < 2e9) {}
const used = process.cpuUsage(cpu); console.log((used.user + used.system) / 1e6)`
    const result = run({ cpuQuotaPercent: 50 }, [process.execPath, '-e', script])
    expect(result.status, result.stderr).toBe(0)
    const cpuSeconds = Number(result.stdout.trim())
    expect(cpuSeconds).toBeGreaterThan(0.7)
    expect(cpuSeconds).toBeLessThan(1.35)
  }, 15_000)

  it('kills an allocation that exceeds a memory maximum with the safe zero-swap default', () => {
    const script = String.raw`const held = []; for (;;) { const block = Buffer.alloc(8 * 1024 * 1024, 1); held.push(block) }`
    const result = run(
      { memory: { maxBytes: 67_108_864, swapMaxBytes: 0 } },
      [process.execPath, '-e', script],
    )
    expect(result.status, result.stderr).toBe(137)
  }, 15_000)

  it('terminates the complete process tree after the stop grace', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-resource-walltime-'))
    tempDirs.push(dir)
    const pidFile = join(dir, 'grandchild.pid')
    const shell = `trap '' TERM; sh -c 'trap "" TERM; echo $$ > "${pidFile}"; while :; do sleep 1; done' & while :; do sleep 1; done`
    const result = run(
      { walltime: { runtimeSeconds: 1, timeoutStopSeconds: 1 } },
      ['/bin/sh', '-c', shell],
      10_000,
    )
    expect(result.status, result.stderr).toBe(137)
    const pid = Number(readFileSync(pidFile, 'utf8').trim())
    expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }))
  }, 15_000)
})
