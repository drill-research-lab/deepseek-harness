/**
 * Regression for the A2 cross-owner subagent leak: `prepareListing()` merged
 * `sessions.list()` — every live session in the process, regardless of owner —
 * into the enumeration corpus with no owner filter, so `listChildren()`/
 * `listDescendants()` served a foreign owner's live subagent child to any
 * caller who knew (or guessed) its parent id. Reproduced empirically against
 * real production objects before the fix (Bob read Alice's full child
 * conversation via `subagents.history`); this test pins the fix at the
 * `SubagentRuntime` service boundary those RPC handlers call through.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { OwnershipService } from '@deepseek-ai/dsh-ownership'
import type { OwnerPrincipal, UserHome } from '@deepseek-ai/dsh-ownership'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SubagentRuntime, { seedDescriptorTurn } from '../src/index.ts'

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
}

const alice = { userId: 'ldap:test-alice' as OwnerPrincipal['userId'], source: 'request' as const }
const bob = { userId: 'ldap:test-bob' as OwnerPrincipal['userId'], source: 'request' as const }

function stubAgent(session: ReturnType<Context['sessions']['create']>): Agent {
  return {
    id: session.id,
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
}

async function setup() {
  const ctx = new Context()
  await ctx.plugin(TestOwnership)
  const ownership = ctx.ownership as TestOwnership
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SubagentRuntime)
  return { ctx, ownership }
}

/** Create a live continuable subagent child under `parentId`, owned by whoever is the current principal. */
function createChild(ctx: Context, id: string, parentId: SessionId, label: string): SessionId {
  const childId = SessionId(id)
  const seed = seedDescriptorTurn(childId, undefined, {
    version: 2, mode: 'continuable', provider: 'test', label,
  })
  const child = ctx.sessions.create(childId, { seed, meta: { parentSession: parentId, origin: 'subagent' } })
  ctx.agents.register(stubAgent(child))
  return child.id
}

describe('SubagentRuntime.listChildren / listDescendants ownership', () => {
  it('does not enumerate a foreign owner\'s live child under a known parent id', async () => {
    const { ctx, ownership } = await setup()

    ownership.principal = alice
    const parent = ctx.sessions.create(SessionId('alice-parent'))
    ctx.agents.register(stubAgent(parent))
    createChild(ctx, 'alice-child', parent.id, 'Alice: confidential draft')

    ownership.principal = bob
    await expect(ctx.subagents.listChildren(parent.id)).resolves.toEqual([])
    await expect(ctx.subagents.listDescendants(parent.id)).resolves.toEqual([])

    // Alice still sees her own child.
    ownership.principal = alice
    const entries = await ctx.subagents.listChildren(parent.id)
    expect(entries).toEqual([expect.objectContaining({ kind: 'child', id: SessionId('alice-child') })])
  })

  it('keeps a foreign live child out of the merge even alongside the caller\'s own children', async () => {
    const { ctx, ownership } = await setup()

    ownership.principal = alice
    const parent = ctx.sessions.create(SessionId('shared-parent-id'))
    ctx.agents.register(stubAgent(parent))
    createChild(ctx, 'alice-only-child', parent.id, 'Alice: private task')

    // Bob has no session named "shared-parent-id", but a live session under
    // that exact id exists in-process (Alice's) — Bob must not see its children.
    ownership.principal = bob
    const bobEntries = await ctx.subagents.listChildren(SessionId('shared-parent-id'))
    expect(bobEntries).toEqual([])
  })
})
