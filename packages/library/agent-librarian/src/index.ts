/**
 * Librarian subagent backend (`librarian`): registers a {@link SubagentProvider}
 * on `ctx.subagents` that starts each delegation as a fresh in-process child
 * Agent with a librarian persona, so a general agent can delegate knowledge-base
 * work — filing documents, then answering from them with citations — by
 * invoking `librarian` as a subagent.
 * @module @deepseek-ai/dsh-agent-librarian
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {
  ResolvedSubagentStartRequest,
  SubagentCapabilities,
  SubagentProvider,
} from '@deepseek-ai/dsh-subagent'
import { startInProcessRun } from '@deepseek-ai/dsh-subagent-in-process-driver'

export type {} from '@deepseek-ai/dsh-subagent'
export type {} from '@deepseek-ai/dsh-subagent-in-process-driver'

export const name = 'agent-librarian'

export const inject = ['subagents']

/** The librarian behavior is an explicit, changeable persona so deployments can refine it. */
export interface Config {
  /** Provider name on `ctx.subagents` (default `librarian`). */
  readonly providerName: string
  /** Persona given to every librarian child. */
  readonly persona: string
}

const DEFAULT_PERSONA =
  'You are the Librarian agent for the research knowledge base (the Library). Use the '
  + '`library_*` tools for every knowledge-base task: discover what exists with '
  + '`library_structure`, answer questions with `library_ask` (prefer one good question over '
  + 'reading files one by one), read exact wording with `library_read`, and file new material '
  + 'with `library_ingest`. Always ground statements in the stored documents and keep the '
  + 'inline [source] citations in your reply; when the library holds nothing relevant, say so '
  + 'plainly instead of guessing.'

/** Schemastery configuration for the librarian subagent backend. */
export const Config: z<Config> = z.object({
  providerName: z.string().default('librarian'),
  persona: z.string().default(DEFAULT_PERSONA),
})

/**
 * The librarian provider. A fresh child has zero parent context, but supports
 * `depthLimit`, `outputSchema`, `toolFilter`, and `persona` like the spawn
 * backend, with the librarian persona forced in.
 */
class LibrarianProvider implements SubagentProvider {
  readonly capabilities: SubagentCapabilities = { outputSchema: true, depthLimit: true, toolFilter: true, persona: true }
  readonly inheritsParentContext = false

  /**
   * @param name - provider registry name.
   * @param persona - the librarian persona applied to every child.
   */
  constructor(
    readonly name: string,
    private readonly persona: string,
  ) {}

  start(request: ResolvedSubagentStartRequest) {
    // Force the librarian persona (a caller persona is appended after it), then
    // delegate the fresh-child mechanics to the shared in-process driver.
    const persona = request.persona === undefined ? this.persona : `${this.persona}\n\n${request.persona}`
    return startInProcessRun({ ...request, persona }, {})
  }
}

/**
 * Register the librarian provider.
 * @param ctx - registrant context carrying the subagent runtime.
 * @param config - provider name and librarian persona.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.subagents.registerProvider(new LibrarianProvider(config.providerName, config.persona))
}
