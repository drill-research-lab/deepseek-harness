/**
 * Linux process-lifetime exclusion for one mutable DSH deployment.
 * @module @deepseek-ai/dsh-app-boot/deployment-writer-lease
 */

import { spawn } from 'node:child_process'
import { chmod, mkdir, open, type FileHandle } from 'node:fs/promises'
import { join } from 'node:path'

const PRIVATE_DIRECTORY_MODE = 0o700
const PRIVATE_FILE_MODE = 0o600
const WRITER_LOCK_FILENAME = '.writer.lock'

/** Process-lifetime deployment writer lease. */
export interface DeploymentWriterLease {
  /** Release the lease and wait for the lock holder to exit. */
  release(): Promise<void>
}

function flockDescriptor(handle: FileHandle, lockPath: string): Promise<void> {
  return new Promise((resolveLock, reject) => {
    let errorOutput = ''
    const child = spawn('flock', ['--nonblock', '3'], {
      stdio: ['ignore', 'ignore', 'pipe', handle.fd],
    })
    /* v8 ignore next -- requires replacing the platform flock executable with a failing test double */
    child.stderr?.on('data', (chunk: Buffer) => { errorOutput += chunk.toString('utf8') })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) {
        resolveLock()
        return
      }
      /* v8 ignore else -- flock documents contention as 1; other codes are platform/tool failures */
      if (code === 1) {
        reject(new Error(`dsh-app-boot: another DSH writer owns ${lockPath}`))
        return
      }
      /* v8 ignore next -- flock documents contention as 1; other codes are platform/tool failure diagnostics */
      reject(new Error(
        `dsh-app-boot: flock failed for ${lockPath} (code ${String(code)}; ${errorOutput.trim()})`,
      ))
    })
  })
}

/**
 * Acquire the Linux writer lease for one resolved mutable DSH deployment.
 * The kernel releases the advisory lock when the helper exits, including
 * after abrupt parent termination; a stale file does not retain ownership.
 * @param deploymentRoot - Resolved DSH home identifying the mutable deployment.
 * @returns A releasable writer lease.
 */
export async function acquireDeploymentWriterLease(deploymentRoot: string): Promise<DeploymentWriterLease> {
  /* v8 ignore next 2 -- the Linux CI run covers the production contract; other platforms fail explicitly */
  if (process.platform !== 'linux') {
    throw new Error('dsh-app-boot: mutable DSH deployments require Linux flock')
  }
  await mkdir(deploymentRoot, { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
  const lockPath = join(deploymentRoot, WRITER_LOCK_FILENAME)
  const handle = await open(lockPath, 'a+', PRIVATE_FILE_MODE)
  try {
    await flockDescriptor(handle, lockPath)
    await chmod(deploymentRoot, PRIVATE_DIRECTORY_MODE)
    await chmod(lockPath, PRIVATE_FILE_MODE)
  } catch (error) {
    await handle.close()
    throw error
  }
  let released: Promise<void> | undefined
  return {
    release(): Promise<void> {
      if (released !== undefined) return released
      released = handle.close()
      return released
    },
  }
}
