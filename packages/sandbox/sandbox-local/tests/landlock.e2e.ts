import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import { launcherPath } from '@deepseek-ai/node-addon-landlock-run'
import { launcherPath as pidIsolateLauncherPath } from '@deepseek-ai/node-addon-pid-isolate-run'
import { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local'
import type { Config } from '@deepseek-ai/dsh-sandbox-local'
import { LINUX_WORKSPACE_ROOT } from '../src/profiles.ts'

/**
 * Keyless backend integration through `confine()` and the workspace `landlock-run` launcher, with
 * bwrap forced off. Tests assert real world effects; consumer coverage lives in dsh-bash-sandbox.
 * Skips when the platform package or enforcing kernel is unavailable. HOME-based workspaces avoid
 * Landlock's wholesale `/tmp` grant, so workspace-write proves the workspace-root grant itself.
 */

const probe = spawnSync(launcherPath(), ['--probe'], { timeout: 5_000, encoding: 'utf8' })
const pidProbe = spawnSync(pidIsolateLauncherPath(), ['--probe'], { timeout: 5_000, encoding: 'utf8' })
const landlockUsable = probe.status === 0 && pidProbe.status === 0 && existsSync(LINUX_WORKSPACE_ROOT)
/** The running kernel's enforcement level, from the launcher's probe report — every wrap below must carry exactly this. */
const enforcement = /partially enforced/.test(probe.stdout ?? '') ? 'partial' : 'full'

let ctx: Context | undefined
const tempDirs: string[] = []

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function tempDir(base: string): Promise<string> {
  const dir = await mkdtemp(join(base, 'dsh-landlock-e2e-'))
  tempDirs.push(dir)
  return dir
}

async function provider(config: Config = {}): Promise<LocalSandboxProvider> {
  ctx = new Context()
  await ctx.plugin(LocalSandboxProvider, config)
  const sandbox = ctx.sandbox as LocalSandboxProvider
  sandbox.internals = { probeBwrap: () => false }
  return sandbox
}

/** Confine a shell command under `policy` and run it for real; returns the spawn result and the wrap's enforcement. */
function runConfined(sandbox: LocalSandboxProvider, command: string, policy: SandboxPolicy) {
  const confined = sandbox.confine(['bash', '-c', command], policy)
  const result = spawnSync(confined.argv[0] as string, confined.argv.slice(1), {
    cwd: policy.workspaceRoot,
    timeout: 30_000,
    encoding: 'utf8',
  })
  return { result, enforcement: confined.enforcement }
}

describe.skipIf(!landlockUsable)('sandbox-local: real Landlock confinement through the bundled launcher', () => {
  it('limits reads to system roots and the workspace while merged-usr executables and their ELF interpreter run', async () => {
    const workdir = await tempDir(homedir())
    const outside = await tempDir(homedir())
    await Promise.all([
      writeFile(join(workdir, 'inside.txt'), 'inside-ok'),
      writeFile(join(outside, 'secret.txt'), 'outside-secret'),
      copyFile(process.execPath, join(workdir, 'node-runtime')),
    ])
    const interpreterReport = spawnSync('readelf', ['-l', '/usr/bin/bash'], { encoding: 'utf8' })
    expect(interpreterReport.status).toBe(0)
    const interpreter = /Requesting program interpreter:\s*([^\]]+)/u.exec(interpreterReport.stdout)?.[1]
    expect(interpreter).toBeDefined()

    const sandbox = await provider()
    const allowed = runConfined(
      sandbox,
      [
        'test "$(cat inside.txt)" = inside-ok',
        'test -r /usr/bin/bash',
        'test -r /etc/ld.so.cache',
        'test -d /etc/alternatives',
        '/bin/bash -c true',
        '/sbin/ldconfig -p >/dev/null',
        'git --version >/dev/null',
        './node-runtime --version >/dev/null',
        `${interpreter} /usr/bin/true`,
      ].join(' && '),
      { mode: 'read-only', workspaceRoot: workdir },
    )
    expect(allowed.result.status, allowed.result.stderr).toBe(0)

    const deniedOutside = runConfined(
      sandbox,
      `cat ${outside}/secret.txt >/dev/null`,
      { mode: 'read-only', workspaceRoot: workdir },
    )
    expect(deniedOutside.result.status).not.toBe(0)
    expect(deniedOutside.result.stderr.toLowerCase()).toContain('permission denied')

    const deniedEtc = runConfined(
      sandbox,
      'cat /etc/passwd >/dev/null',
      { mode: 'read-only', workspaceRoot: workdir },
    )
    expect(deniedEtc.result.status).not.toBe(0)
    expect(deniedEtc.result.stderr.toLowerCase()).toContain('permission denied')
  })

  it('maps each owner to an isolated /workspace and denies the other owner root', async () => {
    const ownerRoots = await tempDir(homedir())
    const alice = join(ownerRoots, 'alice')
    const bob = join(ownerRoots, 'bob')
    await Promise.all([mkdir(alice), mkdir(bob)])
    await Promise.all([
      writeFile(join(alice, 'identity.txt'), 'alice'),
      writeFile(join(bob, 'identity.txt'), 'bob'),
    ])
    const sandbox = await provider({ workspaceStorageRoot: ownerRoots })
    const aliceRun = runConfined(
      sandbox,
      `printf 'cwd=%s identity=%s visible=%s' "$PWD" "$(cat identity.txt)" "$(test -e ${bob} && echo yes || echo no)"; cat ${bob}/identity.txt`,
      { mode: 'workspace-write', workspaceRoot: alice },
    )
    expect(aliceRun.result.status).not.toBe(0)
    expect(aliceRun.result.stdout).toBe('cwd=/workspace identity=alice visible=no')

    const bobRun = runConfined(
      sandbox,
      `printf 'cwd=%s identity=%s visible=%s' "$PWD" "$(cat identity.txt)" "$(test -e ${alice} && echo yes || echo no)"; cat ${alice}/identity.txt`,
      { mode: 'workspace-write', workspaceRoot: bob },
    )
    expect(bobRun.result.status).not.toBe(0)
    expect(bobRun.result.stdout).toBe('cwd=/workspace identity=bob visible=no')
  })

  it('read-only denies a write — the file must NOT exist, the wrap reports the probed enforcement', async () => {
    const workdir = await tempDir(tmpdir())
    const sandbox = await provider()
    const { result, enforcement: wrapped } = runConfined(sandbox, 'echo hi > /workspace/denied.txt', { mode: 'read-only', workspaceRoot: workdir })
    expect(result.status).not.toBe(0)
    expect(wrapped).toBe(enforcement)
    expect(existsSync(join(workdir, 'denied.txt'))).toBe(false)
  })

  it('read-only keeps the workspace readable/executable and /dev/null writable', async () => {
    const workdir = await tempDir(tmpdir())
    const sandbox = await provider()
    const { result } = runConfined(sandbox, 'ls . > /dev/null && echo dev-ok', { mode: 'read-only', workspaceRoot: workdir })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('dev-ok\n')
  })

  it('read-only denies a write beneath the host /dev (the /dev/shm tmpfs must stay untouched)', async () => {
    // The grant is /dev/null the FILE, not /dev the directory: /dev/shm is a
    // world-writable host tmpfs, and a write landing there would be exactly
    // the persistent host effect read-only promises never happen.
    const workdir = await tempDir(tmpdir())
    const sandbox = await provider()
    const target = `/dev/shm/dsh-landlock-e2e-${process.pid}`
    const { result } = runConfined(sandbox, `echo hi > ${target}`, { mode: 'read-only', workspaceRoot: workdir })
    expect(result.status).not.toBe(0)
    expect(existsSync(target)).toBe(false)
  })

  it('workspace-write lands a write inside the workspace root and still denies one beside it', async () => {
    const workdir = await tempDir(homedir())
    const outside = await tempDir(homedir())
    const sandbox = await provider()

    const inside = runConfined(sandbox, 'test "$PWD" = /workspace && printf landlock-ok > /workspace/allowed.txt', { mode: 'workspace-write', workspaceRoot: workdir })
    expect(inside.result.status).toBe(0)
    expect(readFileSync(join(workdir, 'allowed.txt'), 'utf8')).toBe('landlock-ok')

    const denied = runConfined(sandbox, `echo hi > ${outside}/denied.txt`, { mode: 'workspace-write', workspaceRoot: workdir })
    expect(denied.result.status).not.toBe(0)
    expect(existsSync(join(outside, 'denied.txt'))).toBe(false)
  })

  it('workspace-write grants the host /tmp (the documented Landlock-profile difference)', async () => {
    const workdir = await tempDir(homedir())
    const scratch = await tempDir(tmpdir())
    const sandbox = await provider()
    const { result } = runConfined(sandbox, `printf tmp-ok > ${scratch}/scratch.txt`, { mode: 'workspace-write', workspaceRoot: workdir })
    expect(result.status).toBe(0)
    expect(readFileSync(join(scratch, 'scratch.txt'), 'utf8')).toBe('tmp-ok')
  })
})
