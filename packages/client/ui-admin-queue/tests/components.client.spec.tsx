// @vitest-environment jsdom
/** Admin queue page: permission gate, row rendering, and dnd-kit sortable wiring. */

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { AdminQueue } from '../src/client/AdminQueue.tsx'
import type { AdminQueueInjected } from '../src/client/AdminQueue.tsx'
import { AdminQueueController } from '../src/client/store.ts'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const t: AdminQueueInjected['t'] = key => en[key]

const RUNNING = { queueId: 'q-run', position: 0, state: 'running' as const, enqueuedAt: 0, sessionId: 's-run', ownerUsername: 'carol' }
const WAIT_A = { queueId: 'q-a', position: 1, state: 'waiting' as const, enqueuedAt: 1, sessionId: 's-a', ownerUsername: 'alice' }
const WAIT_B = { queueId: 'q-b', position: 2, state: 'waiting' as const, enqueuedAt: 2, sessionId: 's-b', ownerUsername: 'bob' }

function mount(me: ReturnType<typeof vi.fn>, list: ReturnType<typeof vi.fn>, reorder = vi.fn(() => Promise.resolve({ rpcId: 'r', result: { ok: true, value: {} } }))) {
  const controller = new AdminQueueController({ auth: { me }, queue: { list, reorder } } as never)
  const view = render(<AdminQueue controller={controller} useSnapshot={bindSnapshotSelector(controller.store)} t={t} />)
  return { controller, reorder, view }
}

function adminMe(isAdmin: boolean): ReturnType<typeof vi.fn> {
  return vi.fn(() => Promise.resolve({
    rpcId: 'me' as never,
    result: { ok: true as const, value: { userId: 'u', username: 'Admin', isAdmin } },
  }))
}

function listOnce(entries: unknown[]): ReturnType<typeof vi.fn> {
  return vi.fn(() => Promise.resolve({ rpcId: 'list' as never, result: { ok: true as const, value: { entries } } }))
}

describe('AdminQueue', () => {
  it('renders no queue data and never calls queue.list for a non-admin identity', async () => {
    const list = vi.fn()
    mount(adminMe(false), list)
    expect(await screen.findByText('You do not have permission to view this page.')).toBeTruthy()
    expect(list).not.toHaveBeenCalled()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('shows the display name and state per row, running pinned first with no position', async () => {
    const { view } = mount(adminMe(true), listOnce([WAIT_A, RUNNING, WAIT_B]))
    await screen.findByRole('table')
    const rows = [...view.container.querySelectorAll<HTMLTableRowElement>('tbody tr')]
    expect(rows).toHaveLength(3)
    expect(within(rows[0]!).getByText('carol')).toBeTruthy()
    expect(within(rows[0]!).getByText('Running')).toBeTruthy()
    expect(rows[0]!.querySelector('td')!.textContent).toBe('—')
    expect(within(rows[1]!).getByText('alice')).toBeTruthy()
    expect(rows[1]!.querySelector('td')!.textContent).toBe('1')
    expect(within(rows[2]!).getByText('bob')).toBeTruthy()
    expect(rows[2]!.querySelector('td')!.textContent).toBe('2')
  })

  it('shows the empty state once permission is confirmed but nothing is queued', async () => {
    mount(adminMe(true), listOnce([]))
    expect(await screen.findByText('No requests are queued or running right now.')).toBeTruthy()
  })

  it('marks only the waiting rows draggable (dnd-kit sortable), never the running row', async () => {
    const { view } = mount(adminMe(true), listOnce([RUNNING, WAIT_A, WAIT_B]))
    await screen.findByRole('table')
    const rows = [...view.container.querySelectorAll<HTMLTableRowElement>('tbody tr')]
    expect(rows[0]!.getAttribute('role')).not.toBe('button')
    expect(rows[1]!.getAttribute('role')).toBe('button')
    expect(rows[2]!.getAttribute('role')).toBe('button')
    expect(rows[1]!.getAttribute('aria-roledescription')).toBe(en.rowDragHint)
  })

  // The reorder → queue.reorder RPC path is covered by store.client.spec.ts
  // (AdminQueueController.reorder) and by the real-drag e2e; dnd-kit's pointer
  // and keyboard sensors need layout jsdom does not provide.
})
