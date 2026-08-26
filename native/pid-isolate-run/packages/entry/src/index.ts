/**
 * JavaScript seam for the prebuilt `pid-isolate-run` launcher. It resolves
 * the host platform binary and performs the launcher's functional probe.
 * Runtime binary selection has no environment override; tests inject a path
 * through function parameters.
 * @module @deepseek-ai/node-addon-pid-isolate-run
 */

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The launcher binary name inside each platform package. */
export const LAUNCHER_BIN = 'pid-isolate-run'

/** Exit status reserved for launcher failures before a successful exec. */
export const LAUNCHER_FAILURE_EXIT = 125

/**
 * Resolve the prebuilt launcher for the current platform and architecture.
 * An unavailable package produces an absolute nonexistent fallback path so
 * the functional probe remains the sole availability signal.
 * @param resolvePackageJson - injectable package resolver for tests.
 * @returns the absolute launcher path.
 */
export function launcherPath(
  resolvePackageJson: (specifier: string) => string = createRequire(import.meta.url).resolve,
): string {
  const platformPackage = `@deepseek-ai/node-addon-pid-isolate-run-${process.platform}-${process.arch}`
  try {
    return join(dirname(resolvePackageJson(`${platformPackage}/package.json`)), 'bin', LAUNCHER_BIN)
  } catch {
    return fileURLToPath(new URL(`../node_modules/${platformPackage}/bin/${LAUNCHER_BIN}`, import.meta.url))
  }
}

/**
 * Run the real namespace-and-capability probe. A missing binary, timeout,
 * namespace refusal, mount refusal, capability-drop failure, or unexpected
 * report all return false.
 * @param launcher - launcher path; defaults to this host's resolved binary.
 * @param options - positive timeout bound in milliseconds.
 * @returns whether the launcher completed its full security setup.
 */
export function probe(
  launcher: string = launcherPath(),
  options: { timeoutMs?: number } = {},
): boolean {
  const result = spawnSync(launcher, ['--probe'], {
    timeout: options.timeoutMs ?? 2_000,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  return result.status === 0 && result.stdout === 'pid-isolate: ok\n'
}
