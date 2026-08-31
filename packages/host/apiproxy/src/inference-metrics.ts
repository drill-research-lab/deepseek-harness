/** Bounded vLLM Prometheus retrieval for the browser inference dashboard. */

import type {
  InferenceMetricFamilyView,
  InferenceMetricLabelView,
  InferenceMetricSeriesView,
  InferenceMetricType,
  InferenceMetricsView,
} from './api/llm.ts'

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
const PROMETHEUS_TYPES = new Set<InferenceMetricType>([
  'counter',
  'gauge',
  'histogram',
  'summary',
  'untyped',
  'info',
  'stateset',
  'gaugehistogram',
  'unknown',
])

interface MetricMetadata {
  help?: string
  type?: InferenceMetricType
}

/** Decode the escape sequences allowed in Prometheus HELP text. */
function decodeHelp(value: string): string {
  return value.replace(/\\([\\n])/g, (_whole, escapedValue: string) => escapedValue === 'n' ? '\n' : '\\')
}

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

/** Associate histogram and summary child samples with their declared family. */
function declaredFamilyName(
  metric: string,
  metadata: ReadonlyMap<string, MetricMetadata>,
): string {
  if (metadata.has(metric)) return metric
  for (const [name, item] of metadata) {
    if (item.type !== 'histogram' && item.type !== 'summary' && item.type !== 'gaugehistogram') continue
    if (metric === `${name}_bucket` || metric === `${name}_sum` || metric === `${name}_count`) return name
  }
  return metric
}

/** Parse every vLLM family from one Prometheus text exposition. */
function parseMetricFamilies(body: string): InferenceMetricFamilyView[] {
  const metadata = new Map<string, MetricMetadata>()
  const series: InferenceMetricSeriesView[] = []
  const helpRow = new RegExp(`^# HELP (${PROMETHEUS_NAME})(?: (.*))?$`)
  const typeRow = new RegExp(`^# TYPE (${PROMETHEUS_NAME}) ([a-zA-Z_]+)$`)
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0) continue
    const help = helpRow.exec(line)
    const helpName = help?.[1]
    if (helpName !== undefined && /^vllm[:_]/.test(helpName)) {
      const item = metadata.get(helpName) ?? {}
      item.help = decodeHelp(help?.[2] ?? '')
      metadata.set(helpName, item)
      continue
    }
    const type = typeRow.exec(line)
    const typeName = type?.[1]
    const typeValue = type?.[2]
    if (typeName !== undefined && typeValue !== undefined && /^vllm[:_]/.test(typeName)) {
      const item = metadata.get(typeName) ?? {}
      if (PROMETHEUS_TYPES.has(typeValue as InferenceMetricType)) {
        item.type = typeValue as InferenceMetricType
      }
      metadata.set(typeName, item)
      continue
    }
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

  const families = new Map<string, InferenceMetricFamilyView>()
  for (const [name, item] of metadata) {
    families.set(name, {
      name,
      ...item.help === undefined ? {} : { help: item.help },
      ...item.type === undefined ? {} : { type: item.type },
      series: [],
    })
  }
  for (const item of series) {
    const name = declaredFamilyName(item.metric, metadata)
    const family = families.get(name) ?? { name, series: [] }
    family.series.push(item)
    families.set(name, family)
  }
  return [...families.values()]
    .filter(family => family.series.length > 0)
    .sort((left, right) => left.name.localeCompare(right.name))
}

/**
 * Parse the dashboard subset of a vLLM `/metrics` response.
 * @param body - complete bounded Prometheus exposition.
 * @param sampledAt - Host sample timestamp.
 * @returns detached dashboard metrics.
 * @throws {@link InferenceMetricsError} when the request gauges are absent or invalid.
 */
export function parseVllmMetrics(body: string, sampledAt = Date.now()): InferenceMetricsSample {
  const metricFamilies = parseMetricFamilies(body)
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
    metricFamilies,
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
