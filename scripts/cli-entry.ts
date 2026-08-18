/** Shared invocation guard for synchronous repository CLI scripts. */

import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Run a synchronous script main function when its module is the CLI entry.
 *
 * @param main - Script entry function.
 * @param name - Prefix for an uncaught error diagnostic.
 * @param moduleUrl - Calling script's `import.meta.url`.
 */
export function runCliMain(main: (argv: string[]) => void, name: string, moduleUrl: string): void {
  const invokedPath = process.argv[1]
  const isMain = invokedPath !== undefined && moduleUrl === pathToFileURL(resolve(invokedPath)).href
  if (!isMain) return
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.error(`${name}: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
