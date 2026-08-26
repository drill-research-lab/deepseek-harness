import { readFile } from 'node:fs/promises'
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

  it('declines ungrounded questions without an LLM call', async () => {
    const { ctx } = await harness()
    const notebook = await ctx.librarian.createNotebook('kb')
    const result = await ctx.librarian.ask(notebook.id, 'anything at all?')
    expect(result.grounded).toBe(false)
    expect(result.sources).toEqual([])
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
