/**
 * `ownedSession`/`ownedSessions` narrow `SessionStore.get()`/`list()`'s
 * unfiltered results for a request-facing caller. `get()`/`list()` themselves
 * stay unfiltered (trusted internal machinery depends on seeing every live
 * session); these tests cover the one seam that MUST fail closed.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { OwnershipService } from '@deepseek-ai/dsh-ownership'
import type { OwnerPrincipal, OwnerRoot, UserHome } from '@deepseek-ai/dsh-ownership'
import SessionStore, { ownedSession, ownedSessions, SessionId } from '../src/index.ts'

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

describe('ownedSession / ownedSessions', () => {
  it('passes every live session through unfiltered when no ownership service is mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('single-tenant'))

    expect(ownedSession(ctx, session.id)).toBe(session)
    expect(ownedSessions(ctx)).toEqual([session])
  })

  it('fails closed rather than exposing every session when ownership is mounted but no principal is in scope', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const ownershipFiber = ctx.plugin(TestOwnership)
    await ownershipFiber
    const ownership = ctx.ownership as TestOwnership

    ownership.principal = alice
    const aliceSession = ctx.sessions.create(SessionId('alice-session'))

    // Regression for the fail-open bug this seam replaces: absent a request
    // principal, the unfiltered get()/list() would otherwise leak every
    // owner's live sessions to whatever background/misconfigured caller asks.
    ownership.principal = undefined
    expect(ownedSession(ctx, aliceSession.id)).toBeUndefined()
    expect(ownedSessions(ctx)).toEqual([])
  })

  it('narrows to the current principal\'s own sessions and denies a foreign owner\'s', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const ownershipFiber = ctx.plugin(TestOwnership)
    await ownershipFiber
    const ownership = ctx.ownership as TestOwnership

    ownership.principal = alice
    const aliceSession = ctx.sessions.create(SessionId('alice-owned'))
    ownership.principal = bob
    const bobSession = ctx.sessions.create(SessionId('bob-owned'))

    // Bob cannot resolve Alice's known session id through the owned seam.
    expect(ownedSession(ctx, aliceSession.id)).toBeUndefined()
    expect(ownedSession(ctx, bobSession.id)).toBe(bobSession)
    expect(ownedSessions(ctx)).toEqual([bobSession])

    ownership.principal = alice
    expect(ownedSession(ctx, bobSession.id)).toBeUndefined()
    expect(ownedSessions(ctx)).toEqual([aliceSession])
  })

  it('reconstructs visibility for a background principal derived from a durable owner id', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const ownershipFiber = ctx.plugin(TestOwnership)
    await ownershipFiber
    const ownership = ctx.ownership as TestOwnership

    ownership.principal = alice
    const aliceSession = ctx.sessions.create(SessionId('alice-background'))

    // Trusted internal machinery reconstructing a principal from the
    // session's own persisted owner (not client-supplied) sees it, even
    // outside any live request scope.
    ownership.principal = ownership.backgroundPrincipal(alice.userId)
    expect(ownedSession(ctx, aliceSession.id)).toBe(aliceSession)
  })
})
