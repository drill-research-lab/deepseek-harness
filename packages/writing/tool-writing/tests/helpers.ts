import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import ShellExecutor from '@deepseek-ai/dsh-shell'
import type {
  CollectedOutput,
  ShellExecRequest,
  ShellExecSpec,
  ShellProcess,
  ShellRunResult,
} from '@deepseek-ai/dsh-shell'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import ReportService from '@deepseek-ai/dsh-writing'
import LatexCompileService from '@deepseek-ai/dsh-writing-compile'
import * as tool from '../src/index.ts'

export interface TestHarness {
  readonly ctx: Context
  readonly shell: FakeShellExecutor
  readonly root: string
  dispose(): Promise<void>
}

export class FakeShellExecutor extends ShellExecutor {
  runResults: ShellRunResult[] = []
  onRun: ((workdir: string) => void | Promise<void>) | undefined

  resolve(request: ShellExecRequest): ShellExecSpec {
    const spec: ShellExecSpec = {
      command: request.command,
      workdir: request.workdir ?? '',
      timeoutMs: request.timeoutMs ?? 1,
      stdoutMaxBytes: request.stdoutMaxBytes ?? 1_000_000,
      sandboxPolicy: undefined,
    }
    if (request.signal !== undefined) spec.signal = request.signal
    return spec
  }

  async run(spec: ShellExecSpec): Promise<ShellRunResult> {
    if (this.onRun !== undefined) await this.onRun(spec.workdir)
    return this.runResults.shift() ?? defaultRun()
  }

  start(_spec: ShellExecSpec): ShellProcess {
    throw new Error('background compile is not used by the tool tests')
  }
}

function collect(text: string): CollectedOutput {
  return { text, truncated: false }
}

function defaultRun(): ShellRunResult {
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    aborted: false,
    timeoutMs: 1,
    stdout: collect(''),
    stderr: collect(''),
  }
}

export function outputRun(partial: Partial<ShellRunResult>): ShellRunResult {
  return { ...defaultRun(), ...partial }
}

/** Write a compiler log plus an optional PDF into the artifact workdir. */
export async function writeArtifacts(
  workdir: string,
  options: { readonly log: string; readonly pdf?: boolean },
): Promise<void> {
  await writeFile(join(workdir, 'main.log'), options.log, 'utf8')
  if (options.pdf === true) await writeFile(join(workdir, 'main.pdf'), '%PDF-1.7', 'utf8')
}

/** Compose the report registry, compile service, and writing tools over a real storage stack. */
export async function setupHarness(
  options: { readonly maxReadChars?: number; readonly onRun?: (workdir: string) => void | Promise<void> } = {},
): Promise<TestHarness> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-tool-writing-test-'))
  const ctx = new Context()
  try {
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root })
    await ctx.plugin(StorageDomain, { backend: 'json' })
    await ctx.plugin(FakeShellExecutor)
    const shell = ctx.shell as unknown as FakeShellExecutor
    if (options.onRun !== undefined) shell.onRun = options.onRun
    await ctx.plugin(ReportService)
    await ctx.plugin(LatexCompileService, {
      command: 'pdflatex -interaction=nonstopmode -halt-on-error',
      timeoutMs: 1000,
      artifactRoot: join(root, 'artifacts'),
    })
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(tool, { maxReadChars: options.maxReadChars ?? 20_000, maxDiagnostics: 50 })
  } catch (error) {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
    throw error
  }
  return {
    ctx,
    shell: ctx.shell as unknown as FakeShellExecutor,
    root,
    async dispose() {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    },
  }
}
