import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ReportId } from '@deepseek-ai/dsh-writing'
import { setupHarness, writeArtifacts, outputRun, type TestHarness } from './helpers.ts'

const harnesses: TestHarness[] = []
const testSignal = new AbortController().signal
let callCounter = 0

async function harness(
  options: { readonly maxReadChars?: number; readonly onRun?: (workdir: string) => void | Promise<void> } = {},
): Promise<TestHarness> {
  const value = await setupHarness(options)
  harnesses.push(value)
  return value
}

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map(value => value.dispose()))
})

function agentWithSession(id = 'parent-1'): Agent & { session: Session } {
  const session = Session.create(SessionId(id))
  return { id: SessionId(id), session } as unknown as Agent & { session: Session }
}

function callTool(ctx: Context, name: string, args: unknown): ReturnType<Context['tools']['execute']> {
  return ctx.tools.execute({
    signal: testSignal,
    callId: CallId(`call-${++callCounter}`),
    name,
    arguments: args,
    agent: agentWithSession('writer'),
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

async function okValue(ctx: Context, name: string, args: unknown): Promise<Record<string, unknown>> {
  const result = await callTool(ctx, name, args)
  if (result.isError) throw new Error(`expected ${name} to succeed: ${text(result)}`)
  return result.value as Record<string, unknown>
}

describe('dsh-tool-writing', () => {
  it('registers the writing tools', async () => {
    const { ctx } = await harness()
    const names = ctx.tools.schemas().map(schema => schema.name)
    expect(names).toEqual(expect.arrayContaining([
      'report_create', 'report_write', 'report_read', 'report_compile', 'report_versions', 'report_restore',
    ]))
  })

  it('creates a report from the default template', async () => {
    const { ctx } = await harness()
    const value = await okValue(ctx, 'report_create', { title: 'My Paper' })
    const reportId = value.reportId as string
    expect(reportId).toBeTruthy()
    expect(ctx.reports.get(ReportId(reportId))?.title).toBe('My Paper')
    expect(String(value.source)).toContain('\\documentclass')
  })

  it('writes and reads the report source', async () => {
    const { ctx } = await harness()
    const created = await okValue(ctx, 'report_create', { title: 'A', source: 'v1' })
    const reportId = created.reportId as string

    const written = await okValue(ctx, 'report_write', { reportId, source: '\\documentclass{article}% v2' })
    expect(written.chars).toBeGreaterThan(0)

    const read = await okValue(ctx, 'report_read', { reportId })
    expect(read.source).toBe('\\documentclass{article}% v2')
    expect(read.truncated).toBe(false)
  })

  it('truncates a long report read and reports it', async () => {
    const { ctx } = await harness({ maxReadChars: 10 })
    const created = await okValue(ctx, 'report_create', { title: 'A', source: 'abcdefghijklmno' })
    const reportId = created.reportId as string
    const read = await okValue(ctx, 'report_read', { reportId })
    expect(read.source).toBe('abcdefghij')
    expect(read.truncated).toBe(true)
  })

  it('compiles, returns diagnostics on failure, and does not snapshot', async () => {
    const { ctx, subprocess } = await harness({
      onRun: async (workdir) => { await writeArtifacts(workdir, { log: '! Undefined control sequence.\nl.5 \\foo' }) },
    })
    const created = await okValue(ctx, 'report_create', { title: 'A', source: '\\foo' })
    const reportId = created.reportId as string

    // One failing compile: the subprocess returns exit 1.
    subprocess.outcomes = [outputRun({ exitCode: 1 })]
    const result = await callTool(ctx, 'report_compile', { reportId })
    expect(result.isError).toBe(false)
    const value = result.value as { ok: boolean; diagnostics: unknown[]; versionCreated: boolean }
    expect(value.ok).toBe(false)
    expect(value.diagnostics.length).toBe(1)
    expect(value.versionCreated).toBe(false)
    expect(ctx.reports.listVersions(ReportId(reportId)).length).toBe(0)
    expect(text(result)).toContain('failed to compile')
  })

  it('compiles successfully, snapshots a version, and lists/restores versions', async () => {
    const { ctx } = await harness({
      onRun: async (workdir) => { await writeArtifacts(workdir, { log: '', pdf: true }) },
    })
    const created = await okValue(ctx, 'report_create', { title: 'A', source: 'v1' })
    const reportId = created.reportId as string

    const compiled = await callTool(ctx, 'report_compile', { reportId })
    const value = compiled.value as { ok: boolean; versionCreated: boolean }
    expect(value.ok).toBe(true)
    expect(value.versionCreated).toBe(true)
    expect(text(compiled)).toContain('compiled successfully')
    expect(ctx.reports.listVersions(ReportId(reportId)).length).toBe(1)

    const listed = await okValue(ctx, 'report_versions', { reportId })
    const versions = listed.versions as { id: string; label: string }[]
    expect(versions.length).toBe(1)
    expect(versions[0]?.label).toMatch(/^successful compile #1$/)

    // Change content, then restore to the snapshot.
    await okValue(ctx, 'report_write', { reportId, source: '\\documentclass{article}% v2' })
    const restored = await okValue(ctx, 'report_restore', { reportId, versionId: versions[0]!.id })
    expect(restored.source).toBe('v1')
  })
})

describe('tool definitions', () => {
  it('covers every presentCall and render branch', async () => {
    const { ctx } = await harness()
    const def = (name: string): {
      presentCall?: (args: unknown) => unknown
      output?: { render?: (args: unknown, value: unknown) => unknown }
    } => ctx.tools.get(name) as unknown as {
      presentCall?: (args: unknown) => unknown
      output?: { render?: (args: unknown, value: unknown) => unknown }
    }

    def('report_create').presentCall?.({ title: 'T' })
    expect(def('report_create').output?.render?.({}, { reportId: 'r', title: 'T', source: 's' })).toBeDefined()

    def('report_write').presentCall?.({ reportId: 'r' })
    expect(def('report_write').output?.render?.({}, { reportId: 'r', chars: 1, updatedAt: 'u' })).toBeDefined()

    def('report_read').presentCall?.({ reportId: 'r' })
    expect(def('report_read').output?.render?.({}, { reportId: 'r', source: 's', truncated: false, versionCount: 0 })).toBeDefined()
    expect(def('report_read').output?.render?.({}, { reportId: 'r', source: 's', truncated: true, versionCount: 1 })).toBeDefined()

    def('report_compile').presentCall?.({ reportId: 'r' })
    expect(def('report_compile').output?.render?.({}, { reportId: 'r', ok: true, diagnostics: [], versionCreated: true })).toBeDefined()
    expect(def('report_compile').output?.render?.({}, { reportId: 'r', ok: true, diagnostics: [], versionCreated: false })).toBeDefined()
    expect(def('report_compile').output?.render?.({}, { reportId: 'r', ok: false, diagnostics: [{ severity: 'error', line: 3, message: 'm' }], versionCreated: false })).toBeDefined()
    expect(def('report_compile').output?.render?.({}, { reportId: 'r', ok: false, diagnostics: [{ severity: 'warning', message: 'w' }], versionCreated: false })).toBeDefined()

    def('report_versions').presentCall?.({ reportId: 'r' })
    expect(def('report_versions').output?.render?.({}, { versions: [] })).toBeDefined()
    expect(def('report_versions').output?.render?.({}, { versions: [{ id: 'v', label: 'l' }] })).toBeDefined()

    def('report_restore').presentCall?.({ reportId: 'r', versionId: 'v' })
    expect(def('report_restore').output?.render?.({}, { reportId: 'r', source: 's' })).toBeDefined()
  })

  it('creates a report from a template id and an explicit source', async () => {
    const { ctx } = await harness()
    const value = await okValue(ctx, 'report_create', { title: 'R', templateId: 'builtin:report', source: '\\documentclass{report}' })
    expect(String(value.source)).toContain('report')
  })

  it('creates a report from a template by name', async () => {
    const { ctx } = await harness()
    const value = await okValue(ctx, 'report_create', { title: 'R', templateId: 'report' })
    expect(String(value.source)).toContain('\\documentclass[12pt]{report}')
  })

  it('rejects an unknown template and an unknown report', async () => {
    const { ctx } = await harness()
    const createResult = await callTool(ctx, 'report_create', { title: 'X', templateId: 'missing' })
    expect(createResult.isError).toBe(true)

    const readResult = await callTool(ctx, 'report_read', { reportId: 'missing' })
    expect(readResult.isError).toBe(true)

    const restoreResult = await callTool(ctx, 'report_restore', { reportId: 'missing', versionId: 'v' })
    expect(restoreResult.isError).toBe(true)
  })

  it('compiles a diagnostic without a source line and without a caller signal', async () => {
    const { ctx } = await harness({
      onRun: async (workdir) => { await writeArtifacts(workdir, { log: '! Fatal error' }) },
    })
    const created = await okValue(ctx, 'report_create', { title: 'A', source: 'x' })
    const def = ctx.tools.get('report_compile') as unknown as {
      execute?: (args: unknown, exec: unknown) => Promise<{ ok: boolean; diagnostics: { line?: number }[] }>
    }
    const result = await def.execute?.({ reportId: created.reportId }, { signal: undefined })
    expect(result?.ok).toBe(false)
    expect(result?.diagnostics[0]?.line).toBeUndefined()
  })
})
