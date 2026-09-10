/** Admin queue permission gate, polling lifecycle, reorder, and drag suspend. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminQueueController, ADMIN_QUEUE_POLL_MS } from '../src/client/store.ts'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const ENTRY = {
  queueId: 'q-1', position: 1, state: 'waiting' as const, enqueuedAt: 100, sessionId: 's-1', ownerUsername: 'alice',
}

function admin(isAdmin: boolean) {
  return vi.fn(() => Promise.resolve({
    rpcId: 'me' as never,
    result: { ok: true as const, value: { userId: 'u', username: 'Admin', isAdmin } },
  }))
}

describe('AdminQueueController', () => {
  it('never lists the queue for a non-admin identity', async () => {
    const me = admin(false)
    const list = vi.fn()
    const controller = new AdminQueueController({ auth: { me }, queue: { list } } as never)
    controller.start()
    await vi.waitFor(() => { expect(controller.store.getSnapshot()).toEqual({ status: 'forbidden' }) })
    expect(list).not.toHaveBeenCalled()
  })

  it('polls the queue snapshot for an admin identity at the fixed cadence', async () => {
    vi.useFakeTimers()
    const me = admin(true)
    const list = vi.fn(() => Promise.resolve({
      rpcId: 'list' as never,
      result: { ok: true as const, value: { entries: [ENTRY] } },
    }))
    const controller = new AdminQueueController({ auth: { me }, queue: { list } } as never)

    controller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.store.getSnapshot()).toEqual({ status: 'ready', entries: [ENTRY] })
    expect(list).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(ADMIN_QUEUE_POLL_MS - 1)
    expect(list).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(list).toHaveBeenCalledTimes(2)

    controller.stop()
    await vi.advanceTimersByTimeAsync(ADMIN_QUEUE_POLL_MS)
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('surfaces a permission-check transport failure as an error state', async () => {
    const me = vi.fn(() => Promise.reject(new Error('network down')))
    const controller = new AdminQueueController({ auth: { me }, queue: { list: vi.fn() } } as never)
    controller.start()
    await vi.waitFor(() => {
      expect(controller.store.getSnapshot()).toEqual({ status: 'error', code: 'transport', message: 'network down' })
    })
  })

  it('retry() rechecks permission before listing again', async () => {
    const me = vi.fn()
      .mockResolvedValueOnce({ rpcId: 'me-1', result: { ok: false, error: { code: 'unauthorized', message: 'no scope', details: {} } } })
      .mockResolvedValueOnce({ rpcId: 'me-2', result: { ok: true, value: { userId: 'u', username: 'Admin', isAdmin: true } } })
    const list = vi.fn(() => Promise.resolve({ rpcId: 'list', result: { ok: true, value: { entries: [] } } }))
    const controller = new AdminQueueController({ auth: { me }, queue: { list } } as never)

    controller.start()
    await vi.waitFor(() => {
      expect(controller.store.getSnapshot()).toEqual({ status: 'error', code: 'unauthorized', message: 'no scope' })
    })
    controller.retry()
    await vi.waitFor(() => { expect(controller.store.getSnapshot()).toEqual({ status: 'ready', entries: [] }) })
    controller.stop()
  })

  it('reorder() calls queue.reorder with the order then immediately re-fetches the snapshot', async () => {
    const me = admin(true)
    const entryB = { ...ENTRY, queueId: 'q-2', ownerUsername: 'bob' }
    const list = vi.fn()
      .mockResolvedValueOnce({ rpcId: 'list-1', result: { ok: true, value: { entries: [ENTRY, entryB] } } })
      .mockResolvedValueOnce({ rpcId: 'list-2', result: { ok: true, value: { entries: [entryB, ENTRY] } } })
    const reorder = vi.fn(() => Promise.resolve({ rpcId: 'reorder', result: { ok: true as const, value: {} } }))
    const controller = new AdminQueueController({ auth: { me }, queue: { list, reorder } } as never)

    controller.start()
    await vi.waitFor(() => { expect(controller.store.getSnapshot()).toMatchObject({ status: 'ready' }) })
    await controller.reorder(['q-2', 'q-1'])
    expect(reorder).toHaveBeenCalledWith({ orderedQueueIds: ['q-2', 'q-1'] })
    expect(controller.store.getSnapshot()).toMatchObject({ status: 'ready', entries: [entryB, ENTRY] })
    controller.stop()
  })

  it('re-fetches even when the reorder RPC itself fails', async () => {
    const me = admin(true)
    const list = vi.fn(() => Promise.resolve({ rpcId: 'list', result: { ok: true as const, value: { entries: [] } } }))
    const reorder = vi.fn(() => Promise.reject(new Error('reorder failed')))
    const controller = new AdminQueueController({ auth: { me }, queue: { list, reorder } } as never)

    controller.start()
    await vi.waitFor(() => { expect(controller.store.getSnapshot()).toMatchObject({ status: 'ready' }) })
    await expect(controller.reorder(['q-1'])).rejects.toThrow('reorder failed')
    expect(list).toHaveBeenCalledTimes(2)
    controller.stop()
  })

  it('suspend() halts polling until resume(), which reconciles immediately', async () => {
    vi.useFakeTimers()
    const me = admin(true)
    const list = vi.fn(() => Promise.resolve({ rpcId: 'list' as never, result: { ok: true as const, value: { entries: [ENTRY] } } }))
    const controller = new AdminQueueController({ auth: { me }, queue: { list } } as never)
    controller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(list).toHaveBeenCalledTimes(1)
    controller.suspend()
    await vi.advanceTimersByTimeAsync(ADMIN_QUEUE_POLL_MS * 3)
    expect(list).toHaveBeenCalledTimes(1)
    controller.resume()
    await vi.advanceTimersByTimeAsync(0)
    expect(list).toHaveBeenCalledTimes(2)
    controller.stop()
  })

  it('ignores a stale list response after stop()', async () => {
    const me = admin(true)
    let resolveList!: (value: unknown) => void
    const list = vi.fn(() => new Promise((res) => { resolveList = res }))
    const controller = new AdminQueueController({ auth: { me }, queue: { list } } as never)
    controller.start()
    await vi.waitFor(() => { expect(controller.store.getSnapshot()).toEqual({ status: 'loading' }) })
    controller.stop()
    resolveList({ rpcId: 'late', result: { ok: true, value: { entries: [ENTRY] } } })
    await Promise.resolve()
    expect(controller.store.getSnapshot()).toEqual({ status: 'loading' })
  })
})
