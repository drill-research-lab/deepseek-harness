import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { acquireDeploymentWriterLease } from '../src/index.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-deployment-lease-'))
  roots.push(root)
  return root
}

function nextMessage(child: ReturnType<typeof spawn>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    child.once('message', resolve)
    child.once('error', reject)
  })
}

describe.runIf(process.platform === 'linux')('deployment writer lease', () => {
  it('rejects a second writer, allows separate deployments, and reacquires after idempotent release', async () => {
    const firstDeployment = await temporaryRoot()
    const secondDeployment = await temporaryRoot()
    const first = await acquireDeploymentWriterLease(firstDeployment)
    await expect(acquireDeploymentWriterLease(firstDeployment)).rejects.toThrow(/another DSH writer/)
    const isolated = await acquireDeploymentWriterLease(secondDeployment)
    await isolated.release()
    await first.release()
    await first.release()
    const reacquired = await acquireDeploymentWriterLease(firstDeployment)
    await reacquired.release()
  })

  it('treats a stale lock file as unowned', async () => {
    const deployment = await temporaryRoot()
    await writeFile(join(deployment, '.writer.lock'), '')
    const lease = await acquireDeploymentWriterLease(deployment)
    await lease.release()
  })

  it('releases the kernel lease after abnormal writer termination', async () => {
    const deployment = await temporaryRoot()
    const program = [
      "import { acquireDeploymentWriterLease } from './packages/boot/app-boot/src/index.ts'",
      `await acquireDeploymentWriterLease(${JSON.stringify(deployment)})`,
      "process.send?.('locked')",
      'setInterval(() => {}, 1_000)',
    ].join(';')
    const child = spawn(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '-e', program], {
      cwd: process.cwd(),
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    })
    expect(await nextMessage(child)).toBe('locked')
    child.kill('SIGKILL')
    await once(child, 'exit')
    const recovered = await acquireDeploymentWriterLease(deployment)
    await recovered.release()
  })
})
