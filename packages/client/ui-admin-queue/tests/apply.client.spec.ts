/** Admin-only settings registration: registers only for an admin identity, and races cleanly with disposal. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'
import { AdminQueue } from '../src/client/AdminQueue.tsx'

usePinnedBrowserLanguages('zh-TW')

function meResult(isAdmin: boolean) {
  return { rpcId: 'me' as never, result: { ok: true as const, value: { userId: 'u', username: 'Admin', isAdmin } } }
}

async function bench(me: ReturnType<typeof vi.fn>) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  ctx.provide('connection', { api: { auth: { me }, queue: {} }, isLoopback: false } as never)
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-admin-queue apply', () => {
  it('registers the localized admin page once auth.me confirms an admin identity', async () => {
    const me = vi.fn(() => Promise.resolve(meResult(true)))
    const b = await bench(me)
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    await vi.waitFor(() => { expect(b.slots.entries('settings.section')).toHaveLength(1) })
    const entry = b.slots.entries('settings.section')[0]!
    expect(entry.component).toBe(AdminQueue)
    expect(entry.options).toMatchObject({ id: 'admin-queue', order: 21 })
    b.locale.setLocale('zh-TW')
    expect(resolveSlotLabel(entry.options.label)).toBe('排隊管理')
    b.locale.setLocale('en')
    expect(resolveSlotLabel(entry.options.label)).toBe('Queue management')
  })

  it('never registers the settings entry for a non-admin identity', async () => {
    const me = vi.fn(() => Promise.resolve(meResult(false)))
    const b = await bench(me)
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    await me.mock.results[0]!.value
    await Promise.resolve()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
  })

  it('cancels the pending registration when disposed before the permission check resolves', async () => {
    let resolveMe!: (value: ReturnType<typeof meResult>) => void
    const me = vi.fn(() => new Promise<ReturnType<typeof meResult>>((res) => { resolveMe = res }))
    const b = await bench(me)
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await fiber.dispose()
    resolveMe(meResult(true))
    await Promise.resolve()
    await Promise.resolve()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
  })
})
