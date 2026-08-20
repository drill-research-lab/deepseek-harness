/**
 * `approvedIds` is the production capability policy seam A3 adds: a
 * deployment narrows the roster `list()`/`resolve()`/`mount()` all read to a
 * fixed set, so an unapproved preset (shipped or user-authored) reads exactly
 * like an id no root supplies — never a distinguishable "blocked" state, the
 * same not-found-not-403 posture this harness applies to cross-owner
 * resource access elsewhere.
 */

import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { afterEach, describe, expect, it } from 'vitest'
import AgentPresets, { resolveSessionPreset, UnknownPresetError, type Config } from '@deepseek-ai/dsh-agent-presets'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { createScope } from '@deepseek-ai/dsh-scope'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const SYSTEM_ROOT = join(FIXTURES, 'system')
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function roster(config: Partial<Config> = {}): Promise<Context> {
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(FIXTURES).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.plugin(AgentPresets, {
    default: 'standard',
    roots: [{ path: SYSTEM_ROOT, trust: 'system' as const }],
    includeUserRoot: false,
    ...config,
  })
  return ctx
}

/** A composition carrying the registries a preset's rows actually resolve, so `mount()` can activate for real. */
async function harness(config: Partial<Config> = {}, persistenceRoot?: string): Promise<Context> {
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(FIXTURES).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  if (persistenceRoot !== undefined) {
    await ctx.plugin(JsonlSessionPersistence, { root: persistenceRoot, compression: 'none' })
  }
  await ctx.plugin(AgentPresets, {
    default: 'standard',
    roots: [{ path: SYSTEM_ROOT, trust: 'system' as const }],
    includeUserRoot: false,
    ...config,
  })
  return ctx
}

describe('production capability policy (approvedIds)', () => {
  it('leaves the roster unrestricted when unset — upstream single-user behavior is unchanged', async () => {
    const ctx = await roster()

    const listed = await ctx.agentPresets.list()

    expect(listed.map(preset => preset.id).sort()).toEqual(['minimal', 'standard'])
    await expect(ctx.agentPresets.resolve('minimal')).resolves.toMatchObject({ id: 'minimal' })
  })

  it('narrows list() to exactly the approved ids', async () => {
    const ctx = await roster({ approvedIds: ['standard'] })

    const listed = await ctx.agentPresets.list()

    expect(listed.map(preset => preset.id)).toEqual(['standard'])
  })

  it('rejects resolve() of a shipped-but-unapproved preset exactly like an unknown id — no distinguishable "blocked" signal', async () => {
    const ctx = await roster({ approvedIds: ['standard'] })

    const error = await ctx.agentPresets.resolve('minimal').catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(UnknownPresetError)
    expect((error as UnknownPresetError).message).toMatch(/preset "minimal" not found \(available: standard\)/)
  })

  it('rejects mount() of an unapproved preset the same way resolve() does — no list()-hides-it/mount()-still-works gap', async () => {
    const ctx = await roster({ approvedIds: ['standard'] })
    const agentCtx = createScope(ctx, { test: 'policy-spec' }).ctx

    await expect(ctx.agentPresets.mount(agentCtx, 'minimal')).rejects.toBeInstanceOf(UnknownPresetError)
  })

  it('still allows the approved preset to mount normally', async () => {
    const ctx = await harness({ approvedIds: ['standard'] })
    const agentCtx = createScope(ctx, { test: 'policy-spec' }).ctx

    await expect(ctx.agentPresets.mount(agentCtx, 'standard')).resolves.toMatchObject({ id: 'standard' })
  })

  it('an empty approvedIds array approves nothing, including the configured default', async () => {
    const ctx = await roster({ approvedIds: [] })

    await expect(ctx.agentPresets.resolve()).rejects.toBeInstanceOf(UnknownPresetError)
  })

  it('rejects a persisted legacy preset after disposal and composition recreation', async () => {
    const persistenceRoot = await mkdtemp(join(tmpdir(), 'dsh-preset-policy-restart-'))
    temporaryRoots.push(persistenceRoot)
    const sessionId = SessionId('legacy-minimal')

    const before = await harness({}, persistenceRoot)
    const created = await before.agents.create({
      sessionId,
      meta: { agentPreset: 'minimal' },
      setup: agentCtx => before.agentPresets.mount(agentCtx, 'minimal').then(() => undefined),
    })
    created.agent.session.append('turn/start', { turn: 1 })
    created.agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await before.sessions.flush(created.agent.session)
    await before.fiber.dispose()

    const after = await harness({ approvedIds: ['standard'] }, persistenceRoot)
    const stored = await after.sessionPersistence.inspect(sessionId)
    const storedPresetId = resolveSessionPreset({ header: stored.meta, events: stored.events })
    expect(storedPresetId).toBe('minimal')
    await expect(after.agents.resume({
      resumeSessionId: sessionId,
      setup: agentCtx => after.agentPresets.mount(agentCtx, storedPresetId).then(() => undefined),
    })).rejects.toBeInstanceOf(UnknownPresetError)
    await after.fiber.dispose()
  })
})
