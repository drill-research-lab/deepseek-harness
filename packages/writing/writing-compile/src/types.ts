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
  /** Report id, used only as an identity in the returned outcome. */
  readonly reportId: string
  /**
   * Absolute path of the report's source file to write and compile. The parent
   * directory is the report's git repository (one repo per report).
   */
  readonly sourcePath: string
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
  /** Directory holding the report's source, log, pdf, and git repository. */
  readonly artifactDir: string
  /** Captured compiler stdout. */
  readonly stdout: string
  /** Captured compiler stderr. */
  readonly stderr: string
}

/** One git-backed version snapshot of a report's compiled source. */
export interface GitVersion {
  /** Commit hash; the durable version id. */
  readonly versionId: string
  /** Commit subject, the human label. */
  readonly label: string
  /** Compile command recorded in the commit body, when present. */
  readonly command?: string
  /** ISO commit timestamp. */
  readonly createdAt: string
}
