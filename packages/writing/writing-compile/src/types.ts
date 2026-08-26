/**
 * Public vocabulary of the LaTeX compile service: the request, the output, and
 * the parsed diagnostics. Types only.
 * @module @deepseek-ai/dsh-writing-compile/src/types
 */

/** One compiler message, either the fatal cause or a recoverable hint. */
export interface CompileDiagnostic {
  /** Severity: an error stops production of a usable PDF; a warning is advisory. */
  readonly severity: 'error' | 'warning'
  /** 1-based source line, when the compiler reported one. */
  readonly line?: number
  /** Human-readable message text. */
  readonly message: string
}

/** A compile request for one report's current source. */
export interface CompileRequest {
  /**
   * Report id, used for the artifact directory name. Only a safe segment
   * (no separators or traversal) is accepted.
   */
  readonly reportId: string
  /** LaTeX source to compile. */
  readonly source: string
  /** Cooperative cancellation passed to the compiler process. */
  readonly signal?: AbortSignal
}

/** The outcome of one compile: diagnostics plus the produced PDF location. */
export interface CompileOutput {
  /** True when no error-severity diagnostic was reported and the engine exited 0. */
  readonly ok: boolean
  /** Parsed compiler messages, errors first. */
  readonly diagnostics: readonly CompileDiagnostic[]
  /** Absolute path to the generated PDF, when it was produced. */
  readonly pdfPath?: string
  /** Directory holding the artifact set (main.tex, main.log, main.pdf). */
  readonly artifactDir: string
  /** Captured compiler stdout. */
  readonly stdout: string
  /** Captured compiler stderr. */
  readonly stderr: string
}
