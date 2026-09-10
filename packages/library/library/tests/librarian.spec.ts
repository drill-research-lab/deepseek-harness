import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { setupHarness, type TestHarness } from './helpers.ts'

const harnesses: TestHarness[] = []

async function harness(): Promise<TestHarness> {
  const value = await setupHarness()
  harnesses.push(value)
  return value
}

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map(value => value.dispose()))
})

describe('LibrarianService', () => {
  it('creates, renames, lists, and deletes notebooks', async () => {
    const { ctx } = await harness()
    expect(ctx.librarian.listNotebooks()).toEqual([])
    const notebook = await ctx.librarian.createNotebook('圖學筆記')
    expect(ctx.librarian.listNotebooks().map(entry => entry.id)).toEqual([notebook.id])
    const renamed = await ctx.librarian.renameNotebook(notebook.id, 'Graphics')
    expect(renamed.title).toBe('Graphics')
    await expect(ctx.librarian.deleteNotebook(notebook.id)).resolves.toBe(true)
    await expect(ctx.librarian.deleteNotebook(notebook.id)).resolves.toBe(false)
    expect(ctx.librarian.listNotebooks()).toEqual([])
  })

  it('ingests text, converts it, and keeps original beside markdown on disk', async () => {
    const { ctx, root } = await harness()
    const notebook = await ctx.librarian.createNotebook('kb')
    const resource = await ctx.librarian.ingest({
      notebookId: notebook.id,
      name: 'notes.md',
      content: { text: '# Shaders\nThe vertex shader runs per vertex.' },
    })
    expect(resource.status).toBe('ready')
    expect(resource.convertedBy).toBe('builtin-text')
    const markdown = await ctx.librarian.readMarkdown(resource.id)
    expect(markdown).toContain('vertex shader')
    const original = await readFile(
      join(root, 'library', 'v1', String(notebook.id), 'original', `${String(resource.id)}__notes.md`),
      'utf8',
    )
    expect(original).toContain('# Shaders')
  })

  it('lands on error with the original kept when no converter accepts the file', async () => {
    const { ctx } = await harness()
    const notebook = await ctx.librarian.createNotebook('kb')
    const resource = await ctx.librarian.ingest({
      notebookId: notebook.id,
      name: 'scan.pdf',
      content: { data: new Uint8Array([0x25, 0x50, 0x44, 0x46]) },
    })
    expect(resource.status).toBe('error')
    expect(resource.error).toContain('no converter')
    const original = ctx.librarian.originalFileOf(resource.id)
    expect(original.mediaType).toBe('application/pdf')
    await expect(ctx.librarian.readMarkdown(resource.id)).rejects.toThrow(/no converted Markdown/)
  })

  it('searches converted content and reports structure with outlines', async () => {
    const { ctx } = await harness()
    const notebook = await ctx.librarian.createNotebook('kb')
    await ctx.librarian.ingest({
      notebookId: notebook.id,
      name: 'gl.md',
      content: { text: '# Fragment\ngl_FragColor sets the pixel color.' },
    })
    await ctx.librarian.ingest({
      notebookId: notebook.id,
      name: 'food.md',
      content: { text: '# 晚餐\n今天吃滷肉飯。' },
    })
    const hits = await ctx.librarian.search(notebook.id, 'gl_FragColor pixel', 4)
    expect(hits[0]?.resourceName).toBe('gl.md')
    const structures = await ctx.librarian.structure(notebook.id)
    expect(structures).toHaveLength(1)
    const outlines = structures[0]?.resources.map(entry => entry.outline[0])
    expect(outlines).toContain('Fragment')
    expect(outlines).toContain('晚餐')
  })

  it('declines questions on an empty notebook without an LLM call', async () => {
    const { ctx } = await harness()
    const notebook = await ctx.librarian.createNotebook('kb')
    const result = await ctx.librarian.ask(notebook.id, 'anything at all?')
    expect(result.grounded).toBe(false)
    expect(result.sources).toEqual([])
  })

  it('falls back to leading excerpts for overview questions with no keyword match', async () => {
    const { ctx } = await harness()
    const notebook = await ctx.librarian.createNotebook('kb')
    await ctx.librarian.ingest({
      notebookId: notebook.id,
      name: 'notes.md',
      content: { text: '# Shaders\nContent about shaders.' },
    })
    // No keyword overlap, yet the ask proceeds to the model call — which is
    // exactly the llm-missing error in this composition-without-llm harness.
    await expect(ctx.librarian.ask(notebook.id, '簡單介紹一下')).rejects.toThrow(/requires the llm service/)
  })

  it('rejects operations on unknown notebooks and resources', async () => {
    const { ctx } = await harness()
    await expect(ctx.librarian.ingest({
      notebookId: 'missing' as never,
      name: 'x.md',
      content: { text: 'x' },
    })).rejects.toThrow(/unknown notebook/)
    await expect(ctx.librarian.ask('missing' as never, 'q')).rejects.toThrow(/unknown notebook/)
    expect(ctx.librarian.resource('missing' as never)).toBeUndefined()
  })

  it('deletes a resource together with its files', async () => {
    const { ctx } = await harness()
    const notebook = await ctx.librarian.createNotebook('kb')
    const resource = await ctx.librarian.ingest({
      notebookId: notebook.id,
      name: 'a.md',
      content: { text: 'text' },
    })
    await expect(ctx.librarian.deleteResource(resource.id)).resolves.toBe(true)
    await expect(ctx.librarian.deleteResource(resource.id)).resolves.toBe(false)
    expect(ctx.librarian.listResources(notebook.id)).toEqual([])
  })
})

describe('LibrarianService sidecars', () => {
  it('writes the notebook index at ingest and answers structure and search from it', async () => {
    const { ctx, root } = await harness()
    const notebook = await ctx.librarian.createNotebook('kb')
    const resource = await ctx.librarian.ingest({
      notebookId: notebook.id,
      name: 'gl.md',
      content: { text: '# Fragment\ngl_FragColor sets the pixel color.' },
    })
    const indexPath = join(root, 'library', 'v1', notebook.id, 'index.json')
    const written = JSON.parse(await readFile(indexPath, 'utf8')) as {
      resources: { resourceId: string; summary: string; chunks: { terms: Record<string, number> }[] }[]
    }
    expect(written.resources.map(entry => entry.resourceId)).toEqual([resource.id])
    expect(written.resources[0]?.summary).toContain('gl_FragColor')
    // The tokenizer splits at underscores, so gl_FragColor lands as two terms.
    expect(written.resources[0]?.chunks[0]?.terms['fragcolor']).toBe(1)
    // Corrupt the converted document: index-served reads must not notice.
    await writeFile(join(root, 'library', 'v1', notebook.id, 'markdown', `${resource.id}.md`), 'clobbered', 'utf8')
    const hits = await ctx.librarian.search(notebook.id, 'gl_FragColor pixel', 4)
    expect(hits[0]?.text).toContain('gl_FragColor sets the pixel color')
    const structures = await ctx.librarian.structure(notebook.id)
    expect(structures[0]?.resources[0]?.outline).toEqual(['Fragment'])
    expect(structures[0]?.resources[0]?.summary).toContain('gl_FragColor')
  })

  it('rebuilds a missing index on read (self-heal for pre-index notebooks)', async () => {
    const { ctx, root } = await harness()
    const notebook = await ctx.librarian.createNotebook('kb')
    await ctx.librarian.ingest({
      notebookId: notebook.id,
      name: 'notes.md',
      content: { text: '# Shaders\nContent about shaders.' },
    })
    const indexPath = join(root, 'library', 'v1', notebook.id, 'index.json')
    await rm(indexPath)
    const hits = await ctx.librarian.search(notebook.id, 'shaders', 4)
    expect(hits[0]?.resourceName).toBe('notes.md')
    await expect(readFile(indexPath, 'utf8')).resolves.toContain('notes.md')
  })

  it('rebuilds a stale index after a rename lands on disk', async () => {
    const { ctx, root } = await harness()
    const notebook = await ctx.librarian.createNotebook('before')
    await ctx.librarian.renameNotebook(notebook.id, 'after')
    await ctx.librarian.structure(notebook.id)
    const indexPath = join(root, 'library', 'v1', notebook.id, 'index.json')
    const written = JSON.parse(await readFile(indexPath, 'utf8')) as { title: string }
    expect(written.title).toBe('after')
  })

  it('records declined asks and agent exchanges in the durable ask log', async () => {
    const { ctx } = await harness()
    const notebook = await ctx.librarian.createNotebook('kb')
    await ctx.librarian.ask(notebook.id, 'anything at all?')
    const recorded = await ctx.librarian.recordAsk(notebook.id, {
      origin: 'agent',
      question: 'from the chat',
      answer: 'an answer [notes.md]',
      grounded: true,
      sources: [],
    })
    expect(recorded.id).not.toBe('')
    const log = await ctx.librarian.askLog(notebook.id)
    expect(log.map(entry => entry.origin)).toEqual(['ui', 'agent'])
    expect(log[0]?.grounded).toBe(false)
    expect(log[1]?.question).toBe('from the chat')
    await expect(ctx.librarian.askLog('missing' as never)).rejects.toThrow(/unknown notebook/)
  })

  it('caps the ask log at its newest 200 entries', async () => {
    const { ctx } = await harness()
    const notebook = await ctx.librarian.createNotebook('kb')
    for (let index = 0; index < 205; index += 1) {
      await ctx.librarian.recordAsk(notebook.id, {
        origin: 'agent',
        question: `q${index}`,
        answer: 'a',
        grounded: true,
        sources: [],
      })
    }
    const log = await ctx.librarian.askLog(notebook.id)
    expect(log).toHaveLength(200)
    expect(log[0]?.question).toBe('q5')
    expect(log.at(-1)?.question).toBe('q204')
  })
})
