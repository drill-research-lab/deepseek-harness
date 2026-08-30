import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { AuthService, authenticatedUserId } from '@deepseek-ai/dsh-auth'
import type { AuthenticatedUser } from '@deepseek-ai/dsh-auth'
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
import ReportService from '@deepseek-ai/dsh-writing'
import LatexCompileService from '@deepseek-ai/dsh-writing-compile'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import WritingGateway from '../src/index.ts'
import { createGitState, runGit, type GitState } from '../../writing-compile/tests/git-emulator.ts'

export interface TestHarness {
  readonly ctx: Context
  readonly root: string
  dispose(): Promise<void>
}

class FakeAuth extends AuthService {
  private readonly user: AuthenticatedUser | undefined
  constructor(ctx: Context, config: { readonly user?: AuthenticatedUser }) {
    super(ctx)
    this.user = config.user
  }
  authenticateRequest(): Promise<AuthenticatedUser | undefined> {
    return Promise.resolve(this.user)
  }
}

export function testUser(): AuthenticatedUser {
  return { userId: authenticatedUserId('test:user'), username: 'test' }
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
    if (spec.argv[0] === 'git') {
      const stdout = runGit(this.gitState, spec.cwd, spec.argv.slice(1))
      const onSpawn = this.onSpawn
      const done = (async () => {
        if (onSpawn !== undefined) await onSpawn(spec)
        return { exitCode: 0, signal: null }
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
    const outcome = this.outcomes.shift() ?? { exitCode: 0, signal: null }
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
      collected: { stdout: reader(''), stderr: reader('') },
      done,
      terminate() {},
      waitForExit: () => Promise.resolve(true),
    }
  }

  spawnTerminal(_spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    throw new Error('terminal subprocess is not used by the writing-api tests')
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
  if (options.pdf === true) await writeFile(join(workdir, 'main.pdf'), '%PDF-1.7 fixture', 'utf8')
}

/** Compose the report registry, compile service, writing gateway, and optional webserver. */
export async function setupHarness(
  options: {
    readonly onRun?: (workdir: string) => void | Promise<void>
    readonly withWebServer?: boolean
    readonly authUser?: AuthenticatedUser | null
  } = {},
): Promise<TestHarness> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-writing-api-test-'))
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
    if (options.authUser !== undefined) {
      await ctx.plugin(FakeAuth, options.authUser === null ? {} : { user: options.authUser })
    }
    await ctx.plugin(ReportService)
    await ctx.plugin(LatexCompileService, {
      command: 'pdflatex -interaction=nonstopmode -halt-on-error',
      timeoutMs: 1000,
      artifactRoot: join(root, 'artifacts'),
      authorName: 'test',
      authorEmail: 'test@deepseek.ai',
    })
    if (options.withWebServer === true) {
      await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    }
    await ctx.plugin(WritingGateway)
  } catch (error) {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
    throw error
  }
  return {
    ctx,
    root,
    async dispose() {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    },
  }
}
