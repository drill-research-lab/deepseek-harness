/**
 * Function plugin: FIFO + concurrency admission control for internal-vLLM
 * model requests, wrapped around the `llm/stream` waterfall. Only providers on
 * the `gatedProviders` allowlist are queued; everything else (all external
 * pay-per-use APIs) passes straight through. Admin priority and the audit
 * write are exposed on `ctx.llmAdmissionQueue` for a later RPC layer.
 *
 * @module @deepseek-ai/dsh-llm-admission-queue
 */

import { mkdir, appendFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { AdmissionQueue } from './queue.ts'
import type { QueueAuditLine, LlmAdmissionQueueService } from './types.ts'

export type { QueueId } from './brand.ts'
export type { Admission, AuditSink, EnqueueMeta } from './queue.ts'
export type * from './types.ts'

export const name = 'llm-admission-queue'
export const inject = ['llm']

/**
 * Default concurrency ceiling. `1` matches the common deployment — one vLLM
 * backend serving one request at a time — so the wait is visible as a position
 * instead of an opaque hang inside vLLM. Raise it from `settings.yaml` for a
 * backend that genuinely serves more in parallel.
 */
export const DEFAULT_LIMIT = 1

/** Never-aborting signal for hand-built calls that omit `GenerateOptions.signal`. */
const NEVER_ABORTED = new AbortController().signal

/** Settings namespace hot-reloaded from `$DSH_HOME/settings.yaml`. */
export const LLM_ADMISSION_QUEUE_SETTINGS_NAMESPACE = settingsNamespace('llm-admission-queue')

/** Live-tunable admission settings. */
export interface AdmissionSettings {
  /** Concurrency ceiling for gated providers; `0` disables the ceiling. */
  limit: number
  /** Provider ids whose calls are queued; everything else passes through untouched. */
  gatedProviders: string[]
}

/** Plugin configuration. */
export interface Config {
  /**
   * Maximum concurrent gated requests. `0` admits every gated call immediately
   * (counted but never blocked). Omission defaults to {@link DEFAULT_LIMIT}.
   */
  limit: number
  /**
   * Allowlist of provider ids to queue — the internal vLLM route(s). Any
   * provider not listed here (including every external pay-per-use API and any
   * provider added later) bypasses the queue entirely. Omission gates nothing.
   */
  gatedProviders: string[]
}

const SETTINGS_SCHEMA: z<AdmissionSettings> = z.object({
  limit: z.number().step(1).min(0).default(DEFAULT_LIMIT),
  gatedProviders: z.array(z.string()).default([]),
})

/** Runtime schema for {@link Config}. */
export const Config: z<Config> = z.object({
  limit: z.number().step(1).min(0).default(DEFAULT_LIMIT),
  gatedProviders: z.array(z.string()).default([]),
})

function assertLimit(value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`llm-admission-queue: limit must be a non-negative integer, got ${String(value)}`)
  }
}

/**
 * Install the admission gate.
 * @param ctx - plugin context that owns the listener, service, and drain effect.
 * @param config - resolved configuration (schema defaults applied).
 */
export function apply(ctx: Context, config: Config): void {
  assertLimit(config.limit)

  // The audit log lives beside the harness home and is append-only. The sink
  // is fire-and-forget: a write failure is logged, never propagated into the
  // (unrelated) caller of audit().
  const auditPath = dshHomePath('audit', 'queue-admin.jsonl')
  const writeAudit = (line: QueueAuditLine): void => {
    void (async (): Promise<void> => {
      await mkdir(dirname(auditPath), { recursive: true, mode: 0o700 })
      await withFileLock(auditPath, () => appendFile(auditPath, `${JSON.stringify(line)}\n`, { mode: 0o600 }))
    })().catch((error: unknown) => {
      ctx.logger.warn('llm-admission-queue: failed to append the queue-admin audit line')
      ctx.logger.warn(error)
    })
  }

  const queue = new AdmissionQueue(config.limit, writeAudit)
  let gatedProviders = new Set(config.gatedProviders)

  const entry: AdmissionSettings = { limit: config.limit, gatedProviders: [...config.gatedProviders] }
  let source: () => AdmissionSettings = () => entry
  installSettingsSection(ctx, LLM_ADMISSION_QUEUE_SETTINGS_NAMESPACE, SETTINGS_SCHEMA, entry, {
    // The schema admits any non-negative integer; keep the running queue on
    // its last good ceiling rather than failing a resolved section.
    validate: (value) => { assertLimit(value.limit) },
    setSource: (current) => { source = current },
    onChange: () => {
      const next = source()
      queue.setLimit(next.limit)
      gatedProviders = new Set(next.gatedProviders)
    },
  })

  ctx.on('llm/stream', (options: GenerateOptions, next: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk> => {
    // Allowlist: only the internal vLLM route(s) are queued. External APIs and
    // any unlisted provider pass straight through — no enqueue, no wait, no
    // slot, no position.
    if (!gatedProviders.has(options.provider)) return next()

    const { queueId, admitted } = queue.enqueue({
      ...options.sessionId === undefined ? {} : { sessionId: options.sessionId },
      signal: options.signal ?? NEVER_ABORTED,
    })
    return (async function* admissionGated(): AsyncIterable<StreamChunk> {
      try {
        await admitted
        yield* next()
      } finally {
        queue.release(queueId)
      }
    })()
  })

  const service: LlmAdmissionQueueService = {
    positionFor: sessionId => queue.positionFor(sessionId),
    reorder: (orderedQueueIds) => { queue.reorder(orderedQueueIds) },
    listAll: () => queue.listAll(),
    onChange: cb => queue.onChange(cb),
    audit: (record) => { queue.audit(record) },
  }
  ctx.provide('llmAdmissionQueue', service)

  ctx.effect(() => () => { queue.drain('llm-admission-queue plugin disposed') }, 'llm-admission-queue.drain()')
}
