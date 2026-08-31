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
          requestsRunning: 2, requestsWaiting: 7, kvCacheUsage: 0.42,
          promptTokensTotal: 1200, generationTokensTotal: 345, preemptionsTotal: 6,
        },
      },
    })))

    expect(screen.getByRole('status').textContent).toContain('Reading')
    expect(await screen.findByRole('heading', { name: 'Model runtime status' })).toBeTruthy()
    const requests = screen.getByRole('article', { name: 'Requests' })
    expect(requests.textContent).toContain('Running2')
    expect(requests.textContent).toContain('Waiting7')
    expect(requests.textContent).toContain('not the current task’s queue position')
    expect(screen.getByRole('progressbar', { name: 'KV cache' }).getAttribute('aria-valuenow')).toBe('42')
    expect(screen.getByRole('article', { name: 'Cumulative tokens' }).textContent).toContain('1,200')
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
