/**
 * Drives the REAL plugin body: mounts `dsh-tool-library` over a real
 * librarian (storage hub + JSON backend in a temp home) and a real
 * `SubagentRuntime` carrying the scripted child boundary as the `librarian`
 * provider, then invokes the registered tools through `ctx.tools.execute`.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import LibrarianService, { LIBRARIAN_PROMPT } from '@deepseek-ai/dsh-library'
import * as mock from '../../../subagent/tool-subagent/tests/scripted-provider.ts'
import * as tool from '../src/index.ts'

const testToolSignal = new AbortController().signal

/** A minimal parent Agent passed through to the provider request. */
function fakeAgent(id = 'parent-1'): Agent {
  return { id: SessionId(id) } as unknown as Agent
}

interface Harness {
  readonly ctx: Context
  dispose(): Promise<void>
}

const harnesses: Harness[] = []

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map(value => value.dispose()))
})

/** Compose librarian + tools (+ optionally the scripted librarian provider). */
async function setup(options: { librarianProvider?: Partial<mock.Config> | false } = {}): Promise<Context> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-tool-library-test-'))
  const ctx = new Context()
  harnesses.push({
    ctx,
    async dispose() {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    },
  })
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(root, 'storages') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(LibrarianService, {
    dshHome: root,
    markitdown: false,
    python: 'python',
    convertTimeoutMs: 120_000,
    persona: LIBRARIAN_PROMPT,
    traditionalChinese: true,
    searchLimit: 8,
    maxAnswerTokens: 2048,
    askTimeoutMs: 60_000,
  })
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  if (options.librarianProvider !== false) {
    await ctx.plugin(SubagentRuntime)
    await mock.mountScriptedProvider(ctx, { name: 'librarian', ...options.librarianProvider })
  }
  await ctx.plugin(tool, { maxReadChars: 20_000 })
  return ctx
}

let callCounter = 0
function call(ctx: Context, name: string, args: unknown, over: { agent?: Agent | undefined } = {}) {
  const agent = 'agent' in over ? over.agent : fakeAgent()
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: CallId(`call-${++callCounter}`),
    name,
    arguments: args,
    ...agent ? { agent } : {},
  })
}

describe('dsh-tool-library', () => {
  it('delegates library_ask to the librarian subagent and records the exchange', async () => {
    const starts: SubagentStartRequest[] = []
    const ctx = await setup({
      librarianProvider: {
        reply: 'gl_FragColor sets the pixel color [gl.md]',
        onStart: (request) => { starts.push(request) },
      },
    })
    const notebook = await ctx.librarian.createNotebook('kb')
    await ctx.librarian.ingest({
      notebookId: notebook.id,
      name: 'gl.md',
      content: { text: '# Fragment\ngl_FragColor sets the pixel color.' },
    })
    const result = await call(ctx, 'library_ask', { notebook: 'kb', question: 'how do I set the pixel color?' })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected ask success')
    expect(result.value).toMatchObject({
      answer: 'gl_FragColor sets the pixel color [gl.md]',
      grounded: true,
      sources: [{ name: 'gl.md', heading: '' }],
    })
    // The delegation carries the notebook identity and denies recursion.
    const request = starts[0]
    expect(request).toBeDefined()
    const promptText = request?.prompt.map(block => (block.type === 'text' ? block.text : '')).join('')
    expect(promptText).toContain(String(notebook.id))
    expect(promptText).toContain('how do I set the pixel color?')
    expect(request?.toolFilter).toEqual({ deny: ['library_ask', 'library_ingest'] })
    // The exchange landed in the notebook's ask log as an agent entry.
    const log = await ctx.librarian.askLog(notebook.id)
    expect(log.map(entry => entry.origin)).toEqual(['agent'])
    expect(log[0]?.answer).toContain('[gl.md]')
  })

  it('surfaces an abnormal librarian child ending as a tool error', async () => {
    const ctx = await setup({ librarianProvider: { stopReason: 'max-tokens' } })
    const notebook = await ctx.librarian.createNotebook('kb')
    await ctx.librarian.ingest({ notebookId: notebook.id, name: 'a.md', content: { text: 'text' } })
    const result = await call(ctx, 'library_ask', { notebook: 'kb', question: 'q' })
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('expected ask failure')
    expect(JSON.stringify(result.content)).toContain('max-tokens')
  })

  it('falls back to the direct librarian route without a subagent runtime', async () => {
    const ctx = await setup({ librarianProvider: false })
    const notebook = await ctx.librarian.createNotebook('kb')
    const result = await call(ctx, 'library_ask', { notebook: 'kb', question: 'anything?' })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected ask success')
    expect(result.value).toMatchObject({ grounded: false })
    const log = await ctx.librarian.askLog(notebook.id)
    expect(log.map(entry => entry.origin)).toEqual(['agent'])
  })

  it('falls back to the direct librarian route for a non-agent caller', async () => {
    const ctx = await setup({ librarianProvider: { reply: 'should not be used' } })
    await ctx.librarian.createNotebook('kb')
    const result = await call(ctx, 'library_ask', { notebook: 'kb', question: 'anything?' }, { agent: undefined })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected ask success')
    expect(result.value).toMatchObject({ grounded: false })
  })

  it('reports structure with outlines and summaries from the ingest-time index', async () => {
    const ctx = await setup({ librarianProvider: false })
    const notebook = await ctx.librarian.createNotebook('kb')
    await ctx.librarian.ingest({
      notebookId: notebook.id,
      name: 'gl.md',
      content: { text: '# Fragment\ngl_FragColor sets the pixel color.' },
    })
    const result = await call(ctx, 'library_structure', { notebook: 'kb' })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected structure success')
    const value = result.value as {
      notebooks: { resources: { outline: string[]; summary: string }[] }[]
    }
    expect(value.notebooks[0]?.resources[0]?.outline).toEqual(['Fragment'])
    expect(value.notebooks[0]?.resources[0]?.summary).toContain('gl_FragColor')
  })

  it('resolves notebook titles written in Simplified Chinese', async () => {
    const ctx = await setup({ librarianProvider: false })
    await ctx.librarian.createNotebook('圖學課程')
    const result = await call(ctx, 'library_structure', { notebook: '图学课程' })
    expect(result.isError).toBe(false)
  })
})
