import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-cordis-host-runner'

export const name = 'cordis-host-only-approval'

export const inject = ['agents', 'dynamicCordisRunner']

/** Approve host-only dynamic Packages in the advanced keyless snapshot composition. */
export function apply(ctx: Context): void {
  ctx.on('cordis/request-run', (request) => {
    if (request.hasClientHalf) return
    void (async (): Promise<void> => {
      const agent = ctx.agents.get(request.agentId)
      if (agent === undefined) throw new Error(`snapshot approval cannot find Agent ${request.agentId}`)
      const started = await ctx.dynamicCordisRunner.runHostHalf(
        agent,
        request.pluginId,
        request.packageId,
        request.mode,
        request.requestId,
        false,
      )
      if (!started.ok) {
        await ctx.dynamicCordisRunner.resolveRequestRun(request.requestId, {
          ok: false,
          reason: 'host-half-failed',
          message: started.message,
        })
      }
    })().catch((error: unknown) => {
      console.error('[cordis-host-only-approval] approval failed:', error)
      process.exitCode = 1
    })
  })
}
