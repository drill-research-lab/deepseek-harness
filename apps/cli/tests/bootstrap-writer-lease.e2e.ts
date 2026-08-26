import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const roots: string[] = []
const children = new Set<ReturnType<typeof spawn>>()

afterEach(async () => {
  await Promise.all([...children].map(async (child) => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    if (child.exitCode === null && child.signalCode === null) await once(child, 'exit')
  }))
  children.clear()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bootstrap-lease-'))
  roots.push(root)
  return root
}

async function stageProfile(home: string, name = 'lease-test'): Promise<string> {
  const profileDir = join(home, 'profiles', name)
  await mkdir(profileDir, { recursive: true })
  await writeFile(join(profileDir, 'package.json'), JSON.stringify({
    name: `dsh-profile-${name}`,
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: [] } },
  }, undefined, 2) + '\n')
  await writeFile(join(profileDir, 'cordis.patch.yml'), [
    '- insert:',
    '    - id: timer',
    "      name: '@deepseek-ai/cordis-plugin-timer'",
    '    - id: hmr',
    "      name: '@deepseek-ai/cordis-plugin-hmr'",
    '      config:',
    '        root: [.]',
    '',
  ].join('\n'))
  return profileDir
}

function spawnProfile(home: string, usersRoot: string, mode: 'hold' | 'dispose' = 'hold') {
  const program = [
    'import { loadLayeredEnv } from \'./packages/boot/app-boot/src/index.ts\'',
    'import { runProfile } from \'./apps/cli/src/profile-boot.ts\'',
    'try {',
    'const { ctx } = await runProfile({ environment: loadLayeredEnv(\'lease-test\'), profile: \'lease-test\', patchFiles: [], args: [] })',
    mode === 'dispose'
      ? 'await ctx.fiber.dispose();process.send?.(\'disposed\', () => process.exit(0))'
      : 'process.send?.(\'ready\');setInterval(() => {}, 1_000)',
    '} catch (error) {',
    'process.send?.(`failed:${error instanceof Error ? error.message : String(error)}`, () => process.exit(0))',
    '}',
  ].join(';')
  const child = spawn(process.execPath, [
    '--import', 'tsx/esm', '--input-type=module', '-e', program, 'dsh-bootstrap-lease-test',
  ], {
    cwd: process.cwd(),
    env: { ...process.env, DSH_HOME: home, DSH_USERS_HOME: usersRoot },
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  })
  children.add(child)
  return child
}

function nextMessage(child: ReturnType<typeof spawn>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    child.once('message', resolve)
    child.once('error', reject)
  })
}

async function waitForExit(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) await once(child, 'exit')
  children.delete(child)
}

describe.runIf(process.platform === 'linux')('profile bootstrap deployment writer lease', () => {
  it('rejects a same-home loser before the real profile path mutates and allows a separate deployment', async () => {
    const root = await temporaryRoot()
    const home = join(root, 'deployment')
    const profileDir = await stageProfile(home)
    const first = spawnProfile(home, join(root, 'users-a'))
    expect(await nextMessage(first)).toBe('ready')

    const rootConfig = join(profileDir, 'cordis.yml')
    const sentinel = '# unchanged if the losing bootstrap never prepares the profile\n[]\n'
    await writeFile(rootConfig, sentinel)
    const competing = spawnProfile(home, join(root, 'users-b'))
    expect(await nextMessage(competing)).toMatch(/^failed:.*another DSH writer/)
    await waitForExit(competing)
    expect(await readFile(rootConfig, 'utf8')).toBe(sentinel)

    const isolatedHome = join(root, 'deployment-b')
    await stageProfile(isolatedHome)
    const isolated = spawnProfile(isolatedHome, join(root, 'users-b'))
    expect(await nextMessage(isolated)).toBe('ready')

    first.kill('SIGKILL')
    await waitForExit(first)
    const recovered = spawnProfile(home, join(root, 'users-c'))
    expect(await nextMessage(recovered)).toBe('ready')
  }, 30_000)

  it('releases after normal application disposal', async () => {
    const root = await temporaryRoot()
    const home = join(root, 'deployment')
    await stageProfile(home)
    const first = spawnProfile(home, join(root, 'users-a'), 'dispose')
    expect(await nextMessage(first)).toBe('disposed')
    await waitForExit(first)
    const reacquired = spawnProfile(home, join(root, 'users-b'))
    expect(await nextMessage(reacquired)).toBe('ready')
  }, 30_000)

  it('releases when profile preparation fails after acquisition', async () => {
    const root = await temporaryRoot()
    const home = join(root, 'deployment')
    const profileDir = await stageProfile(home)
    await writeFile(join(profileDir, 'package.json'), '{')
    const failed = spawnProfile(home, join(root, 'users-a'))
    expect(await nextMessage(failed)).toMatch(/^failed:/)
    await waitForExit(failed)
    await stageProfile(home)
    const recovered = spawnProfile(home, join(root, 'users-b'))
    expect(await nextMessage(recovered)).toBe('ready')
  }, 30_000)
})
