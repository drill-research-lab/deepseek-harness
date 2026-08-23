/**
 * Writer subagent backend (`writer`): registers a {@link SubagentProvider} on
 * `ctx.subagents` that starts each delegation as a fresh in-process child Agent
 * with a writing persona, so a general agent can produce a compiled LaTeX PDF
 * end-to-end by invoking `writer` as a subagent.
 * @module @deepseek-ai/dsh-agent-writer
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

export const name = 'agent-writer'

export const inject = ['subagents']

/** The writing behavior is an explicit, changeable persona so deployments can refine it. */
export interface Config {
  /** Provider name on `ctx.subagents` (default `writer`). */
  readonly providerName: string
  /** Persona given to every writer child. */
  readonly persona: string
}

const DEFAULT_PERSONA =
  'You are the Writing agent. Produce a completed LaTeX report from the user request and deliver '
  + 'a PDF that compiles successfully. Start a report with `report_create`, write its source with '
  + '`report_write`, and call `report_compile` after each write. Fix every reported error and '
  + 'warning and recompile until `report_compile` reports success; the tool auto-snapshots a '
  + 'version on success. When the report compiles, reply with the report id and state that it '
  + 'compiled into a PDF.'

/** Schemastery configuration for the writer subagent backend. */
export const Config: z<Config> = z.object({
  providerName: z.string().default('writer'),
  persona: z.string().default(DEFAULT_PERSONA),
})

/**
 * The writer provider. A fresh child has zero parent context, but supports
 * `depthLimit`, `outputSchema`, `toolFilter`, and `persona` like the spawn
 * backend, with the writing persona forced in.
 */
class WriterProvider implements SubagentProvider {
  readonly capabilities: SubagentCapabilities = { outputSchema: true, depthLimit: true, toolFilter: true, persona: true }
  readonly inheritsParentContext = false

  /**
   * @param name - provider registry name.
   * @param persona - the writing persona applied to every child.
   */
  constructor(
    readonly name: string,
    private readonly persona: string,
  ) {}

  start(request: ResolvedSubagentStartRequest) {
    // Force the writing persona (a caller persona is appended after it), then
    // delegate the fresh-child mechanics to the shared in-process driver.
    const persona = request.persona === undefined ? this.persona : `${this.persona}\n\n${request.persona}`
    return startInProcessRun({ ...request, persona }, {})
  }
}

/**
 * Register the writer provider.
 * @param ctx - registrant context carrying the subagent runtime.
 * @param config - provider name and writing persona.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.subagents.registerProvider(new WriterProvider(config.providerName, config.persona))
}
