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
  SubprocessTerminalSpawnSpec,
  SubprocessTerminalHandle,
} from '@deepseek-ai/dsh-subprocess'
import LatexCompileService from '../src/index.ts'
import { createGitState, runGit, type GitState } from './git-emulator.ts'

export interface TestHarness {
  readonly ctx: Context
  readonly subprocess: FakeSubprocessRuntime
  readonly root: string
  dispose(): Promise<void>
}

class FakeSubprocessRuntime extends SubprocessRuntime {
  spawned: SubprocessSpawnSpec[] = []
  outcomes: SubprocessOutcome[] = []
  onSpawn: ((spec: SubprocessSpawnSpec) => void | Promise<void>) | undefined
  private readonly gitState: GitState = createGitState()

  resolveExecutable(command: string): Promise<string> {
    return Promise.resolve(command === 'pdflatex' ? 'C:\\TeX\\pdflatex.exe' : command)
  }

  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    this.spawned.push(spec)
    if (spec.argv[0] === 'git') {
      return makeHandle(spec, { exitCode: 0, signal: null }, this.onSpawn, runGit(this.gitState, spec.cwd, spec.argv.slice(1)))
    }
    const outcome = this.outcomes.shift() ?? { exitCode: 0, signal: null }
    return makeHandle(spec, outcome, this.onSpawn, '')
  }

  spawnTerminal(_spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    throw new Error('terminal subprocess is not used by the writing-compile tests')
  }
}

function reader(text: string): SubprocessOutputReader {
  return { readFrom: () => ({ text, nextOffset: 0, lossy: false }) }
}

function makeHandle(
  spec: SubprocessSpawnSpec,
  outcome: SubprocessOutcome,
  onSpawn: ((spec: SubprocessSpawnSpec) => void | Promise<void>) | undefined,
  stdout: string,
): SubprocessHandle {
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

function defaultOutcome(): SubprocessOutcome {
  return { exitCode: 0, signal: null }
}

export function outputRun(partial: Partial<SubprocessOutcome>): SubprocessOutcome {
  return { ...defaultOutcome(), ...partial }
}

/** Compose the compile service over a fake subprocess runtime. */
export async function setupHarness(
  options: { readonly onRun?: (workdir: string) => void | Promise<void> } = {},
): Promise<TestHarness> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-writing-compile-test-'))
  const ctx = new Context()
  const artifactRoot = join(root, 'artifacts')
  try {
    await ctx.plugin(FakeSubprocessRuntime)
    const subprocess = ctx.subprocess as unknown as FakeSubprocessRuntime
    if (options.onRun !== undefined) {
      subprocess.onSpawn = spec => options.onRun!(spec.cwd)
    }
    await ctx.plugin(LatexCompileService, {
      command: 'pdflatex -interaction=nonstopmode -halt-on-error',
      timeoutMs: 1000,
      artifactRoot,
      authorName: 'test',
      authorEmail: 'test@deepseek.ai',
    })
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

/** Write a compiler log plus an optional PDF into the artifact workdir. */
export async function writeArtifacts(
  workdir: string,
  options: { readonly log: string; readonly pdf?: boolean },
): Promise<void> {
  await writeFile(join(workdir, 'main.log'), options.log, 'utf8')
  if (options.pdf === true) await writeFile(join(workdir, 'main.pdf'), '%PDF-1.7', 'utf8')
}
