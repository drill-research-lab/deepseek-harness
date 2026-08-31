// @vitest-environment jsdom
/** Dashboard metrics, unavailable state, and retry interaction. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { InferenceDashboard } from '../src/client/InferenceDashboard.tsx'
import type { InferenceDashboardInjected } from '../src/client/InferenceDashboard.tsx'
import { InferenceDashboardController } from '../src/client/store.ts'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const t: InferenceDashboardInjected['t'] = key => en[key]

function mount(metrics: ReturnType<typeof vi.fn>) {
  const controller = new InferenceDashboardController({ llm: { metrics } } as never)
  render(<InferenceDashboard controller={controller} useSnapshot={bindSnapshotSelector(controller.store)} t={t} />)
  return controller
}

describe('InferenceDashboard', () => {
  it('renders SparkDash-style request, cache, and token cards', async () => {
    mount(vi.fn(() => Promise.resolve({
      rpcId: 'metrics',
      result: {
        ok: true,
        value: {
          backend: 'vllm', sampledAt: 0, refreshAfterMs: 60_000,
          modelId: 'acme/model', contextLength: 128_000, engineState: 'active',
          requestsRunning: 2, requestsWaiting: 7, kvCacheUsage: 0.42,
          promptTokensTotal: 1200, generationTokensTotal: 345, preemptionsTotal: 6,
          prefixCacheHitRate: 0.75, mtpAcceptanceRate: 0.6,
          ttftP95Seconds: 0.5, e2eP95Seconds: 2.5, itlP95Seconds: 0.1,
        },
      },
    })))

    expect(screen.getByRole('status').textContent).toContain('Reading')
    expect(await screen.findByRole('heading', { name: 'Model runtime status' })).toBeTruthy()
    const panel = screen.getByRole('article', { name: 'LLM runtime metrics' })
    expect(panel.textContent).toContain('acme/model')
    expect(panel.textContent).toContain('Generation tok/s0.0')
    expect(panel.textContent).toContain('Prefill tok/s0.0')
    expect(panel.textContent).toContain('Slots2 running')
    expect(panel.textContent).toContain('Context128,000')
    expect(panel.textContent).toContain('EngineActive')
    expect(panel.textContent).toContain('KV Cache42.0%')
    expect(panel.textContent).toContain('Requests2 run / 7 wait')
    expect(panel.textContent).toContain('TTFT p950.500s')
    expect(panel.textContent).toContain('Prefix Cache75.0%')
    expect(panel.textContent).toContain('E2E p952.500s')
    expect(panel.textContent).toContain('ITL p950.100s')
    expect(panel.textContent).toContain('MTP Accept60.0%')
    expect(panel.textContent).toContain('do not represent the current DSH task’s queue position')
  })

  it('explains an unconfigured deployment and retries a failed endpoint', async () => {
    const metrics = vi.fn()
      .mockResolvedValueOnce({
        rpcId: 'metrics-1',
        result: {
          ok: false,
          error: {
            code: 'inference-metrics-unconfigured',
            message: 'not configured',
            details: {},
          },
        },
      })
      .mockResolvedValueOnce({
        rpcId: 'metrics-2',
        result: {
          ok: true,
          value: {
            backend: 'vllm', sampledAt: 0, refreshAfterMs: 60_000,
            requestsRunning: 1, requestsWaiting: 0,
          },
        },
      })
    mount(metrics)

    expect((await screen.findByRole('alert')).textContent).toContain('has not configured')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { name: 'Model runtime status' })).toBeTruthy()
    expect(metrics).toHaveBeenCalledTimes(2)
  })
})
