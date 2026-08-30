import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SubprocessRuntime from '@deepseek-ai/dsh-subprocess'
import type {
  SubprocessHandle,
  SubprocessOutcome,
  SubprocessOutputReader,
  SubprocessSpawnSpec,
  SubprocessTerminalHandle,
  SubprocessTerminalSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import ReportService from '@deepseek-ai/dsh-writing'
import LatexCompileService from '@deepseek-ai/dsh-writing-compile'
import * as tool from '../src/index.ts'
import { createGitState, runGit, type GitState } from '../../writing-compile/tests/git-emulator.ts'

export interface TestHarness {
  readonly ctx: Context
  readonly subprocess: FakeSubprocessRuntime
  readonly root: string
  dispose(): Promise<void>
}

export class FakeSubprocessRuntime extends SubprocessRuntime {
  spawned: SubprocessSpawnSpec[] = []
  outcomes: SubprocessOutcome[] = []
  onSpawn: ((spec: SubprocessSpawnSpec) => void | Promise<void>) | undefined
  private readonly gitState: GitState = createGitState()

  resolveExecutable(command: string): Promise<string> {
    return Promise.resolve(command === 'pdflatex' ? 'C:\\TeX\\pdflatex.exe' : command)
  }

  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    this.spawned.push(spec)
    const stdout = spec.argv[0] === 'git' ? runGit(this.gitState, spec.cwd, spec.argv.slice(1)) : ''
    const outcome = spec.argv[0] === 'git' ? { exitCode: 0, signal: null } : (this.outcomes.shift() ?? { exitCode: 0, signal: null })
    const onSpawn = this.onSpawn
    const done = (async () => {
      if (onSpawn !== undefined) await onSpawn(spec)
      return outcome
    })()
    return {
      pid: 1,
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      collected: { stdout: reader(stdout), stderr: reader('') },
      done,
      terminate() {},
      waitForExit: () => Promise.resolve(true),
    }
  }

  spawnTerminal(_spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    throw new Error('terminal subprocess is not used by the tool tests')
  }
}

function reader(text: string): SubprocessOutputReader {
  return { readFrom: () => ({ text, nextOffset: 0, lossy: false }) }
}

export function outputRun(partial: Partial<SubprocessOutcome>): SubprocessOutcome {
  return { exitCode: 0, signal: null, ...partial }
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
    await ctx.plugin(FakeSubprocessRuntime)
    const subprocess = ctx.subprocess as unknown as FakeSubprocessRuntime
    if (options.onRun !== undefined) {
      subprocess.onSpawn = spec => options.onRun!(spec.cwd)
    }
    await ctx.plugin(ReportService)
    await ctx.plugin(LatexCompileService, {
      command: 'pdflatex -interaction=nonstopmode -halt-on-error',
      timeoutMs: 1000,
      artifactRoot: join(root, 'artifacts'),
      authorName: 'test',
      authorEmail: 'test@deepseek.ai',
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
    subprocess: ctx.subprocess as unknown as FakeSubprocessRuntime,
    root,
    async dispose() {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    },
  }
}
