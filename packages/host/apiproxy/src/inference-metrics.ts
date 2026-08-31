/** Bounded vLLM Prometheus retrieval for the browser inference dashboard. */

/** Default deadline for one metrics scrape. */
export const DEFAULT_INFERENCE_METRICS_TIMEOUT_MS = 3_000

/** Default response cap for Prometheus exposition. */
export const DEFAULT_INFERENCE_METRICS_MAX_BYTES = 1_048_576

/** Default successful browser refresh interval. */
export const DEFAULT_INFERENCE_METRICS_REFRESH_MS = 2_000

/** Metrics returned to the authenticated browser. */
export interface InferenceMetricsSample {
  /** Backend whose metric names were recognized. */
  backend: 'vllm'
  /** Host sample time in Unix milliseconds. */
  sampledAt: number
  /** Requests in model execution batches. */
  requestsRunning: number
  /** Requests accepted but waiting for processing. */
  requestsWaiting: number
  /** KV-cache occupancy as a fraction from zero through one, when exposed. */
  kvCacheUsage?: number
  /** Cumulative prompt tokens, when exposed. */
  promptTokensTotal?: number
  /** Cumulative generated tokens, when exposed. */
  generationTokensTotal?: number
  /** Cumulative scheduler preemptions, when exposed. */
  preemptionsTotal?: number
}

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

/**
 * Parse the dashboard subset of a vLLM `/metrics` response.
 * @param body - complete bounded Prometheus exposition.
 * @param sampledAt - Host sample timestamp.
 * @returns detached dashboard metrics.
 * @throws {@link InferenceMetricsError} when the request gauges are absent or invalid.
 */
export function parseVllmMetrics(body: string, sampledAt = Date.now()): InferenceMetricsSample {
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
  return {
    backend: 'vllm',
    sampledAt,
    requestsRunning,
    requestsWaiting,
    ...kvCacheUsage === undefined ? {} : { kvCacheUsage },
    ...promptTokensTotal === undefined ? {} : { promptTokensTotal },
    ...generationTokensTotal === undefined ? {} : { generationTokensTotal },
    ...preemptionsTotal === undefined ? {} : { preemptionsTotal },
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
  return parseVllmMetrics(await boundedText(response, maxBytes))
}
