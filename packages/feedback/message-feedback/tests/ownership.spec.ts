/**
 * Cross-owner isolation for message feedback: the service holds no owner
 * check of its own, deliberately, and instead trusts `ctx.sessions`'s
 * owner-scoped lookup (see `inspectSession()`). These tests prove that trust
 * is well-founded end to end through the public Remote surface.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import { appendMessageFixture, setupHarness, type TestHarness } from './helpers.ts'
import type { OwnerPrincipal } from '@deepseek-ai/dsh-ownership'

const harnesses: TestHarness[] = []

async function harness(): Promise<TestHarness> {
  const value = await setupHarness(64, { ownership: true })
  harnesses.push(value)
  return value
}

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(harnesses.splice(0).map(value => value.dispose()))
})

const alice = { userId: 'ldap:test-alice' as OwnerPrincipal['userId'], source: 'request' as const }
const bob = { userId: 'ldap:test-bob' as OwnerPrincipal['userId'], source: 'request' as const }

describe('MessageFeedbackService cross-owner isolation', () => {
  async function aliceSession(harness: TestHarness) {
    const { ctx, persistence, ownership } = harness
    ownership!.principal = alice
    ctx.on('session/flush', (current) => { persistence.persist(current) })
    const session = ctx.sessions.create()
    const fixture = appendMessageFixture(session)
    return { session, messageId: fixture.assistantMessageIds[0] }
  }

  it('denies list/put/delete on a session Bob does not own, with not-found — not a leak', async () => {
    const value = await harness()
    const { ctx, ownership } = value
    const { session, messageId } = await aliceSession(value)

    ownership!.principal = alice
    const created = await ctx.messageFeedback.put({
      sessionId: session.id, messageId, rating: 'positive', ifVersion: null,
    })
    if (!created.ok) throw new Error(`expected feedback item, got ${created.error.code}`)

    ownership!.principal = bob
    await expect(ctx.messageFeedback.list({ sessionId: session.id })).resolves.toEqual({
      ok: false,
      error: { code: 'session-not-found', sessionId: session.id },
    })
    await expect(ctx.messageFeedback.put({
      sessionId: session.id, messageId, rating: 'negative', ifVersion: null,
    })).resolves.toEqual({
      ok: false,
      error: { code: 'session-not-found', sessionId: session.id },
    })
    await expect(ctx.messageFeedback.delete({
      sessionId: session.id, messageId, ifVersion: created.value.version,
    })).resolves.toEqual({
      ok: false,
      error: { code: 'session-not-found', sessionId: session.id },
    })

    // Alice's own feedback survived Bob's denied attempts untouched.
    ownership!.principal = alice
    const listed = await ctx.messageFeedback.list({ sessionId: session.id })
    if (!listed.ok) throw new Error(`expected list success, got ${listed.error.code}`)
    expect(listed.value.items).toEqual([created.value])
  })

  it('never resolves a foreign session even for an unrelated message id Bob invents', async () => {
    const value = await harness()
    const { ctx, ownership } = value
    const { session } = await aliceSession(value)

    ownership!.principal = bob
    await expect(ctx.messageFeedback.put({
      sessionId: session.id,
      messageId: 'bob-guessed-message-id' as MessageId,
      rating: 'positive',
      ifVersion: null,
    })).resolves.toMatchObject({ ok: false, error: { code: 'session-not-found' } })
  })
})
