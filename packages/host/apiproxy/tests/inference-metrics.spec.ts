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
vllm:num_requests_running{engine="0"} 2
vllm:num_requests_running{engine="1"} 1
vllm:num_requests_waiting 4
vllm:kv_cache_usage_perc 0.375
vllm:prompt_tokens_total 1200
vllm:generation_tokens_total 345
vllm:num_preemptions_total 6
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
    expect(parseVllmMetrics(METRICS, 123)).toEqual({
      backend: 'vllm',
      sampledAt: 123,
      requestsRunning: 3,
      requestsWaiting: 4,
      kvCacheUsage: 0.375,
      promptTokensTotal: 1200,
      generationTokensTotal: 345,
      preemptionsTotal: 6,
    })
  })

  it('accepts underscore-prefixed vLLM metrics and omits an invalid optional ratio', () => {
    expect(parseVllmMetrics(`
vllm_num_requests_running 1
vllm_num_requests_waiting 0
vllm_gpu_cache_usage_perc 8
`, 456)).toEqual({
      backend: 'vllm', sampledAt: 456, requestsRunning: 1, requestsWaiting: 0,
    })
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
    expect(parseVllmMetrics(`
vllm:num_requests_running 1
vllm:num_requests_waiting 0
vllm:prompt_tokens_total -1
vllm:generation_tokens_total -2
vllm:num_preemptions_total -3
`, 789)).toEqual({
      backend: 'vllm', sampledAt: 789, requestsRunning: 1, requestsWaiting: 0,
    })
  })
})

describe('vLLM metrics retrieval', () => {
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
