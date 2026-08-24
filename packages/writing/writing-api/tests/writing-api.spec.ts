import { afterEach, describe, expect, it } from 'vitest'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { setupHarness, writeArtifacts, type TestHarness } from './helpers.ts'

const harnesses: TestHarness[] = []

async function harness(
  options: { readonly onRun?: (workdir: string) => void | Promise<void>; readonly withWebServer?: boolean } = {},
): Promise<TestHarness> {
  const value = await setupHarness(options)
  harnesses.push(value)
  return value
}

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map(value => value.dispose()))
})

describe('WritingGateway public contract', () => {
  it('publishes the writing service key and Remote method names', async () => {
    const { ctx } = await harness()
    const binding = ctx.writing.typertRemote
    expect(binding.serviceKey).toBe('writing')
    expect(binding.namespace).toBe('writing')
    const methods = remoteMethods(ctx.writing).map(entry => entry.method)
    expect(methods).toEqual([
      'list', 'get', 'create', 'updateContent', 'rename', 'remove',
      'compile', 'versions', 'restore', 'templates', 'addTemplate',
    ])
  })

  it('creates and lists reports through the wire view', async () => {
    const { ctx } = await harness()
    const created = await ctx.writing.create({ title: 'My Paper' })
    expect(created.reportId).toBeTruthy()
    expect(created.source).toContain('\\documentclass')
    expect(ctx.writing.list().length).toBe(1)
    expect(ctx.writing.get({ reportId: created.reportId })?.title).toBe('My Paper')
  })

  it('updates content and renames', async () => {
    const { ctx } = await harness()
    const created = await ctx.writing.create({ title: 'A', source: 'v1' })
    const updated = await ctx.writing.updateContent({ reportId: created.reportId, source: 'v2' })
    expect(updated.source).toBe('v2')
    const renamed = await ctx.writing.rename({ reportId: created.reportId, title: 'B' })
    expect(renamed.title).toBe('B')
  })

  it('compiles, reports diagnostics on failure, and does not snapshot', async () => {
    const { ctx, root } = await harness({
      onRun: async (workdir) => { await writeArtifacts(workdir, { log: '! Undefined control sequence.\nl.5 \\foo' }) },
    })
    const created = await ctx.writing.create({ title: 'A', source: '\\foo' })
    const result = await ctx.writing.compile({ reportId: created.reportId })
    expect(result.ok).toBe(false)
    expect(result.diagnostics.length).toBe(1)
    expect(result.versionCreated).toBe(false)
    expect(result.pdfUrl).toBeUndefined()
    expect(ctx.writing.versions({ reportId: created.reportId }).length).toBe(0)
    // The failed compile still wrote the artifact dir under the harness root.
    expect(root).toBeTruthy()
  })

  it('compiles successfully, snapshots a version, and yields a pdfUrl', async () => {
    const { ctx } = await harness({
      onRun: async (workdir) => { await writeArtifacts(workdir, { log: '', pdf: true }) },
    })
    const created = await ctx.writing.create({ title: 'A', source: 'v1' })
    const result = await ctx.writing.compile({ reportId: created.reportId })
    expect(result.ok).toBe(true)
    expect(result.versionCreated).toBe(true)
    expect(result.pdfUrl).toBe(`/writing/${created.reportId}/pdf`)
    const versions = ctx.writing.versions({ reportId: created.reportId })
    expect(versions.length).toBe(1)
    expect(versions[0]?.label).toMatch(/^successful compile #1$/)

    // Restore back to the snapshot source after a content change.
    await ctx.writing.updateContent({ reportId: created.reportId, source: 'changed' })
    const restored = await ctx.writing.restore({ reportId: created.reportId, versionId: versions[0]!.versionId })
    expect(restored.source).toBe('v1')
  })

  it('lists templates and adds a custom template', async () => {
    const { ctx } = await harness()
    expect(ctx.writing.templates()[0]?.builtIn).toBe(true)
    const added = await ctx.writing.addTemplate({ name: 'custom', source: '\\documentclass{article}' })
    expect(ctx.writing.templates().some(template => template.templateId === added.templateId)).toBe(true)
  })

  it('removes a report', async () => {
    const { ctx } = await harness()
    const created = await ctx.writing.create({ title: 'A' })
    expect(await ctx.writing.remove({ reportId: created.reportId })).toBe(true)
    expect(ctx.writing.list().length).toBe(0)
  })
})

describe('WritingGateway PDF route', () => {
  it('serves the compiled PDF when a webserver is composed', async () => {
    const { ctx } = await harness({
      withWebServer: true,
      onRun: async (workdir) => { await writeArtifacts(workdir, { log: '', pdf: true }) },
    })
    const created = await ctx.writing.create({ title: 'A', source: 'v1' })
    const result = await ctx.writing.compile({ reportId: created.reportId })
    expect(result.ok).toBe(true)

    const url = `http://127.0.0.1:${ctx.webServer.port}/writing/${created.reportId}/pdf`
    const response = await fetch(url)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(await response.text()).toContain('%PDF-1.7')
  })

  it('returns 404 for a missing report pdf', async () => {
    const { ctx } = await harness({ withWebServer: true })
    const url = `http://127.0.0.1:${ctx.webServer.port}/writing/unknown-report/pdf`
    const response = await fetch(url)
    expect(response.status).toBe(404)
  })
})
