/**
 * LaTeX compile service (`ctx.latexCompile`): write a report's source into a
 * per-report artifact directory, run a configurable engine through the
 * subprocess seam, parse the compiler log into diagnostics, and report the
 * produced PDF.
 * @module @deepseek-ai/dsh-writing-compile
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { CompileDiagnostic, CompileOutput, CompileRequest } from './types.ts'

export type { CompileDiagnostic, CompileOutput, CompileRequest } from './types.ts'

/** Deployment-varying compiler behavior, all changeable from cordis.yml. */
export interface Config {
  /** Engine command line run in the artifact directory; `main.tex` is appended. */
  readonly command: string
  /** Foreground compiler timeout in milliseconds. */
  readonly timeoutMs: number
  /** Root directory holding one `main.tex`/`main.log`/`main.pdf` set per report. */
  readonly artifactRoot: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    latexCompile: LatexCompileService
  }
}

const DEFAULT_COMMAND = 'pdflatex -interaction=nonstopmode -halt-on-error'
const DEFAULT_TIMEOUT_MS = 120_000
const GRACE_MS = 3000

/** A report id is used as a directory segment, so only separators and traversal are rejected. */
function assertSafeSegment(reportId: string): string {
  if (reportId.length === 0 || /[\\/]|\.\.|[\0]/.test(reportId)) {
    throw new Error(`latex-compile: report id '${reportId}' is not a safe path segment`)
  }
  return reportId
}

/**
 * Compiles one report's LaTeX source. The engine is configuration; the
 * subprocess seam owns process launch. The service writes `main.tex`, runs the
 * engine, parses `main.log`, and leaves the artifact directory for later serving.
 */
export class LatexCompileService extends Service {
  static inject = ['subprocess']

  static Config: s<Config> = s.object({
    command: s.string().default(DEFAULT_COMMAND),
    timeoutMs: s.number().step(1).min(1).default(DEFAULT_TIMEOUT_MS),
    artifactRoot: s.string().default(join(tmpdir(), 'dsh-writing')),
  })

  /**
   * @param ctx - Host context carrying the subprocess seam.
   * @param config - Validated engine command, timeout, and artifact root.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'latexCompile')
    this.artifactRoot = resolve(config.artifactRoot)
    const [engine, ...args] = config.command.split(' ').filter(Boolean)
    this.engine = engine ?? 'pdflatex'
    this.args = args
  }

  private readonly engine: string
  private readonly args: readonly string[]
  private readonly artifactRoot: string

  /**
   * Compile a report's source and return diagnostics plus the produced PDF.
   * @param request - Report id, source, and optional cancellation.
   * @returns the compile outcome; a missing compiler surfaces as a run failure
   * (nonzero exit), it does not reject here.
   */
  async compile(request: CompileRequest): Promise<CompileOutput> {
    const segment = assertSafeSegment(request.reportId)
    const dir = join(this.artifactRoot, segment)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'main.tex'), request.source, 'utf8')

    const executable = await this.ctx.subprocess.resolveExecutable(this.engine, undefined, request.signal)
    const handle = this.ctx.subprocess.spawn({
      argv: [executable, ...this.args, 'main.tex'],
      cwd: dir,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: 4_000_000 },
        stderr: { maxBytes: 1_000_000 },
      },
      graceMs: GRACE_MS,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
    const outcome = await handle.done
    const stdout = handle.collected.stdout?.readFrom(0)?.text ?? ''
    const stderr = handle.collected.stderr?.readFrom(0)?.text ?? ''

    const log = await this.readLog(join(dir, 'main.log'))
    const diagnostics = parseLatexLog(log)
    const pdfPath = join(dir, 'main.pdf')
    const pdfExists = await this.exists(pdfPath)
    const hasErrors = diagnostics.some(diagnostic => diagnostic.severity === 'error')

    return {
      ok: outcome.exitCode === 0 && !hasErrors,
      diagnostics,
      ...(pdfExists ? { pdfPath } : {}),
      artifactDir: dir,
      stdout,
      stderr,
    }
  }

  /**
   * Resolve the artifact PDF path for a report, when one exists.
   * @param reportId - the report's safe id.
   * @returns the absolute PDF path, or `undefined` when it has not been compiled.
   */
  async pdfPath(reportId: string): Promise<string | undefined> {
    const path = join(this.artifactRoot, assertSafeSegment(reportId), 'main.pdf')
    return await this.exists(path) ? path : undefined
  }

  private async readLog(path: string): Promise<string> {
    try {
      return await readFile(path, 'utf8')
    } catch {
      return ''
    }
  }

  private async exists(path: string): Promise<boolean> {
    try {
      return (await stat(path)).isFile()
    } catch {
      return false
    }
  }
}

/** Mutable mirror of {@link CompileDiagnostic} used while associating source lines. */
type MutableDiagnostic = { severity: 'error' | 'warning'; line?: number; message: string }

/** Sort diagnostics so the fatal errors surface first, then warnings, by line. */
function sortDiagnostics(diagnostics: MutableDiagnostic[]): CompileDiagnostic[] {
  diagnostics.sort((left, right) => {
    if (left.severity !== right.severity) return left.severity === 'error' ? -1 : 1
    return (left.line ?? Number.MAX_SAFE_INTEGER) - (right.line ?? Number.MAX_SAFE_INTEGER)
  })
  return diagnostics
}

/**
 * Parse a pdflatex `.log` into diagnostics. The classic log interleaves an
 * error line `! message` followed by a `l.<line>` source-position line (with
 * "See the ..." context lines in between), so the parser remembers the most
 * recent error and attaches the next source-position line to it.
 */
export function parseLatexLog(log: string): CompileDiagnostic[] {
  const diagnostics: MutableDiagnostic[] = []
  let lastError: MutableDiagnostic | undefined
  for (const rawLine of log.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    const position = /^l\.(\d+)\s+/.exec(line)
    if (position !== null && position[1] !== undefined) {
      if (lastError !== undefined && lastError.line === undefined) {
        lastError.line = Number(position[1])
      }
      lastError = undefined
      continue
    }
    if (line.startsWith('!')) {
      lastError = { severity: 'error', message: line.replace(/^!\s*/, '').trim() }
      diagnostics.push(lastError)
      continue
    }
    const warning = /^(LaTeX Warning:.*|Package \S+ Warning:.*|Overfull \\hbox.*|Underfull \\hbox.*)$/.exec(line)
    if (warning !== null) {
      diagnostics.push({ severity: 'warning', message: line.trim() })
      lastError = undefined
      continue
    }
  }
  return sortDiagnostics(diagnostics)
}

export default LatexCompileService
