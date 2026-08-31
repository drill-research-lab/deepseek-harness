/** Dashboard polling lifecycle and retry behavior. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { InferenceDashboardController } from '../src/client/store.ts'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const sample = {
  backend: 'vllm' as const,
  sampledAt: 123,
  refreshAfterMs: 2000,
  requestsRunning: 2,
  requestsWaiting: 5,
  kvCacheUsage: 0.5,
}

describe('InferenceDashboardController', () => {
  it('polls at the Host-provided cadence and stops with its owner', async () => {
    vi.useFakeTimers()
    const metrics = vi.fn(() => Promise.resolve({
      rpcId: 'metrics' as never,
      result: { ok: true as const, value: sample },
    }))
    const controller = new InferenceDashboardController({ llm: { metrics } } as never)

    controller.start()
    await Promise.resolve()
    expect(controller.store.getSnapshot().status).toBe('ready')
    expect(metrics).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1999)
    expect(metrics).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(metrics).toHaveBeenCalledTimes(2)

    controller.stop()
    await vi.advanceTimersByTimeAsync(2000)
    expect(metrics).toHaveBeenCalledTimes(2)
  })

  it('shows a business failure and retries successfully', async () => {
    const metrics = vi.fn()
      .mockResolvedValueOnce({
        rpcId: 'metrics-1',
        result: {
          ok: false,
          error: { code: 'inference-metrics-unavailable', message: 'offline', details: {} },
        },
      })
      .mockResolvedValueOnce({ rpcId: 'metrics-2', result: { ok: true, value: sample } })
    const controller = new InferenceDashboardController({ llm: { metrics } } as never)

    controller.start()
    await vi.waitFor(() => {
      expect(controller.store.getSnapshot()).toEqual({
        status: 'error', code: 'inference-metrics-unavailable', message: 'offline',
      })
    })
    controller.retry()
    await vi.waitFor(() => { expect(controller.store.getSnapshot()).toEqual({ status: 'ready', metrics: sample }) })
    controller.stop()
  })

  it('ignores a response after the settings section unmounts', async () => {
    let resolve!: (value: unknown) => void
    const metrics = vi.fn(() => new Promise((res) => { resolve = res }))
    const controller = new InferenceDashboardController({ llm: { metrics } } as never)
    controller.start()
    controller.stop()
    resolve({ rpcId: 'late', result: { ok: true, value: sample } })
    await Promise.resolve()
    expect(controller.store.getSnapshot()).toEqual({ status: 'loading' })

    controller.retry()
    await Promise.resolve()
    expect(metrics).toHaveBeenCalledTimes(1)
  })
})
