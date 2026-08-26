/**
 * `ownedAgent`/`ownedAgents` narrow `AgentRegistry.get()`/`list()`'s
 * unfiltered results for a request-facing caller. `get()`/`list()` themselves
 * stay unfiltered (trusted internal machinery — lifecycle, lineage, and
 * identity checks on an agent the caller already holds — depends on seeing
 * every live agent); these tests cover the one seam that MUST fail closed.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { OwnershipService } from '@deepseek-ai/dsh-ownership'
import type { OwnerPrincipal, OwnerRoot, UserHome } from '@deepseek-ai/dsh-ownership'
import { Session, SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import AgentRegistry, { Inbox, ownedAgent, ownedAgents } from '../src/index.ts'
import type { Agent } from '../src/index.ts'

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

/** A minimal live Agent whose session carries the given durable owner. */
function ownedStubAgent(rawId: string, ownerUserId?: OwnerPrincipal['userId']): Agent {
  const id = SessionId(rawId)
  const header: SessionHeader = {
    version: SESSION_FORMAT_VERSION,
    id,
    createdAt: 1_700_000_000_000,
    ...ownerUserId === undefined ? {} : { ownerUserId },
  }
  const session = Session.create(id, [], header)
  const agent: Agent = {
    id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    ctx: new Context(),
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  return agent
}

describe('ownedAgent / ownedAgents', () => {
  it('passes every live agent through unfiltered when no ownership service is mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    const agent = ownedStubAgent('single-tenant')
    ctx.agents.register(agent)

    expect(ownedAgent(ctx, agent.id)).toBe(agent)
    expect(ownedAgents(ctx)).toEqual([agent])
  })

  it('fails closed rather than exposing every agent when ownership is mounted but no principal is in scope', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(TestOwnership)
    const agent = ownedStubAgent('alice-agent', alice.userId)
    ctx.agents.register(agent)

    // Regression for the fail-open bug this seam replaces: absent a request
    // principal, the unfiltered get()/list() would otherwise leak every
    // owner's live agents to whatever background/misconfigured caller asks.
    expect(ownedAgent(ctx, agent.id)).toBeUndefined()
    expect(ownedAgents(ctx)).toEqual([])
  })

  it('narrows to the current principal\'s own agents and denies a foreign owner\'s', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    const ownershipFiber = ctx.plugin(TestOwnership)
    await ownershipFiber
    const ownership = ctx.ownership as TestOwnership

    const aliceAgent = ownedStubAgent('alice-owned', alice.userId)
    const bobAgent = ownedStubAgent('bob-owned', bob.userId)
    ctx.agents.register(aliceAgent)
    ctx.agents.register(bobAgent)

    ownership.principal = bob
    // Bob cannot resolve Alice's known session id through the owned seam.
    expect(ownedAgent(ctx, aliceAgent.id)).toBeUndefined()
    expect(ownedAgent(ctx, bobAgent.id)).toBe(bobAgent)
    expect(ownedAgents(ctx)).toEqual([bobAgent])

    ownership.principal = alice
    expect(ownedAgent(ctx, bobAgent.id)).toBeUndefined()
    expect(ownedAgents(ctx)).toEqual([aliceAgent])
  })
})
