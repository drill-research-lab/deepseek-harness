import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { AdmissionQueue } from '../src/queue.ts'
import type { PositionChange, QueueAuditLine } from '../src/types.ts'

const sid = (value: string): SessionId => value as SessionId
const live = (): AbortSignal => new AbortController().signal

/** Enqueue and record whether/when the admission settled. */
function admit(queue: AdmissionQueue, options: { sessionId?: string; signal?: AbortSignal } = {}): {
  queueId: string
  position: number
  settled: () => 'pending' | 'admitted' | 'rejected'
  admitted: Promise<void>
} {
  const meta = {
    ...options.sessionId === undefined ? {} : { sessionId: sid(options.sessionId) },
    signal: options.signal ?? live(),
  }
  const { queueId, position, admitted } = queue.enqueue(meta)
  let state: 'pending' | 'admitted' | 'rejected' = 'pending'
  const tracked = admitted.then(() => { state = 'admitted' }, () => { state = 'rejected' })
  return { queueId, position, settled: () => state, admitted: tracked }
}

const flush = (): Promise<void> => new Promise(resolve => setImmediate(resolve))

describe('AdmissionQueue — FIFO and concurrency', () => {
  it('admits in FIFO order under limit 1 and reports 1..N positions', async () => {
    const queue = new AdmissionQueue(1)
    const a = admit(queue)
    const b = admit(queue)
    const c = admit(queue)

    expect([a.position, b.position, c.position]).toEqual([0, 1, 2])
    await flush()
    expect([a.settled(), b.settled(), c.settled()]).toEqual(['admitted', 'pending', 'pending'])

    queue.release(a.queueId as never)
    await flush()
    expect([b.settled(), c.settled()]).toEqual(['admitted', 'pending'])
    expect(queue.listAll().find(e => e.queueId === c.queueId)?.position).toBe(1)

    queue.release(b.queueId as never)
    await flush()
    expect(c.settled()).toBe('admitted')
  })

  it('with limit 3, admits the first three immediately and queues the rest with correct positions', async () => {
    const queue = new AdmissionQueue(3)
    const entries = Array.from({ length: 5 }, () => admit(queue))
    await flush()

    expect(entries.map(e => e.settled())).toEqual(['admitted', 'admitted', 'admitted', 'pending', 'pending'])
    expect(entries.map(e => e.position)).toEqual([0, 0, 0, 1, 2])
    const snapshot = queue.listAll()
    expect(snapshot.filter(e => e.state === 'running')).toHaveLength(3)
    expect(snapshot.filter(e => e.state === 'waiting').map(e => e.position)).toEqual([1, 2])
  })

  it('pumps the next waiting entry on release', async () => {
    const queue = new AdmissionQueue(2)
    const [a, b, c, d] = [admit(queue), admit(queue), admit(queue), admit(queue)]
    await flush()
    expect([a.settled(), b.settled(), c.settled(), d.settled()]).toEqual(['admitted', 'admitted', 'pending', 'pending'])

    queue.release(a.queueId as never)
    await flush()
    expect(c.settled()).toBe('admitted')
    expect(d.settled()).toBe('pending')

    queue.release(b.queueId as never)
    await flush()
    expect(d.settled()).toBe('admitted')
  })

  it('limit 0 means unlimited: every call is admitted at once but still counted', async () => {
    const queue = new AdmissionQueue(0)
    const entries = Array.from({ length: 4 }, () => admit(queue))
    await flush()
    expect(entries.every(e => e.settled() === 'admitted')).toBe(true)
    expect(queue.listAll().filter(e => e.state === 'running')).toHaveLength(4)
  })
})

describe('AdmissionQueue — abort', () => {
  it('withdraws a waiting entry on abort, rejects its admitted, and renumbers the rest', async () => {
    const queue = new AdmissionQueue(1)
    const holder = admit(queue)
    const controllerB = new AbortController()
    const b = admit(queue, { signal: controllerB.signal })
    const c = admit(queue)
    await flush()
    expect([b.position, c.position]).toEqual([1, 2])

    controllerB.abort(new Error('client cancelled'))
    await flush()
    expect(b.settled()).toBe('rejected')
    expect(queue.listAll().map(e => e.queueId)).not.toContain(b.queueId)
    expect(queue.listAll().find(e => e.queueId === c.queueId)?.position).toBe(1)

    queue.release(holder.queueId as never)
    await flush()
    expect(c.settled()).toBe('admitted')
  })

  it('an already-aborted signal never joins the queue and rejects immediately', async () => {
    const queue = new AdmissionQueue(1)
    const aborted = AbortSignal.abort(new Error('gone'))
    const e = admit(queue, { signal: aborted })
    await flush()
    expect(e.settled()).toBe('rejected')
    expect(queue.listAll()).toHaveLength(0)
  })

  it('does not touch a running entry when its signal aborts (release owns that path)', async () => {
    const queue = new AdmissionQueue(1)
    const controller = new AbortController()
    const running = admit(queue, { signal: controller.signal })
    const waiter = admit(queue)
    await flush()
    expect(running.settled()).toBe('admitted')

    controller.abort(new Error('mid-stream cancel'))
    await flush()
    // The abort listener ignored the running entry; the slot is still held.
    expect(queue.listAll().find(e => e.queueId === running.queueId)?.state).toBe('running')
    expect(waiter.settled()).toBe('pending')

    // The listener's finally would call release; simulate that.
    queue.release(running.queueId as never)
    await flush()
    expect(waiter.settled()).toBe('admitted')
  })
})

describe('AdmissionQueue — setLimit', () => {
  it('raising the limit pumps waiters up to the new ceiling immediately', async () => {
    const queue = new AdmissionQueue(1)
    const entries = Array.from({ length: 4 }, () => admit(queue))
    await flush()
    expect(entries.map(e => e.settled())).toEqual(['admitted', 'pending', 'pending', 'pending'])

    queue.setLimit(3)
    await flush()
    expect(entries.map(e => e.settled())).toEqual(['admitted', 'admitted', 'admitted', 'pending'])
  })

  it('lowering the limit does not interrupt running work and pauses admission until running drains', async () => {
    const queue = new AdmissionQueue(3)
    const [a, b, c, d] = [admit(queue), admit(queue), admit(queue), admit(queue)]
    await flush()
    expect([a.settled(), b.settled(), c.settled()]).toEqual(['admitted', 'admitted', 'admitted'])

    queue.setLimit(1)
    await flush()
    // Three still running, none preempted; d stays waiting.
    expect(queue.listAll().filter(e => e.state === 'running')).toHaveLength(3)
    expect(d.settled()).toBe('pending')

    queue.release(a.queueId as never)
    queue.release(b.queueId as never)
    await flush()
    // running is 1, still at the ceiling -> d not admitted yet.
    expect(d.settled()).toBe('pending')

    queue.release(c.queueId as never)
    await flush()
    expect(d.settled()).toBe('admitted')
  })
})

describe('AdmissionQueue — reorder', () => {
  it('applies the admin order to waiting entries, keeping FIFO for the ones it omits', async () => {
    const queue = new AdmissionQueue(1)
    const holder = admit(queue)
    const [w1, w2, w3] = [admit(queue), admit(queue), admit(queue)]
    await flush()
    expect(queue.listAll().filter(e => e.state === 'waiting').map(e => e.queueId))
      .toEqual([w1.queueId, w2.queueId, w3.queueId])

    // Name only w3 then w2; w1 (unnamed) keeps FIFO behind them.
    queue.reorder([w3.queueId, w2.queueId])
    expect(queue.listAll().filter(e => e.state === 'waiting').map(e => e.queueId))
      .toEqual([w3.queueId, w2.queueId, w1.queueId])
    expect(queue.listAll().filter(e => e.state === 'waiting').map(e => e.position)).toEqual([1, 2, 3])

    queue.release(holder.queueId as never)
    await flush()
    expect(w3.settled()).toBe('admitted')
    expect([w1.settled(), w2.settled()]).toEqual(['pending', 'pending'])
  })

  it('ignores unknown ids and running ids, and an empty order restores FIFO', async () => {
    const queue = new AdmissionQueue(1)
    const running = admit(queue)
    const [w1, w2] = [admit(queue), admit(queue)]
    await flush()

    queue.reorder([w2.queueId, running.queueId, 'no-such-id'])
    expect(queue.listAll().filter(e => e.state === 'waiting').map(e => e.queueId)).toEqual([w2.queueId, w1.queueId])

    queue.reorder([])
    expect(queue.listAll().filter(e => e.state === 'waiting').map(e => e.queueId)).toEqual([w1.queueId, w2.queueId])
  })

  it('never lets a reordered waiting entry seize a running slot', async () => {
    const queue = new AdmissionQueue(1)
    const running = admit(queue)
    const waiter = admit(queue)
    await flush()

    queue.reorder([waiter.queueId])
    await flush()
    // Ceiling is full; the reordered entry is first in line but still waiting.
    expect(waiter.settled()).toBe('pending')
    expect(queue.listAll().find(e => e.queueId === waiter.queueId)).toMatchObject({ state: 'waiting', position: 1 })

    queue.release(running.queueId as never)
    await flush()
    expect(waiter.settled()).toBe('admitted')
  })

  it('places a newly enqueued waiter behind the manually ordered ones', async () => {
    const queue = new AdmissionQueue(1)
    const holder = admit(queue)
    const [w1, w2] = [admit(queue), admit(queue)]
    await flush()
    queue.reorder([w2.queueId, w1.queueId])
    const w3 = admit(queue)
    await flush()
    expect(queue.listAll().filter(e => e.state === 'waiting').map(e => e.queueId))
      .toEqual([w2.queueId, w1.queueId, w3.queueId])
    expect(holder).toBeDefined()
  })
})

describe('AdmissionQueue — listAll and drain', () => {
  it('listAll returns manually-ordered-then-FIFO waiting then running, with no signal/promise fields', async () => {
    const queue = new AdmissionQueue(1)
    const running = admit(queue, { sessionId: 'session-run' })
    const [w1, w2] = [admit(queue, { sessionId: 'session-w1' }), admit(queue)]
    await flush()
    queue.reorder([w2.queueId])

    const all = queue.listAll()
    expect(all.map(e => e.state)).toEqual(['waiting', 'waiting', 'running'])
    expect(all.map(e => e.queueId)).toEqual([w2.queueId, w1.queueId, running.queueId])
    expect(all.map(e => e.position)).toEqual([1, 2, 0])
    for (const snapshot of all) {
      expect(Object.keys(snapshot).sort()).toEqual(
        snapshot.sessionId === undefined
          ? ['enqueuedAt', 'position', 'queueId', 'state']
          : ['enqueuedAt', 'position', 'queueId', 'sessionId', 'state'],
      )
    }
    expect(queue.positionFor('session-w1' as SessionId)).toEqual({ position: 2, state: 'waiting' })
    expect(queue.positionFor('session-run' as SessionId)).toEqual({ position: 0, state: 'running' })
    expect(queue.positionFor('session-absent' as SessionId)).toBeUndefined()
  })

  it('drain clears every waiting entry and rejects their admitted promises', async () => {
    const queue = new AdmissionQueue(1)
    const running = admit(queue)
    const [w1, w2] = [admit(queue), admit(queue)]
    await flush()
    expect([w1.settled(), w2.settled()]).toEqual(['pending', 'pending'])

    queue.drain('shutting down')
    await flush()
    expect([w1.settled(), w2.settled()]).toEqual(['rejected', 'rejected'])
    expect(queue.listAll().filter(e => e.state === 'waiting')).toHaveLength(0)
    // The running entry is untouched; its own release cleans it up.
    expect(queue.listAll().find(e => e.queueId === running.queueId)?.state).toBe('running')
  })
})

describe('AdmissionQueue — onChange and audit', () => {
  it('publishes position moves and a single running notice per entry', async () => {
    const queue = new AdmissionQueue(1)
    const changes: PositionChange[] = []
    queue.onChange(change => changes.push(change))

    const running = admit(queue)
    const w1 = admit(queue)
    const w2 = admit(queue)
    await flush()

    // running -> one 'running'; w1 at 1; w2 at 2.
    expect(changes.filter(c => c.state === 'running').map(c => c.queueId)).toEqual([running.queueId])
    expect(changes.filter(c => c.queueId === w1.queueId).map(c => c.position)).toEqual([1])
    expect(changes.filter(c => c.queueId === w2.queueId).map(c => c.position)).toEqual([2])

    changes.length = 0
    queue.release(running.queueId as never)
    await flush()
    // w1 admitted -> one 'running'; w2 moved 2 -> 1.
    expect(changes.filter(c => c.queueId === w1.queueId)).toEqual([
      { queueId: w1.queueId, position: 0, state: 'running' },
    ])
    expect(changes.filter(c => c.queueId === w2.queueId)).toEqual([
      { queueId: w2.queueId, position: 1, state: 'waiting' },
    ])
  })

  it('audit() stamps the record with a timestamp and hands it to the sink', () => {
    const sink = vi.fn<(line: QueueAuditLine) => void>()
    const queue = new AdmissionQueue(1, sink)
    queue.audit({
      action: 'reorder',
      operator: { userId: 'ldap:uuid', username: 'admin' },
      order: ['q2', 'q1'],
    })
    expect(sink).toHaveBeenCalledOnce()
    const line = sink.mock.calls[0]![0]
    expect(line).toMatchObject({
      action: 'reorder',
      operator: { userId: 'ldap:uuid', username: 'admin' },
      order: ['q2', 'q1'],
    })
    expect(typeof line.ts).toBe('number')
  })
})
