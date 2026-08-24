import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import ReportService, { ReportId, TemplateId, VersionId } from '../src/index.ts'
import type { Report } from '../src/index.ts'
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

function expectReport(result: Report): Report {
  return result
}

describe('ReportService public contract', () => {
  it('publishes the reports service key and the Remote method names', async () => {
    const { ctx } = await harness()
    const binding = ctx.reports.typertRemote
    expect(binding.serviceKey).toBe('reports')
    expect(binding.namespace).toBe('reports')
    expect(remoteMethods(ctx.reports)).toEqual([
      { method: 'list', invocation: { kind: 'direct' } },
      { method: 'create', invocation: { kind: 'direct' } },
      { method: 'get', invocation: { kind: 'direct' } },
      { method: 'rename', invocation: { kind: 'direct' } },
      { method: 'updateContent', invocation: { kind: 'direct' } },
      { method: 'delete', invocation: { kind: 'direct' } },
      { method: 'snapshot', invocation: { kind: 'direct' } },
      { method: 'listVersions', invocation: { kind: 'direct' } },
      { method: 'restoreVersion', invocation: { kind: 'direct' } },
      { method: 'listTemplates', invocation: { kind: 'direct' } },
      { method: 'template', invocation: { kind: 'direct' } },
      { method: 'addTemplate', invocation: { kind: 'direct' } },
      { method: 'deleteTemplate', invocation: { kind: 'direct' } },
    ])
  })

  it('starts empty and seeds built-in templates on first open', async () => {
    const { ctx } = await harness()
    expect(ctx.reports.list()).toEqual([])
    const templates = ctx.reports.listTemplates()
    expect(templates.length).toBe(3)
    expect(templates.filter(template => template.builtIn).length).toBe(3)
  })

  it('creates a report from the default template when none is named', async () => {
    const { ctx } = await harness()
    const report = await ctx.reports.create({ title: 'My Paper' })
    expect(expectReport(report).title).toBe('My Paper')
    expect(report.source).toContain('\\documentclass')
    expect(ctx.reports.list().length).toBe(1)
  })

  it('creates a report from a named template', async () => {
    const { ctx } = await harness()
    const template = ctx.reports.listTemplates().find(candidate => candidate.name === 'report')
    expect(template).toBeDefined()
    const report = template === undefined
      ? await ctx.reports.create({ title: 'Report' })
      : await ctx.reports.create({ title: 'Report', templateId: template.id })
    expect(report.source).toContain('\\documentclass[12pt]{report}')
  })

  it('prefers an explicit source over the template source', async () => {
    const { ctx } = await harness()
    const report = await ctx.reports.create({ title: 'Custom', source: '\\documentclass{article}% custom' })
    expect(report.source).toBe('\\documentclass{article}% custom')
  })

  it('rejects an unknown explicit template without writing', async () => {
    const { ctx } = await harness()
    await expect(ctx.reports.create({ title: 'x', templateId: TemplateId('missing') }))
      .rejects.toThrow(/unknown template/)
    expect(ctx.reports.list().length).toBe(0)
  })

  it('gets, renames, and updates content durably', async () => {
    const { ctx } = await harness()
    const report = await ctx.reports.create({ title: 'A' })
    expect(ctx.reports.get(report.id)?.title).toBe('A')
    expect(ctx.reports.get(ReportId('missing'))).toBeUndefined()

    const renamed = await ctx.reports.rename(report.id, 'Renamed')
    expect(renamed.title).toBe('Renamed')
    expect(renamed.updatedAt >= report.updatedAt).toBe(true)

    const updated = await ctx.reports.updateContent(report.id, '\\documentclass{article}% v2')
    expect(updated.source).toBe('\\documentclass{article}% v2')
    expect(ctx.reports.get(report.id)?.source).toBe('\\documentclass{article}% v2')
  })

  it('snapshots, lists, and restores versions (newest first, immutable body)', async () => {
    const { ctx } = await harness()
    const report = await ctx.reports.create({ title: 'V', source: 'v1' })

    const first = await ctx.reports.snapshot(report.id, 'first compile')
    const second = await ctx.reports.snapshot(report.id, 'second compile')

    // Update content after the snapshots; a later snapshot must not change them.
    await ctx.reports.updateContent(report.id, 'v3')
    const third = await ctx.reports.snapshot(report.id, 'third compile')

    const versions = ctx.reports.listVersions(report.id)
    expect(versions.length).toBe(3)
    expect(versions[0]?.label).toBe('third compile')
    expect(versions[1]?.id).toBe(second.id)
    expect(versions[2]?.label).toBe('first compile')

    expect(first.source).toBe('v1')
    expect(second.source).toBe('v1')
    expect(third.source).toBe('v3')

    const restored = await ctx.reports.restoreVersion(report.id, first.id)
    expect(restored.source).toBe('v1')
  })

  it('captures version snapshots with a default numbered label', async () => {
    const { ctx } = await harness()
    const report = await ctx.reports.create({ title: 'V' })
    const version = await ctx.reports.snapshot(report.id)
    expect(version.label).toMatch(/^snapshot #1$/)
  })

  it('restore rejects an unknown or foreign version', async () => {
    const { ctx } = await harness()
    const left = await ctx.reports.create({ title: 'Left' })
    const right = await ctx.reports.create({ title: 'Right' })
    const leftVersion = await ctx.reports.snapshot(left.id)
    await expect(ctx.reports.restoreVersion(right.id, leftVersion.id)).rejects.toThrow(/unknown version/)
    await expect(ctx.reports.restoreVersion(left.id, VersionId('missing'))).rejects.toThrow(/unknown version/)
  })

  it('lists reports newest first', async () => {
    const { ctx } = await harness()
    const first = await ctx.reports.create({ title: 'First' })
    const second = await ctx.reports.create({ title: 'Second' })
    const listed = ctx.reports.list()
    expect(listed[0]?.id).toBe(second.id)
    expect(listed[1]?.id).toBe(first.id)
  })

  it('lists reports as frozen snapshots', async () => {
    const { ctx } = await harness()
    await ctx.reports.create({ title: 'A' })
    const listEntry = ctx.reports.list()[0]
    expect(listEntry).toBeDefined()
    expect(Object.isFrozen(listEntry)).toBe(true)
  })

  it('deletes a report and prunes its versions', async () => {
    const { ctx } = await harness()
    const report = await ctx.reports.create({ title: 'A', source: 'x' })
    await ctx.reports.snapshot(report.id, 'one')
    await ctx.reports.snapshot(report.id, 'two')

    expect(await ctx.reports.delete(report.id)).toBe(true)
    expect(ctx.reports.get(report.id)).toBeUndefined()
    expect(ctx.reports.listVersions(report.id)).toEqual([])

    // Idempotent miss.
    expect(await ctx.reports.delete(ReportId('missing'))).toBe(false)
  })

  it('prunes only the deleted report while keeping another report’s versions', async () => {
    const { ctx } = await harness()
    const dropped = await ctx.reports.create({ title: 'A', source: 'x' })
    const kept = await ctx.reports.create({ title: 'B', source: 'y' })
    await ctx.reports.snapshot(dropped.id, 'a1')
    await ctx.reports.snapshot(kept.id, 'b1')

    await ctx.reports.delete(dropped.id)
    expect(ctx.reports.listVersions(dropped.id)).toEqual([])
    expect(ctx.reports.listVersions(kept.id).length).toBe(1)
  })

  it('lists templates with built-ins first and custom templates sorted newest first', async () => {
    const { ctx } = await harness()
    const custom = await ctx.reports.addTemplate({ name: 'custom-report', source: '\\documentclass{article}' })
    const templates = ctx.reports.listTemplates()
    expect(templates[0]?.builtIn).toBe(true)
    expect(templates[templates.length - 1]?.name).toBe('custom-report')
    expect(ctx.reports.template(custom.id)?.name).toBe('custom-report')
  })

  it('rejects a duplicate custom template name', async () => {
    const { ctx } = await harness()
    await ctx.reports.addTemplate({ name: 'dup', source: 'a' })
    await expect(ctx.reports.addTemplate({ name: 'dup', source: 'b' })).rejects.toThrow(/already exists/)
  })

  it('does not delete built-in templates', async () => {
    const { ctx } = await harness()
    const builtIn = ctx.reports.listTemplates().find(template => template.builtIn)
    expect(builtIn).toBeDefined()
    await expect(ctx.reports.deleteTemplate(builtIn!.id)).rejects.toThrow(/built-in templates/)
  })

  it('deletes a custom template and reports a miss idempotently', async () => {
    const { ctx } = await harness()
    const custom = await ctx.reports.addTemplate({ name: 'gone', source: 'x' })
    expect(await ctx.reports.deleteTemplate(custom.id)).toBe(true)
    expect(ctx.reports.template(custom.id)).toBeUndefined()
    expect(await ctx.reports.deleteTemplate(TemplateId('missing'))).toBe(false)
  })
})

describe('ReportService guard rails', () => {
  it('snapshot of an unknown report throws', async () => {
    const { ctx } = await harness()
    await expect(ctx.reports.snapshot(ReportId('missing'))).rejects.toThrow(/unknown report/)
  })

  it('throws from the not-started guards before initialization', () => {
    const svc = new ReportService(new Context())
    expect(() => svc.list()).toThrow(/not started/)
    expect(() => svc.listVersions(ReportId('x'))).toThrow(/not started/)
    expect(() => svc.listTemplates()).toThrow(/not started/)
  })

  it('orders custom templates by recency when one is newer', async () => {
    const { ctx } = await harness()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    const first = await ctx.reports.addTemplate({ name: 'first', source: 'a' })
    vi.setSystemTime(new Date('2026-01-02T00:00:00.000Z'))
    const second = await ctx.reports.addTemplate({ name: 'second', source: 'b' })
    vi.useRealTimers()
    const customs = ctx.reports.listTemplates().filter(template => !template.builtIn)
    expect(customs[0]?.id).toBe(second.id)
    expect(customs[1]?.id).toBe(first.id)
  })

  it('keeps reports and templates durable across a reload of the same storage', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-writing-reload-'))
    const boot = async (): Promise<Context> => {
      const ctx = new Context()
      await ctx.plugin(Storage)
      await ctx.plugin(StorageJson, { root })
      await ctx.plugin(StorageDomain, { backend: 'json' })
      await ctx.plugin(ReportService)
      return ctx
    }
    const first = await boot()
    await first.reports.create({ title: 'x' })
    expect(first.reports.list().length).toBe(1)
    expect(first.reports.listTemplates().length).toBe(3)
    await first.fiber.dispose()

    const second = await boot()
    expect(second.reports.list().length).toBe(1)
    expect(second.reports.listTemplates().length).toBe(3)
    await second.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })

  it('tie-breaks reports with an equal createdAt by id', async () => {
    const { ctx } = await harness()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    await ctx.reports.create({ title: 'A' })
    await ctx.reports.create({ title: 'B' })
    vi.useRealTimers()
    expect(ctx.reports.list().length).toBe(2)
  })
})
