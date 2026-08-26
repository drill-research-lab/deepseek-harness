/**
 * Regression: `SessionCorpus` narrowed PERSISTED headers by owner (`owned()`)
 * but merged LIVE sessions (`ctx.sessions.list()`/`.get()`) unfiltered —
 * `listSessions()`'s live merge, and `load()`'s/`projectMany()`'s direct id
 * lookups, served any live session in the process regardless of owner. This
 * is consumed by the model-facing `list_agents`/session-search tools and by
 * `SessionQueryEngine.readSession()`, so a caller who knew (or could search
 * for) a foreign owner's live session id could read its full content.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { OwnershipService } from '@deepseek-ai/dsh-ownership'
import type { OwnerPrincipal, OwnerRoot, UserHome } from '@deepseek-ai/dsh-ownership'
import { TestSessionQueryEngine } from './test-service.ts'

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

async function setup(): Promise<{ ctx: Context; ownership: TestOwnership }> {
  const ctx = new Context()
  await ctx.plugin(TestOwnership)
  const ownership = ctx.ownership as TestOwnership
  await ctx.plugin(SessionStore)
  await ctx.plugin(TestSessionQueryEngine)
  return { ctx, ownership }
}

describe('SessionCorpus live-session ownership isolation', () => {
  it('omits a foreign owner\'s live session from listSessions()', async () => {
    const { ctx, ownership } = await setup()
    ownership.principal = alice
    ctx.sessions.create(SessionId('alice-live'))

    ownership.principal = bob
    const records = await ctx.sessionQuery.listSessions()
    expect(records).toEqual([])
  })

  it('refuses to load a foreign owner\'s live session by known id', async () => {
    const { ctx, ownership } = await setup()
    ownership.principal = alice
    const aliceSession = ctx.sessions.create(SessionId('alice-secret'))
    aliceSession.append('user/message', {
      id: 'm1', role: 'user', createdAt: 1,
      content: [{ type: 'text', text: 'confidential' }],
      source: { kind: 'user' },
    } as never, { surfaceOp: 'append' })

    ownership.principal = bob
    await expect(ctx.sessionQuery.readSession(aliceSession.id)).rejects.toThrow()
  })
})
