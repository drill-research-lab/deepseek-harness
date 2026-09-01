// Inline admission-queue position strip. Mounted through the
// 'conversation.input.dock' slot (QueueDock / TodoDock posture): it reads this
// session's live `llmQueue` value and renders "you are number N in line" only
// while the request is still waiting for an internal-vLLM slot. Once admitted
// (`state === 'running'`) or not queued (`null`) it renders nothing and the
// ordinary generating/streaming indicator takes over.
import type { Context } from '@deepseek-ai/cordis'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from '../locales.ts'
import css from './LlmQueueIndicator.module.css'

/** Full props of a dock entry: session standard kit + the locale seat. */
export type LlmQueueIndicatorProps = PropsRuntime<'conversation.input.dock'> & PropsLocale<'conversation'>

/**
 * Dock adapter: shows the 1-based admission-queue position while
 * `llmQueue.state === 'waiting'`; nothing otherwise.
 */
export function LlmQueueIndicator({ useSession, t }: LlmQueueIndicatorProps) {
  const place = useSession(s => s.llmQueue)
  if (place === null || place.state !== 'waiting') return null
  return (
    <div className={css.dock} data-llm-queue-indicator="">
      <div className={css.strip} role="status" aria-live="polite">
        <span className={css.dot} aria-hidden />
        <span className={css.text}>{t('admissionQueue.position', { n: place.position })}</span>
      </div>
    </div>
  )
}

/**
 * The position strip as a plain registrant plugin (QueueDock posture). Order 5:
 * above the queued-message rows (order 20) and the plan strip (order 0)… it
 * sits just under the plan strip so a waiting position reads before the queue.
 */
export const llmQueueIndicatorEntry = {
  name: 'conversation-llm-queue-indicator',
  inject: ['slots'],
  /**
   * Register the admission-queue position strip in the input dock (order 5).
   * @param ctx - registrant context (disposal rides ctx.effect inside slots.register).
   */
  apply(ctx: Context): void {
    ctx.slots.inject('conversation.input.dock', () =>
      ctx.slots.register(
        { name: 'conversation.input.dock', id: 'llm-queue', order: 5, locale: NS },
        LlmQueueIndicator,
      ))
  },
}
