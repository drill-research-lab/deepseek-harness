/**
 * Canonical read/write root derivation shared by enforcement layers. Confined
 * reads expose only the workspace root; `workspace-write` mutations add the
 * platform temp areas. The Seatbelt profile
 * (`@deepseek-ai/dsh-sandbox-local`) and the in-process filesystem fence
 * (`@deepseek-ai/dsh-fs-sandbox`) both derive their allow-list here, so "the
 * write tool cannot write /tmp but bash can" asymmetries cannot arise between
 * them. The bwrap and Landlock dialects keep their own grant spellings (an
 * ephemeral `/tmp` mount, launcher-owned flags) — the honest per-runner
 * differences recorded in the sandbox RFC — with parity pinned by test.
 *
 * @module dsh-sandbox/roots
 */

import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { SandboxExecutionPolicy } from './index.ts'

/**
 * Resolve a granted root to the path the enforcement layer actually compares:
 * canonical (symlinks resolved), because both Seatbelt filters and the fs
 * fence's containment check match resolved paths — `/tmp` IS `/private/tmp`
 * on darwin, and an as-spelled grant would match nothing.
 * @param path - the root as configured or platform-reported.
 * @returns the canonical path, or the spelling as-is when resolution fails
 *   (a missing root matches nothing until it exists — the conservative
 *   outcome; inventing a fallback would grant a path the caller never named).
 */
export function canonicalPath(path: string): string {
  try {
    // Node's JavaScript realpath implementation lexically collapses `..`
    // before resolving a preceding symlink on some platforms. The native
    // implementation follows the filesystem's component-by-component lookup,
    // matching chdir/spawn and the enforcement layers this identity feeds.
    return realpathSync.native(path)
  } catch {
    // realpathSync.native failed: the path (or a prefix) is missing or unreadable.
    return path
  }
}

/**
 * The roots one confined execution may READ under. Both confined modes expose
 * only the canonical workspace root; temp areas are write scratch space, not
 * an additional source of readable host data. `danger-full-access` uses no
 * allow-list because its consumer bypasses confinement.
 * @param policy - the file-effect policy to derive the allow-list from.
 * @returns the canonical workspace root for a confined mode, otherwise empty.
 */
export function readableRoots(policy: SandboxExecutionPolicy): string[] {
  if (policy.mode === 'danger-full-access') return []
  return [canonicalPath(policy.workspaceRoot)]
}

/**
 * The roots one confined execution may WRITE under — the mode's meaning as a
 * canonical, deduplicated allow-list. `read-only` allows nothing;
 * `workspace-write` allows the policy's workspace root, the host `/tmp`, and
 * the per-user platform temp dir (`os.tmpdir()` — the real temp area for
 * mkstemp-family tools; omitting it would deny what the mode promises).
 * @param policy - the file-effect policy to derive the allow-list from.
 * @returns the canonical writable roots; empty exactly under `read-only`.
 */
export function writableRoots(policy: SandboxExecutionPolicy): string[] {
  if (policy.mode !== 'workspace-write') return []
  return [...new Set([policy.workspaceRoot, '/tmp', tmpdir()].map(canonicalPath))]
}

/** Whether a `path.relative` result points outside its base (a `..` step or an absolute drift). */
function escapesBase(rel: string): boolean {
  return rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)
}

/**
 * Translate a model-supplied path from {@link SandboxExecutionPolicy.workspaceViewRoot}
 * onto the real {@link SandboxExecutionPolicy.workspaceRoot} the enforcement
 * layer contains. Identity when the policy carries no `workspaceViewRoot`, when
 * `path` is relative (it already resolves against the real workspace cwd), or
 * when an absolute `path` is not under the view root. In-process filesystem
 * Consumers call this on a model path before resolving it; enforcement itself
 * always keys on the real `workspaceRoot`.
 * @param path - the path as the model supplied it.
 * @param policy - the resolved per-call policy, or `undefined` for an unconfined backend.
 * @returns the real path to resolve, or `path` unchanged.
 */
export function fromWorkspaceView(path: string, policy: SandboxExecutionPolicy | undefined): string {
  if (policy?.workspaceViewRoot === undefined || !isAbsolute(path)) return path
  const rel = relative(policy.workspaceViewRoot, resolve(path))
  if (rel === '') return policy.workspaceRoot
  return escapesBase(rel) ? path : resolve(policy.workspaceRoot, rel)
}

/**
 * Translate a real resolved path under {@link SandboxExecutionPolicy.workspaceRoot}
 * back to {@link SandboxExecutionPolicy.workspaceViewRoot}, for a path a Consumer
 * echoes to the model (a read envelope, an edit confirmation, a directory
 * listing, a path in a denial message). Identity when the policy carries no
 * `workspaceViewRoot` or when `path` is outside the real workspace root.
 * @param path - a real resolved path, typically an `FsTarget.displayPath`.
 * @param policy - the resolved per-call policy, or `undefined` for an unconfined backend.
 * @returns the model-facing path, or `path` unchanged.
 */
export function toWorkspaceView(path: string, policy: SandboxExecutionPolicy | undefined): string {
  if (policy?.workspaceViewRoot === undefined) return path
  const rel = relative(policy.workspaceRoot, path)
  if (rel === '') return policy.workspaceViewRoot
  return escapesBase(rel) ? path : resolve(policy.workspaceViewRoot, rel)
}
