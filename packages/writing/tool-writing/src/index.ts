/**
 * Model-facing writing tools: create, edit, read, compile, and version LaTeX
 * reports. Successfully compiled reports are version-snapshotted automatically,
 * closing the write ??compile ??fix loop for the writer agent.
 * @module @deepseek-ai/dsh-tool-writing
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { ReportId as reportId, TemplateId as templateId, VersionId as versionId } from '@deepseek-ai/dsh-writing'

export type {} from '@deepseek-ai/dsh-writing'
export type {} from '@deepseek-ai/dsh-writing-compile'

export const name = 'tool-writing'

export const inject = ['tools', 'reports', 'latexCompile']

/** Model-facing output bounds, all changeable from cordis.yml. */
export interface Config {
  /** Maximum characters of report source returned by `report_read`. */
  readonly maxReadChars: number
  /** Maximum diagnostics returned by `report_compile`. */
  readonly maxDiagnostics: number
}

/** Schemastery configuration for the writing tools. */
export const Config: z<Config> = z.object({
  maxReadChars: z.number().step(1).min(1).default(20_000),
  maxDiagnostics: z.number().step(1).min(1).default(50),
})

const TOOL_IDS = 'Report ids are the string id returned by `report_create`.'

const text = (value: string): { type: 'text'; text: string } => ({ type: 'text', text: value })

/**
 * Register the writing tools on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry, report registry, and compile service.
 * @param config - validated output bounds.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(defineTool({
    name: 'report_create',
    description:
      'Create a new LaTeX report from a display title, an optional template, and optional '
      + 'initial source. Use a built-in template name (`article`, `academic-proposal`, '
      + '`report`) or a template id. Returns the new report id and its source.',
    parameters: {
      title: { type: 'string', required: true, description: 'Display title for the report.' },
      templateId: { type: 'string', description: 'Template id or name; omit for the default article template.' },
      source: { type: 'string', description: 'Initial LaTeX source; wins over the template source.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          reportId: { type: 'string', required: true },
          title: { type: 'string', required: true },
          source: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [text(`Created report ${value.reportId} ("${value.title}").\n\nSource:\n${value.source}`)],
    },
    execute: async (args) => {
      const resolvedTemplate = args.templateId === undefined ? undefined : resolveTemplateId(ctx, args.templateId)
      const source = args.source === undefined ? undefined : args.source
      const report = await ctx.reports.create({
        title: args.title,
        ...(resolvedTemplate === undefined ? {} : { templateId: resolvedTemplate }),
        ...(source === undefined ? {} : { source }),
      })
      return { reportId: String(report.id), title: report.title, source: report.source }
    },
    presentCall: args => ({ card: 'generic', title: `Create report "${args.title}"`, kind: 'other', rawInput: args.title }),
  }))

  ctx.tools.register(defineTool({
    name: 'report_write',
    description:
      'Replace the ENTIRE LaTeX source of one report. The previous source is discarded. '
      + 'Use `report_read` first to see the current source, then provide the full replacement. '
      + 'A write is autosaved but does not snapshot a version.',
    parameters: {
      reportId: { type: 'string', required: true, description: TOOL_IDS },
      source: { type: 'string', required: true, description: 'The complete replacement LaTeX source.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          reportId: { type: 'string', required: true },
          chars: { type: 'integer', required: true },
          updatedAt: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [text(`Wrote ${value.chars} characters to report ${value.reportId}.`)],
    },
    execute: async (args) => {
      const report = await ctx.reports.updateContent(reportId(args.reportId), args.source)
      return { reportId: String(report.id), chars: report.source.length, updatedAt: report.updatedAt }
    },
    presentCall: args => ({ card: 'generic', title: `Write report ${args.reportId}`, kind: 'edit', rawInput: args.reportId }),
  }))

  ctx.tools.register(defineTool({
    name: 'report_read',
    description:
      'Read the current LaTeX source of one report. Use before editing. Long reports are '
      + 'truncated; the returned flag tells you whether the source was cut.',
    parameters: {
      reportId: { type: 'string', required: true, description: TOOL_IDS },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          reportId: { type: 'string', required: true },
          source: { type: 'string', required: true },
          truncated: { type: 'boolean', required: true },
          versionCount: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [text(readText(value))],
    },
    execute: async (args) => {
      const report = requireReport(ctx, reportId(args.reportId))
      const source = report.source
      const truncated = source.length > config.maxReadChars
      const clipped = truncated ? source.slice(0, config.maxReadChars) : source
      return {
        reportId: String(report.id),
        source: clipped,
        truncated,
        versionCount: ctx.reports.listVersions(report.id).length,
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Read report source', kind: 'read', rawInput: args.reportId }),
  }))

  ctx.tools.register(defineTool({
    name: 'report_compile',
    description:
      'Compile the current source of one report to PDF. Compiler errors and warnings are '
      + 'returned as diagnostics. On a successful compile a version snapshot is created '
      + 'automatically. Keep calling `report_compile` after `report_write` until it reports '
      + 'success.',
    parameters: {
      reportId: { type: 'string', required: true, description: TOOL_IDS },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          reportId: { type: 'string', required: true },
          ok: { type: 'boolean', required: true },
          diagnostics: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                severity: { type: 'string', required: true },
                line: { type: 'integer' },
                message: { type: 'string', required: true },
              },
            },
          },
          versionCreated: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [text(compileText(value))],
    },
    execute: async (args, exec) => {
      const report = requireReport(ctx, reportId(args.reportId))
      const output = await ctx.latexCompile.compile({
        reportId: args.reportId,
        source: report.source,
        ...(exec.signal === undefined ? {} : { signal: exec.signal }),
      })
      const diagnostics = output.diagnostics.slice(0, config.maxDiagnostics).map(diagnostic => ({
        severity: diagnostic.severity,
        ...(diagnostic.line === undefined ? {} : { line: diagnostic.line }),
        message: diagnostic.message,
      }))
      let versionCreated = false
      if (output.ok) {
        const count = ctx.reports.listVersions(report.id).length + 1
        await ctx.reports.snapshot(report.id, `successful compile #${count}`)
        versionCreated = true
      }
      return { reportId: String(report.id), ok: output.ok, diagnostics, versionCreated }
    },
    presentCall: args => ({ card: 'terminal', title: `Compile report ${args.reportId}`, description: 'Compile the report source to PDF.' }),
  }))

  ctx.tools.register(defineTool({
    name: 'report_versions',
    description:
      'List the version snapshots of one report, newest first. Each snapshot was captured at a '
      + 'point its source compiled successfully (or was snapshotted explicitly).',
    parameters: {
      reportId: { type: 'string', required: true, description: TOOL_IDS },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          versions: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                label: { type: 'string', required: true },
                createdAt: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [text(versionsText(value.versions))],
    },
    execute: async (args) => {
      const versions = ctx.reports.listVersions(reportId(args.reportId))
      return {
        versions: versions.map(version => ({ id: String(version.id), label: version.label, createdAt: version.createdAt })),
      }
    },
    presentCall: args => ({ card: 'generic', title: 'List report versions', kind: 'other', rawInput: args.reportId }),
  }))

  ctx.tools.register(defineTool({
    name: 'report_restore',
    description:
      'Restore one report to an earlier version snapshot. The current source is replaced by the '
      + 'snapshot source; recompile afterwards.',
    parameters: {
      reportId: { type: 'string', required: true, description: TOOL_IDS },
      versionId: { type: 'string', required: true, description: 'A version id from `report_versions`.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          reportId: { type: 'string', required: true },
          source: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [text(`Restored report ${value.reportId}.\n\nSource:\n${value.source}`)],
    },
    execute: async (args) => {
      const report = await ctx.reports.restoreVersion(reportId(args.reportId), versionId(args.versionId))
      return { reportId: String(report.id), source: report.source }
    },
    presentCall: args => ({ card: 'generic', title: `Restore report ${args.reportId}`, kind: 'edit', rawInput: args.versionId }),
  }))
}

/** Resolve a template id from either an id or a built-in template name. */
function resolveTemplateId(ctx: Context, candidate: string): ReturnType<typeof templateId> {
  const canonical = templateId(candidate)
  if (ctx.reports.template(canonical) !== undefined) return canonical
  const named = ctx.reports.listTemplates().find(template => template.name === candidate)
  if (named === undefined) throw new Error(`unknown template '${candidate}'`)
  return named.id
}

/** Require a live report or throw on an unknown id. */
function requireReport(ctx: Context, id: ReturnType<typeof reportId>) {
  const report = ctx.reports.get(id)
  if (report === undefined) throw new Error(`unknown report '${String(id)}'`)
  return report
}

function readText(value: { reportId: string; source: string; truncated: boolean; versionCount: number }): string {
  const truncated = value.truncated ? '\n[source truncated]' : ''
  return `Report ${value.reportId}: ${value.versionCount} version(s).\n\nSource:\n${value.source}${truncated}`
}

function compileText(value: {
  reportId: string
  ok: boolean
  diagnostics: { severity: string; line?: number; message: string }[]
  versionCreated: boolean
}): string {
  if (value.ok) {
    const version = value.versionCreated ? ' A version snapshot was created.' : ''
    return `Report ${value.reportId} compiled successfully.${version}`
  }
  const lines = value.diagnostics.map(diagnostic =>
    `  [${diagnostic.severity}]${diagnostic.line === undefined ? '' : ` line ${diagnostic.line}`}: ${diagnostic.message}`)
  return `Report ${value.reportId} failed to compile:\n${lines.join('\n')}`
}

function versionsText(versions: { id: string; label: string }[]): string {
  if (versions.length === 0) return 'No version snapshots yet.'
  return versions.map(version => `  ${version.id} (${version.label})`).join('\n')
}
