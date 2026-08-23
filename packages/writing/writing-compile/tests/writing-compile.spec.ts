import { afterEach, describe, expect, it } from 'vitest'
import { parseLatexLog } from '../src/index.ts'
import { setupHarness, writeArtifacts, outputRun, type TestHarness } from './helpers.ts'

const harnesses: TestHarness[] = []

async function harness(
  options: { readonly onRun?: (workdir: string) => void | Promise<void> } = {},
): Promise<TestHarness> {
  const value = await setupHarness(options)
  harnesses.push(value)
  return value
}

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map(value => value.dispose()))
})

describe('LatexCompileService', () => {
  it('rejects a report id that is not a safe path segment', async () => {
    const { ctx } = await harness()
    await expect(ctx.latexCompile.compile({ reportId: '../escape', source: 'x' }))
      .rejects.toThrow(/safe path segment/)
    await expect(ctx.latexCompile.compile({ reportId: 'a/b', source: 'x' }))
      .rejects.toThrow(/safe path segment/)
  })

  it('compiles cleanly and reports the produced PDF', async () => {
    const { ctx, shell } = await harness({
      onRun: async (workdir) => {
        await writeArtifacts(workdir, { log: '', pdf: true })
      },
    })
    const output = await ctx.latexCompile.compile({ reportId: 'report-a', source: '\\documentclass{article}' })
    expect(output.ok).toBe(true)
    expect(output.diagnostics).toEqual([])
    expect(output.pdfPath).toBeDefined()
    expect(shell.requested?.workdir).toContain('report-a')
  })

  it('returns exit-code failures with a nonzero os as not ok', async () => {
    const { ctx, shell } = await harness()
    shell.runResults = [outputRun({ exitCode: 1 })]
    const output = await ctx.latexCompile.compile({ reportId: 'report-b', source: 'x' })
    expect(output.ok).toBe(false)
    expect(output.pdfPath).toBeUndefined()
  })

  it('flags an error diagnostic even when the engine exits 0', async () => {
    const { ctx } = await harness({
      onRun: async (workdir) => {
        await writeArtifacts(workdir, {
          log: '! Package babel Error: language not defined.\nl.7 \\usepackage[english]{babel}',
        })
      },
    })
    const output = await ctx.latexCompile.compile({ reportId: 'report-c', source: 'x' })
    expect(output.ok).toBe(false)
    expect(output.diagnostics[0]?.severity).toBe('error')
    expect(output.diagnostics[0]?.line).toBe(7)
  })

  it('reports warnings alongside an otherwise clean build', async () => {
    const { ctx } = await harness({
      onRun: async (workdir) => {
        await writeArtifacts(workdir, {
          log: 'LaTeX Warning: Reference `x\' on page 1 undefined on input line 9.\nOverfull \\hbox (10.0pt too wide) in paragraph at lines 12--13',
        })
      },
    })
    const output = await ctx.latexCompile.compile({ reportId: 'report-d', source: 'x' })
    expect(output.diagnostics.length).toBe(2)
    expect(output.diagnostics.every(diagnostic => diagnostic.severity === 'warning')).toBe(true)
  })
})

describe('parseLatexLog', () => {
  it('parses nothing from an empty log', () => {
    expect(parseLatexLog('')).toEqual([])
  })

  it('attaches the source line to a following error', () => {
    const log = ['! Undefined control sequence.', 'l.5 \\foo', '! LaTeX Error: Missing $ inserted.', 'l.12 \\bar'].join('\n')
    const diagnostics = parseLatexLog(log)
    expect(diagnostics.length).toBe(2)
    expect(diagnostics[0]).toEqual({ severity: 'error', line: 5, message: 'Undefined control sequence.' })
    expect(diagnostics[1]).toEqual({ severity: 'error', line: 12, message: 'LaTeX Error: Missing $ inserted.' })
  })

  it('sorts errors before warnings', () => {
    const log = ['LaTeX Warning: W1', '! E1', 'l.3 \\x'].join('\n')
    const diagnostics = parseLatexLog(log)
    expect(diagnostics[0]?.severity).toBe('error')
    expect(diagnostics[1]?.severity).toBe('warning')
  })
})

describe('delivery PDF path', () => {
  it('is undefined before compile and resolves after a successful one', async () => {
    const { ctx } = await harness()
    expect(await ctx.latexCompile.pdfPath('report-e')).toBeUndefined()

    const another = await harness({
      onRun: async (workdir) => { await writeArtifacts(workdir, { log: '', pdf: true }) },
    })
    const output = await another.ctx.latexCompile.compile({ reportId: 'report-e', source: 'x' })
    expect(output.ok).toBe(true)
    expect(await another.ctx.latexCompile.pdfPath('report-e')).toBe(output.pdfPath)
  })
})
