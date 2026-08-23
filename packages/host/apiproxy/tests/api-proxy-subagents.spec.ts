import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { OwnershipService } from '@deepseek-ai/dsh-ownership'
import type { OwnerPrincipal, OwnerRoot, UserHome } from '@deepseek-ai/dsh-ownership'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import { SubagentError } from '@deepseek-ai/dsh-subagent'
import { RpcId } from '../src/api/rpc.ts'
import type { RpcRequest } from '../src/api/rpc.ts'
import { createApiProxy } from '../src/api-proxy.ts'

const sid = (value: string): SessionId => value as SessionId
const PARENT = sid('parent')
const CHILD = sid('child')

class TestOwnership extends OwnershipService {
  principal: OwnerPrincipal | undefined

  currentPrincipal(): OwnerPrincipal {
    if (this.principal === undefined) throw new Error('no test owner')
    return this.principal
  }

  currentPrincipalOrUndefined(): OwnerPrincipal | undefined { return this.principal }

  backgroundPrincipal(userId: OwnerPrincipal['userId']): OwnerPrincipal {
    return { userId, source: 'background' }
  }

  resolveUserHome(): Promise<UserHome> {
    throw new Error('not used by these tests')
  }

  resolveOwnerRoot(): Promise<OwnerRoot> {
    throw new Error('not used by these tests')
  }
}

const alice = { userId: 'ldap:test-alice' as OwnerPrincipal['userId'], source: 'request' as const }
const bob = { userId: 'ldap:test-bob' as OwnerPrincipal['userId'], source: 'request' as const }

function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId('subagent-rpc'), payload }
}

async function bench(options: {
  parentLive?: boolean
  childStatus?: 'idle' | 'running'
  entries?: object[]
  followupError?: Error
  interruptError?: Error
  listError?: Error
  /** Persistence forgets the child entirely (the vanished-mid-read race). */
  storedChild?: false
  /** Attach the child to the live session store instead of persistence only. */
  liveChild?: true
  /** Every registered projection unit throws on this child's payloads. */
  projectionsThrow?: true
  historyParent?: SessionId
  /**
   * Mount an ownership service and give the live child a foreign owner, while
   * `listChildren` (mocked, standing in for a hypothetical future catalog-path
   * regression) still reports it as a valid entry. Exercises the independent
   * `ownedSession` check on the live-child branch of `subagents.history` — it
   * must reject even when the catalog verification alone would not.
   */
  ownerMismatch?: true
} = {}) {
  const parent = { id: PARENT }
  const child = options.childStatus === undefined
    ? undefined
    : { id: CHILD, status: options.childStatus }
  const getAgent = vi.fn((id: SessionId) => {
    if (options.parentLive !== false && id === PARENT) return parent
    if (id === CHILD) return child
    return undefined
  })
  const listChildren = vi.fn(() => options.listError === undefined
    ? Promise.resolve(options.entries ?? [
      {
        kind: 'child', id: CHILD, mode: 'continuable', label: 'worker',
        activity: 'inactive', hasChildren: false,
      },
    ])
    : Promise.reject(options.listError))
  const followup = vi.fn((
    _parent: unknown,
    _childId: SessionId,
    _content: unknown,
    _delivery: {
      source: { kind: string; rpcId: RpcId; clientTimeZone?: string }
      signal: AbortSignal
    },
  ) => options.followupError === undefined
    ? Promise.resolve('message-1')
    : Promise.reject(options.followupError))
  const interrupt = vi.fn((
    _targetSessionId: SessionId,
    _authority: { kind: 'user'; parentSessionId: SessionId },
  ) => {
    if (options.interruptError !== undefined) throw options.interruptError
  })
  const childHeader = {
    version: 0, id: CHILD, createdAt: 1, cwd: '/proj', parentSession: options.historyParent ?? PARENT,
    ...options.ownerMismatch === true ? { ownerUserId: alice.userId } : {},
  } satisfies SessionHeader
  const childEvents = [
    { type: 'user/message', seq: 0, time: 1, data: { content: [{ type: 'text', text: 'work' }], source: { kind: 'user' } } },
  ] as unknown as SessionEvent[]
  const inspect = vi.fn(() => Promise.resolve({ meta: childHeader, events: childEvents }))
  const liveBlock = { values: {}, asOfSeq: 3 }
  const coldBlock = { values: {}, asOfSeq: 0 }
  const snapshot = vi.fn(() => {
    if (options.projectionsThrow === true) throw new Error('hostile unit')
    return liveBlock
  })
  const restore = vi.fn(() => {
    if (options.projectionsThrow === true) throw new Error('hostile unit')
    return { snapshot: coldBlock }
  })
  const ctx = new Context()
  if (options.ownerMismatch === true) {
    await ctx.plugin(TestOwnership)
    ;(ctx.ownership as TestOwnership).principal = bob
  }
  ctx.provide('agents', { get: getAgent })
  ctx.provide('subagents', { listChildren, followup, interrupt })
  ctx.provide('sessions', {
    get: (id: SessionId) => (options.liveChild === true || options.ownerMismatch === true) && id === CHILD
      ? { id: CHILD, header: childHeader, events: childEvents }
      : undefined,
  })
  ctx.provide('sessionPersistence', {
    list: () => Promise.resolve(options.storedChild === false ? [] : [childHeader]),
    inspect,
    locate: () => undefined,
  })
  // The gateway's own projection push feed subscribes at construction; the
  // no-op disposer keeps that feed quiet while these tests pin history reads.
  ctx.provide('sessionProjections', {
    snapshot,
    restore,
    onChanged: () => () => {},
    register: () => () => {},
  })
  ctx.provide('userQuestions', { registerProvider: () => () => {} })
  const api = createApiProxy(ctx, {
    defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp',
  })
  return { api, getAgent, listChildren, inspect, snapshot, restore, followup, interrupt, parent }
}

describe('subagent gateway', () => {
  it('lists the complete catalog and reports exact live-parent availability', async () => {
    const { api, listChildren } = await bench({ parentLive: false, entries: [
      {
        kind: 'child', id: CHILD, mode: 'continuable', label: 'worker',
        activity: 'inactive', hasChildren: true,
      },
      {
        kind: 'child', id: sid('one-shot'), mode: 'one-shot',
        activity: 'inactive', hasChildren: false,
      },
      { kind: 'diagnostic', id: sid('bad'), reason: 'corrupt' },
    ] })
    const response = await api.subagents.list(request({ parentSessionId: PARENT }))
    expect(response.rpcId).toBe('subagent-rpc')
    expect(response.result).toMatchObject({
      ok: true,
      value: {
        parentAvailable: false,
        entries: [
          { kind: 'child', mode: 'continuable' },
          { kind: 'child', mode: 'one-shot' },
          { kind: 'diagnostic' },
        ],
      },
    })
    expect(listChildren).toHaveBeenCalledWith(PARENT, undefined)
  })

  it('derives catalog activity from the live child Agent rather than Session residency', async () => {
    const residentIdle = await bench({ childStatus: 'idle', entries: [{
      kind: 'child', id: CHILD, mode: 'continuable', label: 'worker',
      activity: 'running', hasChildren: false,
    }] })
    expect((await residentIdle.api.subagents.list(request({ parentSessionId: PARENT }))).result)
      .toMatchObject({ ok: true, value: { entries: [{ activity: 'inactive' }] } })

    const running = await bench({ childStatus: 'running' })
    expect((await running.api.subagents.list(request({ parentSessionId: PARENT }))).result)
      .toMatchObject({ ok: true, value: { entries: [{ activity: 'running' }] } })
  })

  it('reads a healthy direct child without looking up or activating any Agent', async () => {
    const { api, getAgent, inspect, restore } = await bench()
    const response = await api.subagents.history(request({
      parentSessionId: PARENT, childSessionId: CHILD, mode: 'continuable', maxMessages: 10,
    }))
    expect(response.result).toMatchObject({
      ok: true,
      value: { hasMore: false, events: [{ event: { type: 'user/message', seq: 0 } }] },
    })
    expect(inspect).toHaveBeenCalledWith(CHILD)
    expect(restore).toHaveBeenCalledTimes(1)
    expect(getAgent).not.toHaveBeenCalled()
  })

  it('rejects a live child with a foreign owner even when the catalog reports it as valid', async () => {
    // Regression: `subagents.history`'s live-child branch used to read
    // `ctx.sessions.get(childSessionId)` directly, trusting any live session
    // regardless of owner. This pins the independent `ownedSession` check
    // there — `listChildren` here still (mock-)reports the child as a valid
    // entry, standing in for a hypothetical future regression in the catalog
    // path, so this test only passes if the live-child branch's OWN check
    // rejects the cross-owner read on its own.
    const { api, inspect } = await bench({ ownerMismatch: true })
    const response = await api.subagents.history(request({
      parentSessionId: PARENT, childSessionId: CHILD, mode: 'continuable',
    }))
    expect(response.result).toMatchObject({ ok: false, error: { code: 'subagent-not-found' } })
    // The rejection came from the live-child branch's owner check, not from
    // falling through to a cold inspection that happened to also reject it.
    expect(inspect).not.toHaveBeenCalled()
  })

  it('serves a live child from the in-memory snapshot and the watermark projections', async () => {
    const { api, inspect, snapshot, restore } = await bench({ liveChild: true })
    const response = await api.subagents.history(request({
      parentSessionId: PARENT, childSessionId: CHILD, mode: 'continuable',
    }))
    expect(response.result).toMatchObject({
      ok: true,
      value: { hasMore: false, projections: { asOfSeq: 3 } },
    })
    expect(snapshot).toHaveBeenCalledTimes(1)
    expect(restore).not.toHaveBeenCalled()
    expect(inspect).not.toHaveBeenCalled()
  })

  it('serves the page without projections when a hostile unit breaks the fold', async () => {
    const cold = await bench({ projectionsThrow: true })
    const coldResponse = await cold.api.subagents.history(request({
      parentSessionId: PARENT, childSessionId: CHILD, mode: 'continuable',
    }))
    expect(coldResponse.result).toMatchObject({
      ok: true,
      value: { hasMore: false, events: [{ event: { type: 'user/message', seq: 0 } }] },
    })
    if (coldResponse.result.ok) expect('projections' in coldResponse.result.value).toBe(false)

    const live = await bench({ projectionsThrow: true, liveChild: true })
    const liveResponse = await live.api.subagents.history(request({
      parentSessionId: PARENT, childSessionId: CHILD, mode: 'continuable',
    }))
    expect(liveResponse.result).toMatchObject({
      ok: true,
      value: { hasMore: false, events: [{ event: { type: 'user/message', seq: 0 } }] },
    })
    if (liveResponse.result.ok) expect('projections' in liveResponse.result.value).toBe(false)
    expect(live.snapshot).toHaveBeenCalledTimes(1)
  })

  it('reads one-shot history and rejects an address with the wrong mode', async () => {
    const oneShot = {
      kind: 'child', id: CHILD, mode: 'one-shot', label: 'batch',
      activity: 'inactive', hasChildren: false,
    }
    const { api, inspect } = await bench({ entries: [oneShot] })
    expect((await api.subagents.history(request({
      parentSessionId: PARENT, childSessionId: CHILD, mode: 'one-shot',
    }))).result).toMatchObject({ ok: true })
    expect((await api.subagents.history(request({
      parentSessionId: PARENT, childSessionId: CHILD, mode: 'continuable',
    }))).result).toMatchObject({ ok: false, error: { code: 'subagent-not-found' } })
    expect(inspect).toHaveBeenCalledTimes(1)
  })

  it('rejects a diagnostic address before reading history', async () => {
    const { api, inspect } = await bench({ entries: [
      { kind: 'diagnostic', id: CHILD, reason: 'unsupported' },
    ] })
    const response = await api.subagents.history(request({
      parentSessionId: PARENT, childSessionId: CHILD, mode: 'continuable',
    }))
    expect(response.result).toMatchObject({
      ok: false,
      error: {
        code: 'subagent-catalog-diagnostic',
        details: { parentSessionId: PARENT, childSessionId: CHILD, reason: 'unsupported' },
      },
    })
    expect(inspect).not.toHaveBeenCalled()
  })

  it('maps the missing projections capability to one wire face on list, history, and prompt', async () => {
    const listError = () => new SubagentError(
      'listing subagents requires the sessionProjections registry (load @deepseek-ai/dsh-session-projection)',
      'SUBAGENT_CONTROL_PROJECTIONS_UNAVAILABLE',
    )
    const expected = {
      code: 'internal',
      message: 'subagent catalog is unavailable: this deployment does not mount the sessionProjections registry (load @deepseek-ai/dsh-session-projection)',
    }

    const list = await bench({ listError: listError() })
    expect((await list.api.subagents.list(request({ parentSessionId: PARENT }))).result)
      .toMatchObject({ ok: false, error: expected })

    const history = await bench({ listError: listError() })
    expect((await history.api.subagents.history(request({
      parentSessionId: PARENT, childSessionId: CHILD, mode: 'continuable',
    }))).result).toMatchObject({ ok: false, error: expected })
    expect(history.inspect).not.toHaveBeenCalled()

    const prompt = await bench({ listError: listError() })
    expect((await prompt.api.subagents.prompt(request({
      parentSessionId: PARENT, childSessionId: CHILD, mode: 'continuable', content: [],
    }), new AbortController().signal)).result).toMatchObject({ ok: false, error: expected })
    expect(prompt.followup).not.toHaveBeenCalled()
  })

  it('routes human content through the exact live parent with rpc attribution', async () => {
    const { api, parent, followup } = await bench()
    const content = [{ type: 'text' as const, text: '继续' }]
    const signal = new AbortController().signal
    const response = await api.subagents.prompt(request({
      parentSessionId: PARENT, childSessionId: CHILD, mode: 'continuable', content,
    }), signal)
    expect(response.result).toMatchObject({
      ok: true, value: { messageId: 'message-1' },
    })
    expect(followup).toHaveBeenCalledWith(
      parent,
      CHILD,
      content,
      { source: { kind: 'user', rpcId: RpcId('subagent-rpc') }, signal },
    )
  })

  it('canonicalizes browser-zone provenance before delivering a child prompt', async () => {
    const { api, parent, followup } = await bench()
    const alias = 'US/Pacific'
    const canonical = new Intl.DateTimeFormat('en-US', { timeZone: alias })
      .resolvedOptions().timeZone
    const content = [{ type: 'text' as const, text: 'continue locally' }]
    const signal = new AbortController().signal
    await expect(api.subagents.prompt(request({
      parentSessionId: PARENT,
      childSessionId: CHILD,
      mode: 'continuable',
      content,
      clientTimeZone: alias,
    }), signal)).resolves.toMatchObject({ result: { ok: true } })
    expect(followup).toHaveBeenCalledWith(parent, CHILD, content, {
      source: { kind: 'user', rpcId: RpcId('subagent-rpc'), clientTimeZone: canonical },
      signal,
    })

    const invalid = await api.subagents.prompt(request({
      parentSessionId: PARENT,
      childSessionId: CHILD,
      mode: 'continuable',
      content,
      clientTimeZone: 'Not/A_Real_Zone',
    }), signal)
    expect(invalid.result).toEqual({
      ok: false,
      error: {
        code: 'invalid-time-zone',
        message: 'clientTimeZone must be UTC or a valid IANA Area/Location name',
        details: { value: 'Not/A_Real_Zone' },
      },
    })
    expect(followup).toHaveBeenCalledOnce()
  })

  it('fails before delivery when the parent is absent and maps continuation failures', async () => {
    const absent = await bench({ parentLive: false })
    expect((await absent.api.subagents.prompt(request({
      parentSessionId: PARENT, childSessionId: CHILD, mode: 'continuable', content: [],
    }), new AbortController().signal)).result).toMatchObject({
      ok: false, error: { code: 'subagent-parent-unavailable' },
    })
    expect(absent.listChildren).not.toHaveBeenCalled()

    const failed = await bench({ followupError: new SubagentError('draining', 'DRAINING') })
    expect((await failed.api.subagents.prompt(request({
      parentSessionId: PARENT, childSessionId: CHILD, mode: 'continuable', content: [],
    }), new AbortController().signal)).result).toMatchObject({
      ok: false, error: { code: 'subagent-delivery-unavailable' },
    })
  })

  it('maps history disappearance and hides unexpected backend details', async () => {
    const disappeared = await bench({ storedChild: false })
    expect((await disappeared.api.subagents.history(request({
      parentSessionId: PARENT, childSessionId: CHILD, mode: 'continuable',
    }))).result).toMatchObject({
      ok: false,
      error: {
        code: 'subagent-not-found',
        message: 'subagent disappeared during history read',
        details: { parentSessionId: PARENT, childSessionId: CHILD },
      },
    })

    const catalog = await bench({ listError: new Error('secret descriptor') })
    expect((await catalog.api.subagents.list(request({
      parentSessionId: PARENT,
    }))).result).toMatchObject({
      ok: false,
      error: { code: 'internal', message: 'subagent catalog read failed' },
    })

    const prompt = await bench({ followupError: new Error('secret provider') })
    expect((await prompt.api.subagents.prompt(request({
      parentSessionId: PARENT, childSessionId: CHILD, mode: 'continuable', content: [],
    }), new AbortController().signal)).result).toMatchObject({
      ok: false,
      error: { code: 'internal', message: 'subagent prompt failed' },
    })
  })

  it('interrupts through the core primitive alone while the parent Agent is offline', async () => {
    const { api, interrupt, getAgent, listChildren, inspect } = await bench({ parentLive: false })
    const response = await api.subagents.interrupt(request({
      parentSessionId: PARENT, childSessionId: CHILD, mode: 'continuable' as const,
    }))
    expect(response.rpcId).toBe('subagent-rpc')
    expect(response.result).toEqual({ ok: true, value: { accepted: true } })
    expect(interrupt).toHaveBeenCalledExactlyOnceWith(CHILD, { kind: 'user', parentSessionId: PARENT })
    // No parent-registry, catalog, or history dependency: this is what keeps a
    // live child interruptible after its parent Agent went offline.
    expect(getAgent).not.toHaveBeenCalled()
    expect(listChildren).not.toHaveBeenCalled()
    expect(inspect).not.toHaveBeenCalled()
  })

  it('maps interrupt authorization rejection without touching other services', async () => {
    const { api, listChildren } = await bench({
      interruptError: new SubagentError('secret lineage', 'UNAUTHORIZED'),
    })
    const response = await api.subagents.interrupt(request({
      parentSessionId: PARENT, childSessionId: CHILD, mode: 'continuable' as const,
    }))
    expect(response.result).toEqual({
      ok: false,
      error: {
        code: 'subagent-unauthorized',
        message: 'subagent does not belong to this parent',
        details: { childSessionId: CHILD },
      },
    })
    expect(listChildren).not.toHaveBeenCalled()
  })

  it('hides unexpected interrupt failures behind the internal code', async () => {
    const { api } = await bench({ interruptError: new Error('secret activation state') })
    const response = await api.subagents.interrupt(request({
      parentSessionId: PARENT, childSessionId: CHILD, mode: 'continuable' as const,
    }))
    expect(response.result).toEqual({
      ok: false,
      error: { code: 'internal', message: 'subagent interrupt failed', details: {} },
    })
  })
})
