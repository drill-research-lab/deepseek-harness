/** Polling controller for the authenticated inference metrics RPC. */

import type { IApiClient, InferenceMetricsView, RpcErrorCode } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** Browser-derived live rates and short history layered onto one Host sample. */
export interface InferenceDashboardMetrics extends InferenceMetricsView {
  /** Generated tokens per second between the two latest valid samples. */
  generationTokensPerSecond: number
  /** Prompt-prefill tokens per second between the two latest valid samples. */
  prefillTokensPerSecond: number
  /** Last 30 generation-rate samples for the inline trend. */
  generationHistory: number[]
  /** Last 30 prefill-rate samples for the inline trend. */
  prefillHistory: number[]
}

/** Dashboard render state. */
export type InferenceDashboardState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; metrics: InferenceDashboardMetrics }
  | { status: 'error'; code: RpcErrorCode | 'transport'; message: string }

/** Browser-local lifecycle for one settings dashboard instance. */
export class InferenceDashboardController {
  /** Snapshot consumed by the settings section. */
  readonly store: SnapshotStore<InferenceDashboardState> = createSnapshotStore({ status: 'idle' })

  private active = false
  private generation = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private previous: InferenceMetricsView | undefined
  private generationHistory: number[] = []
  private prefillHistory: number[] = []

  /** @param api - authenticated LLM wire face. */
  constructor(private readonly api: Pick<IApiClient, 'llm'>) {}

  /** Start polling, loading immediately on the first active mount. */
  start(): void {
    if (this.active) return
    this.active = true
    void this.load()
  }

  /** Stop polling and invalidate an outstanding response. */
  stop(): void {
    this.active = false
    this.generation += 1
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  /** Retry after a visible failure. */
  retry(): void {
    if (this.active) void this.load()
  }

  /** Refresh the sample once and schedule the next successful scrape. */
  async load(): Promise<void> {
    const generation = ++this.generation
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    if (this.store.getSnapshot().status !== 'ready') this.store.set({ status: 'loading' })
    try {
      const response = await this.api.llm.metrics({})
      if (generation !== this.generation || !this.active) return
      if (!response.result.ok) {
        this.store.set({
          status: 'error',
          code: response.result.error.code,
          message: response.result.error.message,
        })
        return
      }
      const metrics = this.withLiveRates(response.result.value)
      this.store.set({ status: 'ready', metrics })
      this.timer = setTimeout(() => { void this.load() }, metrics.refreshAfterMs)
    } catch (error: unknown) {
      if (generation !== this.generation || !this.active) return
      this.store.set({
        status: 'error',
        code: 'transport',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /** Refresh only while the settings section owns the polling lifecycle. */
  refreshIfActive(): void {
    if (this.active) void this.load()
  }

  /** Derive SparkDash-compatible live rates without sharing baselines across users. */
  private withLiveRates(current: InferenceMetricsView): InferenceDashboardMetrics {
    let generationTokensPerSecond = 0
    let prefillTokensPerSecond = 0
    const previous = this.previous
    const elapsedSeconds = previous === undefined ? 0 : (current.sampledAt - previous.sampledAt) / 1000
    if (previous !== undefined && elapsedSeconds > 0 && elapsedSeconds < 10) {
      const deltaOutput = current.generationTokensTotal !== undefined
        && previous.generationTokensTotal !== undefined
        ? current.generationTokensTotal - previous.generationTokensTotal
        : 0
      generationTokensPerSecond = Math.max(0, Math.round((deltaOutput / elapsedSeconds) * 100) / 100)

      const deltaInput = current.promptTokensTotal !== undefined && previous.promptTokensTotal !== undefined
        ? current.promptTokensTotal - previous.promptTokensTotal
        : 0
      const deltaIteration = current.iterationTokensTotal !== undefined
        && previous.iterationTokensTotal !== undefined
        ? current.iterationTokensTotal - previous.iterationTokensTotal
        : 0
      const deltaTtft = current.ttftSecondsTotal !== undefined && previous.ttftSecondsTotal !== undefined
        ? current.ttftSecondsTotal - previous.ttftSecondsTotal
        : 0
      const iterationPrefill = Math.max(0, deltaIteration - Math.max(0, deltaOutput))
      const speculativeNoise = deltaOutput > 0 && iterationPrefill > 0 && iterationPrefill < deltaOutput * 0.5
      const livePrefill = iterationPrefill > 0 && !speculativeNoise ? iterationPrefill / elapsedSeconds : 0
      const completedPrefill = deltaInput > 0 && deltaTtft > 0
        ? deltaInput / deltaTtft
        : deltaInput > 0 && livePrefill <= 0 ? deltaInput / elapsedSeconds : 0
      prefillTokensPerSecond = Math.max(
        0,
        Math.round((livePrefill > 0 ? livePrefill : completedPrefill) * 100) / 100,
      )
    }
    this.previous = current
    this.generationHistory = [...this.generationHistory, generationTokensPerSecond].slice(-30)
    this.prefillHistory = [...this.prefillHistory, prefillTokensPerSecond].slice(-30)
    return {
      ...current,
      generationTokensPerSecond,
      prefillTokensPerSecond,
      generationHistory: this.generationHistory,
      prefillHistory: this.prefillHistory,
    }
  }
}
