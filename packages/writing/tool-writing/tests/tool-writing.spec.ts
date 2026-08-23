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
    const { ctx, shell } = await harness({
      onRun: async (workdir) => { await writeArtifacts(workdir, { log: '! Undefined control sequence.\nl.5 \\foo' }) },
    })
    const created = await okValue(ctx, 'report_create', { title: 'A', source: '\\foo' })
    const reportId = created.reportId as string

    // One failing compile: the shell returns exit 1.
    shell.runResults = [outputRun({ exitCode: 1 })]
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
