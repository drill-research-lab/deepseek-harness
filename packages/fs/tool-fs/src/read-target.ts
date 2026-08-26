/**
 * Shared path resolution and regular-file validation for model-facing read tools.
 * @module @deepseek-ai/dsh-tool-fs/src/read-target
 */

import type { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { FsInfo, FsTarget } from '@deepseek-ai/dsh-fs'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { sessionResolveOptions } from './session-cwd.ts'
import type { FsSandboxController } from './sandbox.ts'

/**
 * Resolve a model-supplied path, observe absence, and require a regular file.
 * @param ctx - the plugin context providing filesystem resolution and observation events.
 * @param sandbox - resolves the calling session's filesystem policy.
 * @param exec - the current tool execution, including session cwd and cancellation.
 * @param requestedPath - the raw path supplied to the tool.
 * @returns the resolved target, its single stat result, and the policy shared by subsequent reads.
 */
export async function resolveRegularReadTarget(
  ctx: Context,
  sandbox: FsSandboxController,
  exec: ToolExecution,
  requestedPath: string,
): Promise<{ target: FsTarget; info: FsInfo; policy: SandboxExecutionPolicy | undefined }> {
  const policy = await sandbox.resolvePolicy('read', {}, exec)
  const target = await ctx.fs.resolve(requestedPath, sessionResolveOptions(exec, requestedPath))
  const info = await ctx.fs.stat(target, exec.signal, policy)
  if (info === undefined) {
    ctx.emit('fs/observed', target, { kind: 'absent' }, exec)
    throw new FsError(`cannot read "${target.displayPath}": not found`, 'FS_NOT_FOUND')
  }
  if (info.type !== 'file') {
    throw new FsError(`cannot read "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
  }
  return { target, info, policy }
}
