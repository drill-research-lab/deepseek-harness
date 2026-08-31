/** Inference metrics parsing, retrieval bounds, and ApiProxy projection. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { RpcId } from '../src/api/rpc.ts'
import { createApiProxy } from '../src/api-proxy.ts'
import {
  fetchVllmMetrics,
  InferenceMetricsError,
  parseVllmMetrics,
  prometheusMetric,
} from '../src/inference-metrics.ts'

const METRICS = `
# HELP vllm:num_requests_running Number of requests currently running.
# TYPE vllm:num_requests_running gauge
vllm:num_requests_running{engine="0",model_name="acme/model"} 2
vllm:num_requests_running{engine="1",model_name="acme/model"} 1
# HELP vllm:num_requests_waiting Number of requests waiting to be processed.
# TYPE vllm:num_requests_waiting gauge
vllm:num_requests_waiting 4
vllm:kv_cache_usage_perc 0.375
vllm:prompt_tokens_total 1200
vllm:generation_tokens_total 345
vllm:num_preemptions_total 6
vllm:iteration_tokens_total_sum 2000
vllm:engine_sleep_state{sleep_state="awake"} 1
vllm:prefix_cache_hits_total 75
vllm:prefix_cache_queries_total 100
vllm:spec_decode_num_accepted_tokens_total 60
vllm:spec_decode_num_draft_tokens_total 100
# HELP vllm:time_to_first_token_seconds Histogram of time to first token\\n(in seconds).
# TYPE vllm:time_to_first_token_seconds histogram
vllm:time_to_first_token_seconds_bucket{engine="0",le="0.5"} 8
vllm:time_to_first_token_seconds_bucket{engine="0",le="1.0"} 10
vllm:time_to_first_token_seconds_bucket{engine="0",le="+Inf"} 10
vllm:time_to_first_token_seconds_sum{engine="0"} 3.25
vllm:time_to_first_token_seconds_count{engine="0"} 10
vllm:e2e_request_latency_seconds_bucket{le="2.0"} 8
vllm:e2e_request_latency_seconds_bucket{le="3.0"} 10
vllm:e2e_request_latency_seconds_bucket{le="+Inf"} 10
vllm:e2e_request_latency_seconds_count 10
vllm:inter_token_latency_seconds_bucket{le="0.1"} 8
vllm:inter_token_latency_seconds_bucket{le="0.2"} 10
vllm:inter_token_latency_seconds_bucket{le="+Inf"} 10
vllm:inter_token_latency_seconds_count 10
python_gc_objects_collected_total 99
`

afterEach(() => { vi.unstubAllGlobals() })

function defaults(overrides: Partial<Parameters<typeof createApiProxy>[1]> = {}) {
  return {
    defaultModelSelection: () => ({ provider: 'test', model: 'test' }),
    cwd: '/tmp',
    ...overrides,
  }
}

async function harness(overrides: Partial<Parameters<typeof createApiProxy>[1]> = {}) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  return { ctx, api: createApiProxy(ctx, defaults(overrides)) }
}

describe('vLLM metrics parser', () => {
  it('aggregates labeled request gauges and reads dashboard counters', () => {
    expect(prometheusMetric(METRICS, 'vllm:num_requests_running')).toBe(3)
    const metrics = parseVllmMetrics(METRICS, 123)
    expect(metrics).toMatchObject({
      backend: 'vllm',
      sampledAt: 123,
      requestsRunning: 3,
      requestsWaiting: 4,
      kvCacheUsage: 0.375,
      promptTokensTotal: 1200,
      generationTokensTotal: 345,
      preemptionsTotal: 6,
      modelId: 'acme/model',
      engineState: 'active',
      iterationTokensTotal: 2000,
      ttftSecondsTotal: 3.25,
      prefixCacheHitRate: 0.75,
      mtpAcceptanceRate: 0.6,
      ttftP95Seconds: 0.875,
      e2eP95Seconds: 2.75,
      itlP95Seconds: 0.175,
    })
  })

  it('accepts underscore-prefixed vLLM metrics and omits an invalid optional ratio', () => {
    expect(parseVllmMetrics(`
vllm_num_requests_running 1
vllm_num_requests_waiting 0
vllm_gpu_cache_usage_perc 8
`, 456)).toMatchObject({
      backend: 'vllm', sampledAt: 456, requestsRunning: 1, requestsWaiting: 0,
    })
  })

  it('omits a histogram quantile when the infinity bucket disagrees with its count', () => {
    const metrics = parseVllmMetrics(`
vllm:num_requests_running 0
vllm:num_requests_waiting 0
vllm:time_to_first_token_seconds_bucket{le="1"} 8
vllm:time_to_first_token_seconds_bucket{le="+Inf"} 9
vllm:time_to_first_token_seconds_count 10
`)
    expect(metrics).not.toHaveProperty('ttftP95Seconds')
  })

  it('rejects responses without both non-negative request gauges', () => {
    expect(() => parseVllmMetrics('vllm:num_requests_running -1\n')).toThrow(
      expect.objectContaining<Partial<InferenceMetricsError>>({ code: 'inference-metrics-invalid' }),
    )
    expect(() => parseVllmMetrics(`
vllm:num_requests_running 0.5
vllm:num_requests_waiting 0
`)).toThrow(
      expect.objectContaining<Partial<InferenceMetricsError>>({ code: 'inference-metrics-invalid' }),
    )
  })

  it('omits invalid negative optional counters', () => {
    const metrics = parseVllmMetrics(`
vllm:num_requests_running 1
vllm:num_requests_waiting 0
vllm:prompt_tokens_total -1
vllm:generation_tokens_total -2
vllm:num_preemptions_total -3
`, 789)
    expect(metrics).toMatchObject({
      backend: 'vllm', sampledAt: 789, requestsRunning: 1, requestsWaiting: 0,
    })
    expect(metrics).not.toHaveProperty('promptTokensTotal')
    expect(metrics).not.toHaveProperty('generationTokensTotal')
    expect(metrics).not.toHaveProperty('preemptionsTotal')
  })

  it('rejects a malformed vLLM sample instead of silently hiding it', () => {
    expect(() => parseVllmMetrics(`
vllm:num_requests_running{engine="unterminated} 1
vllm:num_requests_waiting 0
`)).toThrow(expect.objectContaining<Partial<InferenceMetricsError>>({ code: 'inference-metrics-invalid' }))
  })

  it('rejects an otherwise valid exposition above the retained-series limit', () => {
    const samples = Array.from({ length: 10_001 }, (_, index) => `vllm:test_metric{id="${String(index)}"} 1`)
    expect(() => parseVllmMetrics(`
vllm:num_requests_running 0
vllm:num_requests_waiting 0
${samples.join('\n')}
`)).toThrow(expect.objectContaining<Partial<InferenceMetricsError>>({ code: 'inference-metrics-too-large' }))
  })
})

describe('vLLM metrics retrieval', () => {
  it('enriches the curated metrics with model metadata from the same origin', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(METRICS))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ id: 'acme/model', max_model_len: 128_000 }],
      })))
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchVllmMetrics(
      new URL('http://metrics.test/metrics'),
      100_000,
      new AbortController().signal,
    )).resolves.toMatchObject({ modelId: 'acme/model', contextLength: 128_000 })
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      new URL('http://metrics.test/v1/models'),
      expect.objectContaining({ headers: { accept: 'application/json' } }),
    )
  })

  it('does not swallow caller cancellation during optional model discovery', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(METRICS))
      .mockImplementationOnce(() => {
        controller.abort()
        return Promise.reject(new DOMException('cancelled', 'AbortError'))
      }))
    await expect(fetchVllmMetrics(
      new URL('http://metrics.test/metrics'),
      100_000,
      controller.signal,
    )).rejects.toThrow('cancelled')
  })

  it('bounds the body even without Content-Length', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(METRICS))))
    await expect(fetchVllmMetrics(new URL('http://metrics.test/metrics'), 20, new AbortController().signal))
      .rejects.toMatchObject({ code: 'inference-metrics-too-large' })
  })

  it('maps transport and HTTP failures to safe endpoint errors', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('secret host detail'))))
    await expect(fetchVllmMetrics(new URL('http://metrics.test/metrics'), 1000, new AbortController().signal))
      .rejects.toMatchObject({
        code: 'inference-metrics-unavailable',
        message: 'The inference metrics endpoint could not be reached.',
      })

    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('no', { status: 503 }))))
    await expect(fetchVllmMetrics(new URL('http://metrics.test/metrics'), 1000, new AbortController().signal))
      .rejects.toMatchObject({ code: 'inference-metrics-unavailable' })
  })
})

describe('llm.metrics', () => {
  it('reports an unconfigured deployment without attempting network access', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const { ctx, api } = await harness()
    const response = await api.llm.metrics({ rpcId: RpcId('metrics-unconfigured'), payload: {} })
    expect(response.result).toEqual({
      ok: false,
      error: {
        code: 'inference-metrics-unconfigured',
        message: 'Inference metrics are not configured for this deployment.',
        details: {},
      },
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('returns a bounded sample and the configured refresh cadence', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(METRICS))))
    const { ctx, api } = await harness({
      inferenceMetricsUrl: 'http://metrics.test/metrics',
      inferenceMetricsMaxBytes: 10_000,
      inferenceMetricsTimeoutMs: 500,
      inferenceMetricsRefreshMs: 7_500,
    })
    const response = await api.llm.metrics({ rpcId: RpcId('metrics-ready'), payload: {} })
    expect(response.result).toMatchObject({
      ok: true,
      value: {
        backend: 'vllm',
        refreshAfterMs: 7_500,
        requestsRunning: 3,
        requestsWaiting: 4,
      },
    })
    await ctx.fiber.dispose()
  })

  it('rejects non-HTTP metrics protocols at composition time', () => {
    expect(() => createApiProxy(new Context(), defaults({ inferenceMetricsUrl: 'file:///tmp/metrics' })))
      .toThrow('inferenceMetricsUrl must use http: or https:')
  })
})

describe('llm.resources', () => {
  it('reports missing deployment configuration without network access', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const { ctx, api } = await harness()
    const response = await api.llm.resources({ rpcId: RpcId('resources-unconfigured'), payload: {} })
    expect(response.result).toMatchObject({
      ok: false,
      error: { code: 'inference-metrics-unconfigured' },
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('returns a projected SparkDash sample at the configured cadence', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(Response.json({
      metrics: {
        gpu: {
          temperature: 47, usage: 0, power: { draw: 10, limit: 120 },
          vram: { used: 112246, total: 122566, available: 2329 },
        },
        storage: [],
        network: { primaryInterface: null, linkSpeedMbps: null, interfaces: [] },
      },
    }))))
    const { ctx, api } = await harness({
      inferenceResourcesUrl: 'http://sparkdash.test/api/sparks/park/metrics',
      inferenceMetricsRefreshMs: 7_500,
    })
    const response = await api.llm.resources({ rpcId: RpcId('resources-ready'), payload: {} })
    expect(response.result).toMatchObject({
      ok: true,
      value: {
        refreshAfterMs: 7_500,
        gpu: { temperatureC: 47, powerLimitWatts: 120 },
        storage: [],
        networkInterfaces: [],
      },
    })
    await ctx.fiber.dispose()
  })

  it('rejects non-HTTP resource protocols at composition time', () => {
    expect(() => createApiProxy(new Context(), defaults({ inferenceResourcesUrl: 'file:///tmp/resources' })))
      .toThrow('inferenceResourcesUrl must use http: or https:')
  })
})
