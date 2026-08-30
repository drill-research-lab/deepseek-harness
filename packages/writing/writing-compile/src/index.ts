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
import type { CompileDiagnostic, CompileOutput, CompileRequest, GitVersion } from './types.ts'

export type { CompileDiagnostic, CompileOutput, CompileRequest, GitVersion } from './types.ts'

/** Deployment-varying compiler behavior, all changeable from cordis.yml. */
export interface Config {
  /** Engine command line run in the artifact directory; `main.tex` is appended. */
  readonly command: string
  /** Foreground compiler timeout in milliseconds. */
  readonly timeoutMs: number
  /** Root directory holding one `main.tex`/`main.log`/`main.pdf` set per report. */
  readonly artifactRoot: string
  /** Git author name recorded on every version commit. */
  readonly authorName: string
  /** Git author email recorded on every version commit. */
  readonly authorEmail: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    latexCompile: LatexCompileService
  }
}

const DEFAULT_COMMAND = 'pdflatex -interaction=nonstopmode -halt-on-error'
const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_AUTHOR_NAME = 'dsh-writing'
const DEFAULT_AUTHOR_EMAIL = 'dsh-writing@deepseek.ai'
const GRACE_MS = 3000
const COMMAND_MARKER = 'command: '

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
    authorName: s.string().default(DEFAULT_AUTHOR_NAME),
    authorEmail: s.string().default(DEFAULT_AUTHOR_EMAIL),
  })

  /**
   * @param ctx - Host context carrying the subprocess seam.
   * @param config - Validated engine command, timeout, artifact root, and git author.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'latexCompile')
    this.artifactRoot = resolve(config.artifactRoot)
    const [engine, ...args] = config.command.split(' ').filter(Boolean)
    this.engine = engine ?? 'pdflatex'
    this.args = args
    this.command = config.command
    this.authorName = config.authorName
    this.authorEmail = config.authorEmail
  }

  private readonly engine: string
  private readonly args: readonly string[]
  private readonly artifactRoot: string
  private readonly command: string
  private readonly authorName: string
  private readonly authorEmail: string

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

  /**
   * Record one version snapshot of a report's compiled source as a git commit.
   * The artifact directory is initialised as a repository on first use, and the
   * commit message carries the configured compile command in its body.
   * @param reportId - the report's safe id.
   * @param label - human-readable commit subject.
   * @returns the commit hash that identifies the version.
   */
  async commitVersion(reportId: string, label: string): Promise<string> {
    const dir = this.requireDir(reportId)
    await this.ensureVersionStore(dir)
    await this.git(dir, ['add', 'main.tex'])
    await this.gitWithAuthor(dir, ['commit', '-m', label, '-m', `${COMMAND_MARKER}${this.command}`])
    const result = await this.git(dir, ['rev-parse', 'HEAD'])
    return result.trim()
  }

  /**
   * List a report's version snapshots, newest first, from the git history.
   * @param reportId - the report's safe id.
   * @returns ordered git-backed versions; empty when never compiled.
   */
  async listVersions(reportId: string): Promise<GitVersion[]> {
    const dir = this.requireDir(reportId)
    if (!(await this.isDirectory(join(dir, '.git')))) return []
    const result = await this.git(dir, ['log', '-z', '--format=%H%x1f%ct%x1f%B'])
    return result.split('\0').filter(Boolean).map(raw => {
      const [versionId, epoch, body] = raw.split('\x1f') as [string, string, string]
      const [label, ...rest] = body.split('\n')
      const commandLine = rest.find(line => line.startsWith(COMMAND_MARKER))
      return {
        versionId,
        label: (label ?? '').trim(),
        ...(commandLine === undefined ? {} : { command: commandLine.slice(COMMAND_MARKER.length).trim() }),
        createdAt: new Date(Number(epoch) * 1000).toISOString(),
      }
    })
  }

  /**
   * Branch from an earlier version, keep the original branch, and switch the
   * working source to that version's content.
   * @param reportId - the report's safe id.
   * @param versionId - the commit hash to branch from.
   * @param branchName - new branch name; must not already exist.
   * @returns the version's source (`main.tex`) now checked out on the branch.
   */
  async restoreVersion(reportId: string, versionId: string, branchName: string): Promise<string> {
    const dir = this.requireDir(reportId)
    if (!(await this.isDirectory(join(dir, '.git')))) {
      throw new Error(`latex-compile: report '${reportId}' has no version history`)
    }
    const existing = await this.git(dir, ['branch', '--list', branchName])
    if (existing.trim().length > 0) {
      throw new Error(`latex-compile: branch '${branchName}' already exists`)
    }
    await this.git(dir, ['branch', branchName, versionId])
    await this.git(dir, ['checkout', '-q', branchName])
    return await this.readSourceIn(dir)
  }

  /**
   * Read a report's current working source.
   * @param reportId - the report's safe id.
   * @returns the `main.tex` contents, or an empty string when absent.
   */
  async readSource(reportId: string): Promise<string> {
    return await this.readSourceIn(this.requireDir(reportId))
  }

  private async readSourceIn(dir: string): Promise<string> {
    try {
      return await readFile(join(dir, 'main.tex'), 'utf8')
    } catch {
      return ''
    }
  }

  private requireDir(reportId: string): string {
    return join(this.artifactRoot, assertSafeSegment(reportId))
  }

  private async ensureVersionStore(dir: string): Promise<void> {
    if (await this.isDirectory(join(dir, '.git'))) return
    await this.git(dir, ['init', '-q'])
    await writeFile(
      join(dir, '.gitignore'),
      '*.aux\n*.bbl\n*.blg\n*.fdb_latexmk\n*.fls\n*.log\n*.out\n*.pdf\n*.synctex.gz\n*.toc\n',
      'utf8',
    )
  }

  private async isDirectory(path: string): Promise<boolean> {
    try {
      return (await stat(path)).isDirectory()
    } catch {
      return false
    }
  }

  private async git(dir: string, args: readonly string[]): Promise<string> {
    const executable = await this.ctx.subprocess.resolveExecutable('git')
    const handle = this.ctx.subprocess.spawn({
      argv: [executable, ...args],
      cwd: dir,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: 4_000_000 },
        stderr: { maxBytes: 1_000_000 },
      },
      graceMs: GRACE_MS,
    })
    const outcome = await handle.done
    if (outcome.exitCode !== 0) {
      const stderr = handle.collected.stderr?.readFrom(0)?.text ?? ''
      throw new Error(`latex-compile: git ${args[0]} failed: ${stderr.trim() || `exit ${outcome.exitCode}`}`)
    }
    return handle.collected.stdout?.readFrom(0)?.text ?? ''
  }

  private async gitWithAuthor(dir: string, args: readonly string[]): Promise<void> {
    const argv = [
      `-c`, `user.name=${this.authorName}`,
      `-c`, `user.email=${this.authorEmail}`,
      ...args,
    ]
    await this.git(dir, argv)
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
