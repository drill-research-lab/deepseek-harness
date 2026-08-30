import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ConvertInput, LibraryConverter } from './types.ts'

const execFileAsync = promisify(execFile)

const MARKITDOWN_EXTENSIONS = new Set([
  'pdf', 'docx', 'pptx', 'xlsx', 'doc', 'ppt', 'xls', 'epub', 'html', 'htm', 'csv', 'json', 'zip', 'msg', 'wav', 'mp3',
])

/** Deployment options for the markitdown subprocess converter. */
export interface MarkitdownOptions {
  /** Python executable used to run `python -m markitdown`. */
  python: string
  /** Whole-conversion timeout in milliseconds. */
  timeoutMs: number
}

/**
 * Converter backed by Microsoft markitdown run as a Python subprocess
 * (`python -m markitdown <file>`), covering Office, PDF, EPUB, and HTML.
 * Availability is environmental: when the interpreter or module is missing the
 * conversion rejects and lower-priority converters (or the resource's `error`
 * state) take over.
 * @param options - Interpreter and timeout choices from plugin config.
 * @returns the converter for {@link LibraryConverter} registration.
 */
export function markitdownConverter(options: MarkitdownOptions): LibraryConverter {
  return {
    id: 'markitdown',
    priority: 10,
    accepts(input: ConvertInput): boolean {
      const dot = input.name.lastIndexOf('.')
      if (dot < 0) return false
      return MARKITDOWN_EXTENSIONS.has(input.name.slice(dot + 1).toLowerCase())
    },
    async convert(input: ConvertInput): Promise<string> {
      const { stdout } = await execFileAsync(
        options.python,
        ['-X', 'utf8', '-m', 'markitdown', input.path],
        { timeout: options.timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true, encoding: 'utf8' },
      )
      const markdown = stdout.trim()
      if (!markdown) throw new Error('markitdown produced empty output')
      return markdown
    },
  }
}
