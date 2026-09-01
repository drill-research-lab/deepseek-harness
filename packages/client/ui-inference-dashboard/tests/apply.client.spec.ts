/** Dashboard slot registration, locale following, and HMR recovery. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'
import { InferenceDashboard } from '../src/client/InferenceDashboard.tsx'

usePinnedBrowserLanguages('zh-TW')

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  ctx.provide('connection', { api: {}, isLoopback: false } as never)
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-inference-dashboard apply', () => {
  it('registers the localized dashboard in Settings', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    b.locale.setLocale('zh-TW')
    const entry = b.slots.entries('settings.section')[0]!
    expect(entry.component).toBe(InferenceDashboard)
    expect(entry.options).toMatchObject({ id: 'inference-dashboard', order: 20 })
    expect(resolveSlotLabel(entry.options.label)).toBe('推論狀態')
    b.locale.setLocale('en')
    expect(resolveSlotLabel(entry.options.label)).toBe('Inference status')
  })

  it('registers after a late declaration and recovers after declaration replacement', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    const remove = declare(b.slots)
    await Promise.resolve()
    expect(b.slots.entries('settings.section')).toHaveLength(1)
    remove()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    declare(b.slots)
    await Promise.resolve()
    expect(b.slots.entries('settings.section')[0]!.component).toBe(InferenceDashboard)
  })
})
