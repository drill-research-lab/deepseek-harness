import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** In-memory git emulation for the writing tests' fake subprocess runtime. */

export const COMMAND_MARKER = 'command: '

export interface GitState {
  readonly commits: GitCommit[]
  readonly branches: GitBranch[]
  readonly added: Map<string, string>
}

export interface GitCommit {
  readonly dir: string
  readonly hash: string
  readonly label: string
  readonly command: string
  readonly source: string
  readonly epoch: number
}

export interface GitBranch {
  readonly dir: string
  readonly name: string
  readonly hash: string
}

export function createGitState(): GitState {
  return { commits: [], branches: [], added: new Map() }
}

/**
 * Emulate a git subprocess call: parse the command and update/query the state.
 * The commit body carries the compile command; the committed source is read from
 * `main.tex` on disk so a later checkout can restore it.
 * @param state - in-memory git repository state.
 * @param cwd - the report artifact directory (the repo root).
 * @param argv - arguments after the git executable, including the subcommand.
 * @returns simulated git stdout.
 */
export function runGit(state: GitState, cwd: string, argv: string[]): string {
  const cmdIndex = argv.findIndex(arg =>
    arg === 'commit' || arg === 'log' || arg === 'rev-parse' || arg === 'branch'
    || arg === 'checkout' || arg === 'init' || arg === 'add')
  const cmd = cmdIndex === -1 ? argv[0] : argv[cmdIndex]
  const rest = argv.slice(cmdIndex + 1)
  switch (cmd) {
    case 'init':
      mkdirSync(join(cwd, '.git'), { recursive: true })
      return ''
    case 'add': {
      const file = rest[0]
      if (file !== undefined) state.added.set(cwd, file)
      return ''
    }
    case 'commit': {
      const marker = rest.indexOf('-m')
      const label = rest[marker + 1] ?? ''
      const body = rest[marker + 3] ?? ''
      const command = body.startsWith(COMMAND_MARKER) ? body.slice(COMMAND_MARKER.length) : ''
      const sourceFile = state.added.get(cwd) ?? 'main.tex'
      state.commits.push({
        dir: cwd,
        hash: `g${state.commits.length + 1}`,
        label,
        command,
        source: readFileSync(join(cwd, sourceFile), 'utf8'),
        epoch: Math.floor(Date.now() / 1000),
      })
      return ''
    }
    case 'rev-parse': return [...state.commits].reverse().find(commit => commit.dir === cwd)?.hash ?? ''
    case 'log': {
      return state.commits
        .filter(commit => commit.dir === cwd)
        .map(commit => `${commit.hash}\x1f${commit.epoch}\x1f${commit.label}\n\n${COMMAND_MARKER}${commit.command}`)
        .join('\0')
    }
    case 'branch': {
      if (rest[0] === '--list') {
        return state.branches.some(branch => branch.dir === cwd && branch.name === rest[1]) ? (rest[1] ?? '') : ''
      }
      state.branches.push({ dir: cwd, name: rest[0] ?? '', hash: rest[1] ?? '' })
      return ''
    }
    case 'checkout': {
      const branchName = rest[rest.length - 1]
      const branch = state.branches.find(candidate => candidate.dir === cwd && candidate.name === branchName)
      const commit = branch === undefined ? undefined : state.commits.find(candidate => candidate.dir === cwd && candidate.hash === branch.hash)
      if (commit !== undefined) {
        const sourceFile = state.added.get(cwd) ?? 'main.tex'
        writeFileSync(join(cwd, sourceFile), commit.source, 'utf8')
      }
      return ''
    }
    default: return ''
  }
}
