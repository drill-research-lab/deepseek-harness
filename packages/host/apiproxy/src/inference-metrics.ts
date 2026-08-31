/** Bounded vLLM Prometheus retrieval for the browser inference dashboard. */

import type { InferenceMetricsView } from './api/llm.ts'

interface InferenceMetricLabelView {
  name: string
  value: string
}

interface InferenceMetricSeriesView {
  metric: string
  labels: InferenceMetricLabelView[]
  value: string
}

/** Default deadline for one metrics scrape. */
export const DEFAULT_INFERENCE_METRICS_TIMEOUT_MS = 3_000

/** Default response cap for Prometheus exposition. */
export const DEFAULT_INFERENCE_METRICS_MAX_BYTES = 1_048_576

/** Default successful browser refresh interval. */
export const DEFAULT_INFERENCE_METRICS_REFRESH_MS = 2_000

/** Maximum parsed vLLM samples retained from one bounded response. */
export const MAX_INFERENCE_METRIC_SERIES = 10_000

/** Metrics returned to the authenticated browser before refresh metadata is added. */
export type InferenceMetricsSample = Omit<InferenceMetricsView, 'refreshAfterMs'>

/** Stable failure codes returned by the dashboard endpoint. */
export type InferenceMetricsFailureCode =
  | 'inference-metrics-unavailable'
  | 'inference-metrics-too-large'
  | 'inference-metrics-invalid'

/** Retrieval failure whose code is safe to expose across the RPC boundary. */
export class InferenceMetricsError extends Error {
  override readonly name = 'InferenceMetricsError'

  /**
   * @param message - user-actionable failure text.
   * @param code - stable wire error code.
   * @param options - provider or parsing failure retained for Host diagnostics.
   */
  constructor(
    message: string,
    readonly code: InferenceMetricsFailureCode,
    options?: { cause?: unknown },
  ) {
    super(message, options)
  }
}

/** Escape a metric name for exact regular-expression matching. */
function escaped(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Sum every finite Prometheus sample carrying one exact metric name. vLLM's
 * multiprocess exporter may emit several labeled series for one logical
 * gauge, so the dashboard follows Prometheus aggregation rather than taking
 * an arbitrary row.
 * @param body - complete Prometheus exposition.
 * @param name - exact metric name without labels.
 * @returns the sum of finite matching samples, or undefined when none exist.
 */
export function prometheusMetric(body: string, name: string): number | undefined {
  const row = new RegExp(`^${escaped(name)}(?:\\{[^}]*\\})?\\s+([\\d.eE+-]+)(?:\\s+\\d+)?\\s*$`, 'gm')
  let sum = 0
  let found = false
  for (let match = row.exec(body); match !== null; match = row.exec(body)) {
    const value = Number(match[1])
    if (!Number.isFinite(value)) continue
    sum += value
    found = true
  }
  return found ? sum : undefined
}

/** Resolve a vLLM metric across the colon and underscore prefix spellings. */
function vllmMetric(body: string, name: string): number | undefined {
  return prometheusMetric(body, `vllm:${name}`)
    ?? prometheusMetric(body, `vllm_${name}`)
}

const PROMETHEUS_NAME = '[a-zA-Z_:][a-zA-Z0-9_:]*'
const PROMETHEUS_LABEL_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*/
const PROMETHEUS_VALUE = /^(?:NaN|[+-]?Inf|[-+]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][-+]?\d+)?)$/
/** Decode a Prometheus label set without accepting partial or malformed input. */
function parseLabels(source: string): InferenceMetricLabelView[] | undefined {
  const labels: InferenceMetricLabelView[] = []
  let offset = 0
  const whitespace = (): void => {
    while (source[offset] === ' ' || source[offset] === '\t') offset += 1
  }
  whitespace()
  while (offset < source.length) {
    const nameMatch = PROMETHEUS_LABEL_NAME.exec(source.slice(offset))
    if (nameMatch === null) return undefined
    const name = nameMatch[0]
    offset += name.length
    whitespace()
    if (source[offset] !== '=') return undefined
    offset += 1
    whitespace()
    if (source[offset] !== '"') return undefined
    offset += 1
    let value = ''
    let closed = false
    while (offset < source.length) {
      const character = source[offset]
      if (character === undefined) return undefined
      offset += 1
      if (character === '"') {
        closed = true
        break
      }
      if (character !== '\\') {
        value += character
        continue
      }
      const escapedValue = source[offset]
      offset += 1
      if (escapedValue === 'n') value += '\n'
      else if (escapedValue === '\\' || escapedValue === '"') value += escapedValue
      else return undefined
    }
    if (!closed) return undefined
    labels.push({ name, value })
    whitespace()
    if (offset === source.length) break
    if (source[offset] !== ',') return undefined
    offset += 1
    whitespace()
  }
  return labels
}

/** Parse one Prometheus sample line whose metric name has already been scoped. */
function parseSeries(line: string): InferenceMetricSeriesView | undefined {
  const sample = new RegExp(
    `^(${PROMETHEUS_NAME})(?:\\{(.*)\\})?[ \\t]+([^ \\t]+)(?:[ \\t]+[+-]?\\d+)?[ \\t]*(?:#.*)?$`,
  ).exec(line)
  if (sample === null) return undefined
  const metric = sample[1]
  const value = sample[3]
  if (metric === undefined || value === undefined || !PROMETHEUS_VALUE.test(value)) return undefined
  const labels = sample[2] === undefined ? [] : parseLabels(sample[2])
  if (labels === undefined) return undefined
  return { metric, labels, value }
}

/** Parse every vLLM sample from one Prometheus text exposition. */
function parseMetricSeries(body: string): InferenceMetricSeriesView[] {
  const series: InferenceMetricSeriesView[] = []
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    if (!/^vllm[:_]/.test(line)) continue
    const parsed = parseSeries(line)
    if (parsed === undefined) {
      throw new InferenceMetricsError(
        'The configured endpoint exposed malformed vLLM metrics.',
        'inference-metrics-invalid',
      )
    }
    series.push(parsed)
    if (series.length > MAX_INFERENCE_METRIC_SERIES) {
      throw new InferenceMetricsError(
        `The metrics response exceeds the ${String(MAX_INFERENCE_METRIC_SERIES)} series limit.`,
        'inference-metrics-too-large',
      )
    }
  }
  return series
}

/** Read the first non-empty label value from the parsed vLLM samples. */
function firstLabel(series: InferenceMetricSeriesView[], name: string): string | undefined {
  for (const item of series) {
    const value = item.labels.find(label => label.name === name)?.value
    if (value !== undefined && value.length > 0) return value
  }
  return undefined
}

/** Resolve the engine residency represented by vLLM's labeled sleep-state gauges. */
function engineState(series: InferenceMetricSeriesView[]): InferenceMetricsView['engineState'] {
  const states = series.filter(item => /(?:^|[:_])engine_sleep_state$/.test(item.metric))
  const enabled = (name: string): boolean => states.some(item => (
    item.labels.some(label => label.name === 'sleep_state' && label.value === name)
      && Number(item.value) > 0
  ))
  if (enabled('awake')) return 'active'
  if (enabled('weights_offloaded')) return 'weights-offloaded'
  if (enabled('discard_all')) return 'discarded'
  return undefined
}

interface HistogramBucket {
  upper: number
  count: number
}

/** Derive one Prometheus-style quantile from cumulative histogram buckets. */
function histogramQuantile(
  series: InferenceMetricSeriesView[],
  name: string,
  quantile: number,
): number | undefined {
  const bucketName = [`vllm:${name}_bucket`, `vllm_${name}_bucket`]
  const countName = [`vllm:${name}_count`, `vllm_${name}_count`]
  const byUpper = new Map<number, number>()
  let infinityCount = 0
  let total = 0
  let totalFound = false
  for (const item of series) {
    const value = Number(item.value)
    if (!Number.isFinite(value)) continue
    if (countName.includes(item.metric)) {
      total += value
      totalFound = true
      continue
    }
    if (!bucketName.includes(item.metric)) continue
    const rawUpper = item.labels.find(label => label.name === 'le')?.value
    if (rawUpper === undefined) continue
    const upper = rawUpper === '+Inf' ? Number.POSITIVE_INFINITY : Number(rawUpper)
    if (!Number.isFinite(upper) && upper !== Number.POSITIVE_INFINITY) continue
    if (upper === Number.POSITIVE_INFINITY) infinityCount += value
    byUpper.set(upper, (byUpper.get(upper) ?? 0) + value)
  }
  if (!totalFound || total <= 0 || byUpper.size === 0) return undefined
  if (infinityCount > 0 && Math.abs(infinityCount - total) > 1e-6) return undefined
  const buckets: HistogramBucket[] = [...byUpper].map(([upper, count]) => ({ upper, count }))
    .sort((left, right) => left.upper - right.upper)
  const target = total * quantile
  let previousUpper = 0
  let previousCount = 0
  for (const bucket of buckets) {
    if (bucket.count >= target) {
      if (!Number.isFinite(bucket.upper)) return undefined
      if (bucket.count === previousCount) return bucket.upper
      return previousUpper + (bucket.upper - previousUpper)
        * ((target - previousCount) / (bucket.count - previousCount))
    }
    previousUpper = bucket.upper
    previousCount = bucket.count
  }
  return undefined
}

/** Return a bounded fraction from two cumulative counters. */
function counterRatio(numerator: number | undefined, denominator: number | undefined): number | undefined {
  if (numerator === undefined || denominator === undefined || denominator <= 0) return undefined
  const value = numerator / denominator
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : undefined
}

/**
 * Parse the dashboard subset of a vLLM `/metrics` response.
 * @param body - complete bounded Prometheus exposition.
 * @param sampledAt - Host sample timestamp.
 * @returns detached dashboard metrics.
 * @throws {@link InferenceMetricsError} when the request gauges are absent or invalid.
 */
export function parseVllmMetrics(body: string, sampledAt = Date.now()): InferenceMetricsSample {
  const series = parseMetricSeries(body)
  const requestsRunning = vllmMetric(body, 'num_requests_running')
  const requestsWaiting = vllmMetric(body, 'num_requests_waiting')
  if (requestsRunning === undefined || requestsWaiting === undefined
    || !Number.isInteger(requestsRunning) || !Number.isInteger(requestsWaiting)
    || requestsRunning < 0 || requestsWaiting < 0) {
    throw new InferenceMetricsError(
      'The configured endpoint did not expose valid vLLM request gauges.',
      'inference-metrics-invalid',
    )
  }
  const rawKvCacheUsage = vllmMetric(body, 'kv_cache_usage_perc')
    ?? vllmMetric(body, 'gpu_cache_usage_perc')
  const kvCacheUsage = rawKvCacheUsage !== undefined
    && rawKvCacheUsage >= 0
    && rawKvCacheUsage <= 1
    ? rawKvCacheUsage
    : undefined
  const optionalCounter = (name: string): number | undefined => {
    const value = vllmMetric(body, name)
    return value !== undefined && value >= 0 ? value : undefined
  }
  const promptTokensTotal = optionalCounter('prompt_tokens_total')
  const generationTokensTotal = optionalCounter('generation_tokens_total')
  const preemptionsTotal = optionalCounter('num_preemptions_total')
  const iterationTokensTotal = optionalCounter('iteration_tokens_total_sum')
  const ttftSecondsTotal = optionalCounter('time_to_first_token_seconds_sum')
  const prefixCacheHitRate = counterRatio(
    optionalCounter('prefix_cache_hits_total'),
    optionalCounter('prefix_cache_queries_total'),
  )
  const mtpAcceptanceRate = counterRatio(
    optionalCounter('spec_decode_num_accepted_tokens_total'),
    optionalCounter('spec_decode_num_draft_tokens_total'),
  )
  const roundedQuantile = (name: string): number | undefined => {
    const value = histogramQuantile(series, name, 0.95)
    return value === undefined ? undefined : Math.round(value * 1000) / 1000
  }
  const ttftP95Seconds = roundedQuantile('time_to_first_token_seconds')
  const e2eP95Seconds = roundedQuantile('e2e_request_latency_seconds')
  const itlP95Seconds = roundedQuantile('inter_token_latency_seconds')
  const modelId = firstLabel(series, 'model_name')
  const currentEngineState = engineState(series)
  return {
    backend: 'vllm',
    sampledAt,
    ...modelId === undefined ? {} : { modelId },
    ...currentEngineState === undefined ? {} : { engineState: currentEngineState },
    requestsRunning,
    requestsWaiting,
    ...kvCacheUsage === undefined ? {} : { kvCacheUsage },
    ...promptTokensTotal === undefined ? {} : { promptTokensTotal },
    ...generationTokensTotal === undefined ? {} : { generationTokensTotal },
    ...preemptionsTotal === undefined ? {} : { preemptionsTotal },
    ...iterationTokensTotal === undefined ? {} : { iterationTokensTotal },
    ...ttftSecondsTotal === undefined ? {} : { ttftSecondsTotal },
    ...prefixCacheHitRate === undefined ? {} : { prefixCacheHitRate },
    ...mtpAcceptanceRate === undefined ? {} : { mtpAcceptanceRate },
    ...ttftP95Seconds === undefined ? {} : { ttftP95Seconds },
    ...e2eP95Seconds === undefined ? {} : { e2eP95Seconds },
    ...itlP95Seconds === undefined ? {} : { itlP95Seconds },
  }
}

/** Read a response body without ever retaining more than the configured byte cap. */
async function boundedText(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new InferenceMetricsError(
      `The metrics response exceeds the ${String(maxBytes)} byte limit.`,
      'inference-metrics-too-large',
    )
  }
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let body = ''
  let complete = false
  try {
    while (true) {
      const item = await reader.read()
      if (item.done) {
        complete = true
        break
      }
      bytes += item.value.byteLength
      if (bytes > maxBytes) {
        throw new InferenceMetricsError(
          `The metrics response exceeds the ${String(maxBytes)} byte limit.`,
          'inference-metrics-too-large',
        )
      }
      body += decoder.decode(item.value, { stream: true })
    }
    return body + decoder.decode()
  } finally {
    if (!complete) {
      await reader.cancel().catch((_alreadyClosed: unknown) => {
        // The provider already closed the response while the size guard aborted it.
      })
    }
    reader.releaseLock()
  }
}

interface VllmModelMetadata {
  modelId?: string
  contextLength?: number
}

/** Read optional SparkDash-style model metadata from the configured vLLM origin. */
async function fetchVllmModelMetadata(url: URL, signal: AbortSignal): Promise<VllmModelMetadata> {
  if (!/\/metrics$/.test(url.pathname)) return {}
  const modelsUrl = new URL(url)
  modelsUrl.pathname = modelsUrl.pathname.replace(/\/metrics$/, '/v1/models')
  modelsUrl.search = ''
  try {
    const response = await fetch(modelsUrl, { headers: { accept: 'application/json' }, signal })
    if (!response.ok) {
      await response.body?.cancel()
      return {}
    }
    const raw: unknown = JSON.parse(await boundedText(response, 65_536))
    if (typeof raw !== 'object' || raw === null || !('data' in raw) || !Array.isArray(raw.data)) return {}
    const model: unknown = raw.data[0]
    if (typeof model !== 'object' || model === null) return {}
    const modelId = 'id' in model && typeof model.id === 'string' && model.id.length > 0
      ? model.id
      : undefined
    const contextLength = 'max_model_len' in model && typeof model.max_model_len === 'number'
      && Number.isInteger(model.max_model_len) && model.max_model_len > 0
      ? model.max_model_len
      : undefined
    return {
      ...modelId === undefined ? {} : { modelId },
      ...contextLength === undefined ? {} : { contextLength },
    }
  } catch (optionalModelMetadataFailure: unknown) {
    if (signal.aborted) throw optionalModelMetadataFailure
    // Metrics remain authoritative when the companion model endpoint is absent or malformed.
    return {}
  }
}

/**
 * Fetch and parse one configured vLLM metrics endpoint.
 * @param url - validated HTTP(S) endpoint.
 * @param maxBytes - complete response byte limit.
 * @param signal - caller and timeout cancellation.
 * @returns current metrics sample.
 * @throws {@link InferenceMetricsError} for transport, status, size, or content failures.
 */
export async function fetchVllmMetrics(
  url: URL,
  maxBytes: number,
  signal: AbortSignal,
): Promise<InferenceMetricsSample> {
  let response: Response
  try {
    response = await fetch(url, {
      headers: { accept: 'text/plain' },
      signal,
    })
  } catch (error) {
    throw new InferenceMetricsError(
      'The inference metrics endpoint could not be reached.',
      'inference-metrics-unavailable',
      { cause: error },
    )
  }
  if (!response.ok) {
    await response.body?.cancel().catch((_alreadyClosed: unknown) => {
      // The non-success status is complete; cancellation only releases unread bytes.
    })
    throw new InferenceMetricsError(
      `The inference metrics endpoint returned HTTP ${String(response.status)}.`,
      'inference-metrics-unavailable',
    )
  }
  const sample = parseVllmMetrics(await boundedText(response, maxBytes))
  const model = await fetchVllmModelMetadata(url, signal)
  return { ...sample, ...model }
}
