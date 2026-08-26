/**
 * Internal platform-profile builders for the local sandbox provider.
 *
 * @module @deepseek-ai/dsh-sandbox-local/profiles
 */

import { isAbsolute } from 'node:path'
import { grantArgs as landlockGrantArgs } from '@deepseek-ai/node-addon-landlock-run'
import { writableRoots } from '@deepseek-ai/dsh-sandbox'
import type { SandboxPolicy } from '@deepseek-ai/dsh-sandbox'

/**
 * System roots required to execute dynamically linked programs under
 * Landlock. `/usr` owns merged-usr binaries, loaders, libraries, and locale;
 * the remaining file and directory resolve the dynamic-loader cache and
 * alternatives selected by those programs.
 */
export const LANDLOCK_SYSTEM_READ_ROOTS = ['/usr', '/etc/ld.so.cache', '/etc/alternatives'] as const
/** Fixed workspace path inside Linux mount-namespace runners. */
export const LINUX_WORKSPACE_ROOT = '/workspace'

/**
 * Build the bwrap profile arguments for one file-effect policy.
 * @param policy - file-effect policy to express as bwrap mounts.
 * @returns profile arguments before the trailing separator and command argv.
 */
export function bwrapProfileArgs(policy: SandboxPolicy): string[] {
  const args = ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--die-with-parent']
  if (policy.mode === 'workspace-write') {
    args.push('--tmpfs', '/tmp')
    args.push('--bind', policy.workspaceRoot, LINUX_WORKSPACE_ROOT)
  } else {
    args.push('--ro-bind', policy.workspaceRoot, LINUX_WORKSPACE_ROOT)
  }
  args.push('--chdir', LINUX_WORKSPACE_ROOT)
  return args
}

/**
 * Build the Landlock launcher grants for one file-effect policy.
 * @param policy - file-effect policy to express as Landlock allow-list grants.
 * @param executable - exact outer consumer executable; an absolute packaged
 *   binary outside `/usr` and the workspace needs a file-only read grant to
 *   reach `execve`. The landlock-run CLI contract guarantees that a
 *   non-directory grant applies to that file alone, never its parent
 *   directory tree.
 * @returns launcher grant arguments before the trailing separator and command argv.
 */
export function landlockProfileArgs(policy: SandboxPolicy, executable?: string): string[] {
  const readOnly = [
    ...LANDLOCK_SYSTEM_READ_ROOTS,
    LINUX_WORKSPACE_ROOT,
    ...executable !== undefined && isAbsolute(executable) ? [executable] : [],
  ]
  const readWrite = ['/dev/null']
  if (policy.mode === 'workspace-write') {
    readWrite.push('/tmp', LINUX_WORKSPACE_ROOT)
  }
  return landlockGrantArgs({ readOnly, readWrite })
}

/** Quote one path as an SBPL string literal. */
function sbplString(path: string): string {
  return `"${path.replaceAll('\\', String.raw`\\`).replaceAll('"', String.raw`\"`)}"`
}

/**
 * Build the sandbox-exec arguments and SBPL profile for one policy. The
 * writable roots come from the shared {@link writableRoots} helper (canonical,
 * deduplicated) so the Seatbelt grant and the in-process fs fence
 * (`@deepseek-ai/dsh-fs-sandbox`) can never drift apart.
 * @param policy - file-effect policy to express as an SBPL profile.
 * @returns sandbox-exec arguments before the trailing separator and command argv.
 */
export function seatbeltProfileArgs(policy: SandboxPolicy): string[] {
  const forms = ['(version 1)', '(allow default)', '(deny file-write*)', `(allow file-write* (literal ${sbplString('/dev/null')}))`]
  const roots = writableRoots(policy)
  if (roots.length > 0) {
    forms.push(`(allow file-write* ${roots.map(root => `(subpath ${sbplString(root)})`).join(' ')})`)
  }
  return ['-p', forms.join(' ')]
}
