import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local'
import type { Config } from '@deepseek-ai/dsh-sandbox-local'
import { bwrapProfileArgs } from '../src/profiles.ts'

/**
 * Keyless backend integration through `confine()` and a real bwrap process. With no rung forced,
 * a passing probe must select the first rung. Tests assert world effects, wrap shape, and that the
 * kernel denial matches the advertised dialect; consumer coverage lives in dsh-bash-sandbox.
 * Skips when bwrap or user namespaces are unavailable. HOME-based workspaces avoid bwrap's
 * ephemeral `/tmp`, so workspace-write actually proves the workspace-root rebind.
 */

const probe = spawnSync('bwrap', [...bwrapProfileArgs({ mode: 'read-only', workspaceRoot: '/' }), '--', 'true'], { timeout: 5_000, stdio: 'ignore' })
const bwrapUsable = probe.status === 0

let ctx: Context | undefined
const tempDirs: string[] = []
const tempFiles: string[] = []

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  for (const file of tempFiles.splice(0)) rmSync(file, { force: true })
})

async function tempDir(base: string): Promise<string> {
  const dir = await mkdtemp(join(base, 'dsh-bwrap-e2e-'))
  tempDirs.push(dir)
  return dir
}

async function provider(config: Config = {}): Promise<LocalSandboxProvider> {
  ctx = new Context()
  await ctx.plugin(LocalSandboxProvider, config)
  return ctx.sandbox as LocalSandboxProvider
}

/** Confine a shell command under `policy` and run it for real; returns the spawn result and the wrap's facts. */
function runConfined(sandbox: LocalSandboxProvider, command: string, policy: SandboxPolicy) {
  const confined = sandbox.confine(['bash', '-c', command], policy)
  const result = spawnSync(confined.argv[0] as string, confined.argv.slice(1), { timeout: 30_000, encoding: 'utf8' })
  return { result, confined }
}

describe.skipIf(!bwrapUsable)('sandbox-local: real bwrap confinement', () => {
  it('the passing probe selects the bwrap rung naturally — first in the ladder, full enforcement, EROFS dialect', async () => {
    const workdir = await tempDir(tmpdir())
    const sandbox = await provider()
    const confined = sandbox.confine(['true'], { mode: 'read-only', workspaceRoot: workdir })
    expect(confined.argv[0]).toBe('bwrap')
    expect(confined.enforcement).toBe('full')
    expect(confined.denialSignatures).toEqual(['read-only file system'])
  })

  it('read-only denies a write — the file must NOT exist, and the kernel speaks the advertised dialect', async () => {
    const workdir = await tempDir(tmpdir())
    const sandbox = await provider()
    const { result } = runConfined(sandbox, `echo hi > ${workdir}/denied.txt`, { mode: 'read-only', workspaceRoot: workdir })
    expect(result.status).not.toBe(0)
    // The wrap's denialSignatures must be what the kernel actually prints.
    expect(result.stderr.toLowerCase()).toContain('read-only file system')
    expect(existsSync(join(workdir, 'denied.txt'))).toBe(false)
  })

  it('read-only keeps the tree readable/executable and the fresh /dev/null writable', async () => {
    const workdir = await tempDir(tmpdir())
    await writeFile(join(workdir, 'identity.txt'), 'alice')
    const sandbox = await provider()
    const { result } = runConfined(sandbox, 'test "$PWD" = /workspace && test "$(cat identity.txt)" = alice && ls / > /dev/null && echo dev-ok', { mode: 'read-only', workspaceRoot: workdir })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('dev-ok\n')
  })

  it('workspace-write lands a write inside the workspace root and still denies one beside it', async () => {
    const workdir = await tempDir(homedir())
    const outside = await tempDir(homedir())
    const sandbox = await provider()

    const inside = runConfined(sandbox, 'test "$PWD" = /workspace && printf bwrap-ok > /workspace/allowed.txt', { mode: 'workspace-write', workspaceRoot: workdir })
    expect(inside.result.status).toBe(0)
    expect(readFileSync(join(workdir, 'allowed.txt'), 'utf8')).toBe('bwrap-ok')

    const denied = runConfined(sandbox, `echo hi > ${outside}/denied.txt`, { mode: 'workspace-write', workspaceRoot: workdir })
    expect(denied.result.status).not.toBe(0)
    expect(existsSync(join(outside, 'denied.txt'))).toBe(false)
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

  it('creates and reads back a multi-file, multi-directory project under /workspace, isolated per owner', async () => {
    const ownerRoots = await tempDir(homedir())
    const alice = join(ownerRoots, 'alice')
    const bob = join(ownerRoots, 'bob')
    await Promise.all([mkdir(alice), mkdir(bob)])

    const sandbox = await provider({ workspaceStorageRoot: ownerRoots })
    const buildProject = [
      'mkdir -p src/lib test',
      'printf "export const value = 1;\\n" > src/index.ts',
      'printf "export const helper = () => value;\\n" > src/lib/helper.ts',
      'printf "check(helper());\\n" > test/helper.test.ts',
      'find . -type f | sort',
    ].join(' && ')

    const aliceRun = runConfined(sandbox, buildProject, { mode: 'workspace-write', workspaceRoot: alice })
    expect(aliceRun.result.status, aliceRun.result.stderr).toBe(0)
    expect(aliceRun.result.stdout).toBe(
      ['./src/index.ts', './src/lib/helper.ts', './test/helper.test.ts'].join('\n') + '\n',
    )
    expect(readFileSync(join(alice, 'src', 'lib', 'helper.ts'), 'utf8')).toBe('export const helper = () => value;\n')

    const bobRun = runConfined(sandbox, buildProject, { mode: 'workspace-write', workspaceRoot: bob })
    expect(bobRun.result.status, bobRun.result.stderr).toBe(0)
    expect(readFileSync(join(bob, 'test', 'helper.test.ts'), 'utf8')).toBe('check(helper());\n')

    const aliceReadBob = runConfined(
      sandbox,
      `cat ${bob}/src/index.ts 2>&1; find ${bob} 2>&1`,
      { mode: 'workspace-write', workspaceRoot: alice },
    )
    expect(aliceReadBob.result.status).not.toBe(0)
    expect(aliceReadBob.result.stdout).not.toContain('value')
  })

  it('workspace-write mounts an EPHEMERAL /tmp: the write succeeds inside, the host /tmp stays untouched', async () => {
    // The documented bwrap-profile difference: Landlock and Seatbelt grant
    // the HOST temp areas, bwrap swaps in a fresh tmpfs that dies with the
    // process — the strongest of the three temp semantics.
    const workdir = await tempDir(homedir())
    const target = `/tmp/dsh-bwrap-e2e-ephemeral-${process.pid}.txt`
    tempFiles.push(target)
    const sandbox = await provider()
    const { result } = runConfined(sandbox, `printf tmp-ok > ${target} && cat ${target}`, { mode: 'workspace-write', workspaceRoot: workdir })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('tmp-ok')
    expect(existsSync(target)).toBe(false)
  })
})
