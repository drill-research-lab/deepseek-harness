/**
 * The `session/llm-queue` mux push frame: the host ApiProxy subscribes to
 * `ctx.llmAdmissionQueue.onChange` and forwards each position change to the
 * mux consumers authorized for that session, mints a baseline from
 * `positionFor` when the stream opens, and stays inert when the admission
 * queue plugin is not composed.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type {
  LlmAdmissionQueueService, PositionChange, QueueEntryState,
} from '@deepseek-ai/dsh-llm-admission-queue/types'
import type { MuxFrame, RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'

/** A driveable fake admission-queue service: `fire()` invokes onChange listeners; `place` seeds positionFor. */
class FakeAdmissionQueue {
  private readonly listeners = new Set<(change: PositionChange) => void>()
  private readonly places = new Map<string, { position: number; state: QueueEntryState }>()

  seed(sessionId: string, position: number, state: QueueEntryState): void {
    this.places.set(sessionId, { position, state })
  }

  positionFor(sessionId: string): { position: number; state: QueueEntryState } | undefined {
    return this.places.get(sessionId)
  }

  onChange(cb: (change: PositionChange) => void): () => void {
    this.listeners.add(cb)
    return () => { this.listeners.delete(cb) }
  }

  fire(change: PositionChange): void {
    for (const cb of [...this.listeners]) cb(change)
  }

  reorder(): void { /* unused here */ }
  listAll(): [] { return [] }
  audit(): void { /* unused here */ }

  get service(): LlmAdmissionQueueService {
    return this
  }
}

async function harness(queue?: FakeAdmissionQueue): Promise<{ ctx: Context; sessionA: Session; sessionB: Session }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentRegistry)
  if (queue !== undefined) ctx.provide('llmAdmissionQueue', queue.service)
  const sessionA = ctx.sessions.create()
  const sessionB = ctx.sessions.create()
  for (const session of [sessionA, sessionB]) {
    ctx.agents.register({
      id: session.id, session, status: 'idle', ctx,
      inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    } as Agent)
  }
  return { ctx, sessionA, sessionB }
}

const api = (ctx: Context) =>
  createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })

const yieldInject = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

/** Drain frames until `predicate` is satisfied or the abort fires, then return everything seen. */
async function collect(
  iterable: AsyncIterable<RpcRequest<MuxFrame>>,
  abort: AbortController,
  stopWhen: (frames: MuxFrame[]) => boolean,
): Promise<MuxFrame[]> {
  const frames: MuxFrame[] = []
  const drained = (async () => {
    for await (const envelope of iterable) {
      frames.push(envelope.payload)
      if (stopWhen(frames)) abort.abort()
    }
  })().catch(() => undefined)
  await drained
  return frames
}

type LlmQueueFrame = Extract<MuxFrame, { type: 'session/llm-queue' }>
const llmQueueFrames = (frames: MuxFrame[]): LlmQueueFrame[] =>
  frames.filter((f): f is LlmQueueFrame => f.type === 'session/llm-queue')

describe('session/llm-queue push frame', () => {
  it('broadcasts a frame carrying the changed session, position, and state', async () => {
    const queue = new FakeAdmissionQueue()
    const { ctx, sessionA } = await harness(queue)
    const proxy = api(ctx)
    await yieldInject()

    const abort = new AbortController()
    const stream = proxy.events.mux({ rpcId: RpcId('t-lq-1'), payload: {} }, abort.signal)
    const collected = collect(stream, abort, frames => llmQueueFrames(frames).length >= 2)

    queue.fire({ queueId: 'q1' as never, sessionId: sessionA.id, position: 2, state: 'waiting' })
    queue.fire({ queueId: 'q1' as never, sessionId: sessionA.id, position: 0, state: 'running' })

    expect(llmQueueFrames(await collected)).toEqual([
      { type: 'session/llm-queue', sessionId: sessionA.id, position: 2, state: 'waiting' },
      { type: 'session/llm-queue', sessionId: sessionA.id, position: 0, state: 'running' },
    ])
  })

  it('tags the frame with the session that changed, not another', async () => {
    const queue = new FakeAdmissionQueue()
    const { ctx, sessionA, sessionB } = await harness(queue)
    const proxy = api(ctx)
    await yieldInject()

    const abort = new AbortController()
    const stream = proxy.events.mux({ rpcId: RpcId('t-lq-2'), payload: {} }, abort.signal)
    const collected = collect(stream, abort, frames => llmQueueFrames(frames).length >= 1)

    queue.fire({ queueId: 'qB' as never, sessionId: sessionB.id, position: 1, state: 'waiting' })

    const [only] = llmQueueFrames(await collected)
    expect(only?.sessionId).toBe(sessionB.id)
    expect(only?.sessionId).not.toBe(sessionA.id)
  })

  it('drops a change with no sessionId or for a session that is not live', async () => {
    const queue = new FakeAdmissionQueue()
    const { ctx, sessionA } = await harness(queue)
    const proxy = api(ctx)
    await yieldInject()

    const abort = new AbortController()
    const stream = proxy.events.mux({ rpcId: RpcId('t-lq-3'), payload: {} }, abort.signal)
    // Stop once a real session/event lands so the collector always terminates.
    const collected = collect(stream, abort, frames => frames.some(f => f.type === 'session/event'))

    queue.fire({ queueId: 'aux' as never, position: 1, state: 'waiting' }) // no sessionId
    queue.fire({ queueId: 'ghost' as never, sessionId: 'session-not-live' as never, position: 1, state: 'waiting' })
    sessionA.append('turn/start', { turn: 1 })

    expect(llmQueueFrames(await collected)).toHaveLength(0)
  })

  it('mints a baseline from positionFor for a session already in the queue', async () => {
    const queue = new FakeAdmissionQueue()
    const { ctx, sessionA, sessionB } = await harness(queue)
    queue.seed(sessionA.id, 3, 'waiting')
    // sessionB is deliberately not seeded -> no baseline frame for it.
    const proxy = api(ctx)
    await yieldInject()

    const abort = new AbortController()
    const stream = proxy.events.mux({ rpcId: RpcId('t-lq-4'), payload: {} }, abort.signal)
    const frames = await collect(stream, abort, f => llmQueueFrames(f).length >= 1)

    expect(llmQueueFrames(frames)).toEqual([
      { type: 'session/llm-queue', sessionId: sessionA.id, position: 3, state: 'waiting' },
    ])
    expect(llmQueueFrames(frames).some(f => f.sessionId === sessionB.id)).toBe(false)
  })

  it('emits no session/llm-queue frame and does not disturb other frames when the plugin is absent', async () => {
    const { ctx, sessionA } = await harness() // no llmAdmissionQueue provided
    const proxy = api(ctx)
    await yieldInject()

    const abort = new AbortController()
    const stream = proxy.events.mux({ rpcId: RpcId('t-lq-5'), payload: {} }, abort.signal)
    const collected = collect(stream, abort, frames =>
      frames.filter(f => f.type === 'session/event').length >= 2)

    sessionA.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    sessionA.append('turn/start', { turn: 1 })

    const frames = await collected
    expect(llmQueueFrames(frames)).toHaveLength(0)
    expect(frames.filter(f => f.type === 'session/event').length).toBeGreaterThanOrEqual(2)
  })
})
