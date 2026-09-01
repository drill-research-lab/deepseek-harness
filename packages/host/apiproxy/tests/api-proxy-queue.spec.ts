import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { AuthService, authenticatedUserId, type AuthenticatedUser } from '@deepseek-ai/dsh-auth'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { LlmAdmissionQueueService } from '@deepseek-ai/dsh-llm-admission-queue/types'
import { createApiProxy, RpcId, type RpcRequest } from '@deepseek-ai/dsh-host-apiproxy'

class TestAuthService extends AuthService {
  authenticateRequest(): Promise<AuthenticatedUser | undefined> {
    return Promise.resolve(undefined)
  }
}

const ADMIN: AuthenticatedUser = { userId: authenticatedUserId('ldap:admin'), username: 'Admin', isAdmin: true }
const PLAIN: AuthenticatedUser = { userId: authenticatedUserId('ldap:plain'), username: 'Plain', isAdmin: false }

const listRequest: RpcRequest<{}> = { rpcId: RpcId('q-list'), payload: {} }
const reorderRequest = (orderedQueueIds: string[]): RpcRequest<{ orderedQueueIds: string[] }> =>
  ({ rpcId: RpcId('q-reorder'), payload: { orderedQueueIds } })

interface MutableEntry {
  queueId: string
  position: number
  state: 'waiting' | 'running'
  enqueuedAt: number
  sessionId?: string
}

/** A fake ctx.llmAdmissionQueue whose reorder() applies the given waiting order. */
function fakeQueue(initial: MutableEntry[]): {
  service: LlmAdmissionQueueService
  listAll: ReturnType<typeof vi.fn>
  reorder: ReturnType<typeof vi.fn>
  audit: ReturnType<typeof vi.fn>
} {
  let entries = initial.map(entry => ({ ...entry }))
  const reorder = vi.fn((orderedQueueIds: readonly string[]): void => {
    const rank = new Map(orderedQueueIds.map((id, index) => [id, index] as const))
    const waiting = entries.filter(e => e.state === 'waiting').sort((a, b) => {
      const ra = rank.get(a.queueId)
      const rb = rank.get(b.queueId)
      if (ra !== undefined && rb !== undefined) return ra - rb
      if (ra !== undefined) return -1
      if (rb !== undefined) return 1
      return a.enqueuedAt - b.enqueuedAt
    })
    waiting.forEach((entry, index) => { entry.position = index + 1 })
    entries = [...waiting, ...entries.filter(e => e.state === 'running')]
  })
  const listAll = vi.fn(() => entries.map(entry => ({ ...entry })))
  const audit = vi.fn()
  const positionFor = vi.fn()
  const onChange = vi.fn(() => () => {})
  return {
    service: { listAll, reorder, audit, positionFor, onChange } as unknown as LlmAdmissionQueueService,
    listAll,
    reorder,
    audit,
  }
}

async function harness(queue?: LlmAdmissionQueueService) {
  const ctx = new Context()
  await ctx.plugin(TestAuthService)
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  if (queue !== undefined) ctx.provide('llmAdmissionQueue', queue)
  return {
    ctx,
    api: createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
      cwd: '/tmp',
    }),
  }
}

const SNAPSHOT: MutableEntry[] = [
  { queueId: 'q-run', position: 0, state: 'running', enqueuedAt: 100 },
  { queueId: 'q-front', position: 1, state: 'waiting', enqueuedAt: 200, sessionId: 'session-front' },
  { queueId: 'q-mid', position: 2, state: 'waiting', enqueuedAt: 300, sessionId: 'session-mid' },
]

describe('queue.list', () => {
  it('returns the admission-queue snapshot for an admin caller (ownerUsername absent when the session is not live)', async () => {
    const q = fakeQueue(SNAPSHOT)
    const { ctx, api } = await harness(q.service)
    await expect(ctx.auth.runAs(ADMIN, () => api.queue.list(listRequest))).resolves.toEqual({
      rpcId: 'q-list',
      result: {
        ok: true,
        value: {
          entries: [
            { queueId: 'q-run', position: 0, state: 'running', enqueuedAt: 100 },
            { queueId: 'q-front', position: 1, state: 'waiting', enqueuedAt: 200, sessionId: 'session-front' },
            { queueId: 'q-mid', position: 2, state: 'waiting', enqueuedAt: 300, sessionId: 'session-mid' },
          ],
        },
      },
    })
    expect(q.listAll).toHaveBeenCalledTimes(1)
  })

  it('refuses a non-admin with forbidden before touching the queue', async () => {
    const q = fakeQueue(SNAPSHOT)
    const { ctx, api } = await harness(q.service)
    const response = await ctx.auth.runAs(PLAIN, () => api.queue.list(listRequest))
    expect(response.result).toEqual({
      ok: false,
      error: { code: 'forbidden', message: 'queue.list requires an admin identity', details: {} },
    })
    expect(q.listAll).not.toHaveBeenCalled()
  })

  it('throws outside an authenticated request scope (the carrier owns the 401)', async () => {
    const q = fakeQueue(SNAPSHOT)
    const { api } = await harness(q.service)
    await expect(api.queue.list(listRequest)).rejects.toThrow(/authenticated request scope/)
    expect(q.listAll).not.toHaveBeenCalled()
  })
})

describe('queue.reorder', () => {
  it('forwards the order to the queue, acknowledges empty, and audits with the caller and the order', async () => {
    const q = fakeQueue(SNAPSHOT)
    const { ctx, api } = await harness(q.service)
    const response = await ctx.auth.runAs(ADMIN, () => api.queue.reorder(reorderRequest(['q-mid', 'q-front'])))
    expect(response.result).toEqual({ ok: true, value: {} })
    expect(q.reorder).toHaveBeenCalledWith(['q-mid', 'q-front'])
    expect(q.audit).toHaveBeenCalledTimes(1)
    expect(q.audit).toHaveBeenCalledWith({
      action: 'reorder',
      operator: { userId: 'ldap:admin', username: 'Admin' },
      order: ['q-mid', 'q-front'],
    })
  })

  it('refuses a non-admin with forbidden and never calls reorder or audit', async () => {
    const q = fakeQueue(SNAPSHOT)
    const { ctx, api } = await harness(q.service)
    const response = await ctx.auth.runAs(PLAIN, () => api.queue.reorder(reorderRequest(['q-mid'])))
    expect(response.result).toEqual({
      ok: false,
      error: { code: 'forbidden', message: 'queue.reorder requires an admin identity', details: {} },
    })
    expect(q.reorder).not.toHaveBeenCalled()
    expect(q.audit).not.toHaveBeenCalled()
  })

  it('answers with a clear internal error (no uncaught throw) when the admission queue plugin is absent', async () => {
    const { ctx, api } = await harness() // no llmAdmissionQueue provided
    const response = await ctx.auth.runAs(ADMIN, () => api.queue.reorder(reorderRequest(['q-mid'])))
    expect(response.result).toEqual({
      ok: false,
      error: {
        code: 'internal',
        message: 'the admission queue plugin is not composed in this deployment',
        details: {},
      },
    })
  })
})
