/**
 * Model-facing librarian tools over the Library knowledge base. `library_ask`
 * is the primary interaction — question in, grounded cited answer out —
 * mirroring the DeepWiki MCP face (`ask_question` first, structure and
 * content reads second); `library_ingest` lets an agent file documents into a
 * notebook through the same entry point the UI upload uses.
 * @module @deepseek-ai/dsh-tool-library
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { ResourceId } from '@deepseek-ai/dsh-library'
import type { Notebook } from '@deepseek-ai/dsh-library'

export type {} from '@deepseek-ai/dsh-library'

export const name = 'tool-library'

export const inject = ['tools', 'librarian']

/** Model-facing output bounds, all changeable from cordis.yml. */
export interface Config {
  /** Maximum characters of converted Markdown returned by `library_read`. */
  readonly maxReadChars: number
}

/** Schemastery configuration for the librarian tools. */
export const Config: z<Config> = z.object({
  maxReadChars: z.number().step(1).min(1).default(20_000),
})

const NOTEBOOK_REF = 'A notebook id or its exact title; `library_structure` lists both.'

const text = (value: string): { type: 'text'; text: string } => ({ type: 'text', text: value })

/**
 * Register the librarian tools on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry and the librarian service.
 * @param config - validated output bounds.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(defineTool({
    name: 'library_ask',
    description:
      'Ask the Library (the research knowledge base) a question and get an answer grounded in '
      + 'the stored documents, with inline [source] citations. This is the primary way to use '
      + 'the knowledge base — prefer one good question over reading files one by one. '
      + 'Overview questions answer from each document\'s leading content; only an empty '
      + 'notebook declines.',
    parameters: {
      notebook: { type: 'string', required: true, description: NOTEBOOK_REF },
      question: { type: 'string', required: true, description: 'The question to answer from the notebook contents.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          answer: { type: 'string', required: true },
          grounded: { type: 'boolean', required: true },
          sources: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                heading: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [text(askText(value))],
    },
    execute: async (args, exec) => {
      const notebook = resolveNotebook(ctx, args.notebook)
      const result = await ctx.librarian.ask(notebook.id, args.question, exec.signal)
      return {
        answer: result.answer,
        grounded: result.grounded,
        sources: result.sources.map(source => ({ name: source.name, heading: source.heading })),
      }
    },
    presentCall: args => ({ card: 'generic', title: `Ask the library: ${args.question}`, kind: 'read', rawInput: args.notebook }),
  }))

  ctx.tools.register(defineTool({
    name: 'library_structure',
    description:
      'List the Library structure: every notebook (id and title) with its resources and their '
      + 'leading Markdown headings. Use this to discover what the knowledge base holds before '
      + 'asking or reading.',
    parameters: {
      notebook: { type: 'string', description: `Restrict to one notebook. ${NOTEBOOK_REF}` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          notebooks: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                notebookId: { type: 'string', required: true },
                title: { type: 'string', required: true },
                resources: {
                  type: 'array',
                  required: true,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      resourceId: { type: 'string', required: true },
                      name: { type: 'string', required: true },
                      kind: { type: 'string', required: true },
                      status: { type: 'string', required: true },
                      outline: { type: 'array', required: true, items: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      render: (_args, value) => [text(structureText(value.notebooks))],
    },
    execute: async (args) => {
      const scope = args.notebook === undefined ? undefined : resolveNotebook(ctx, args.notebook).id
      const structures = await ctx.librarian.structure(scope)
      return {
        notebooks: structures.map(structure => ({
          notebookId: String(structure.notebookId),
          title: structure.title,
          resources: structure.resources.map(resource => ({
            resourceId: String(resource.resourceId),
            name: resource.name,
            kind: resource.kind,
            status: resource.status,
            outline: [...resource.outline],
          })),
        })),
      }
    },
    presentCall: args => ({ card: 'generic', title: 'List library structure', kind: 'read', rawInput: args.notebook ?? 'all notebooks' }),
  }))

  ctx.tools.register(defineTool({
    name: 'library_read',
    description:
      'Read the converted Markdown of one library resource in full. Use after `library_ask` or '
      + '`library_structure` when you need the original wording; long documents are truncated '
      + 'and the returned flag tells you whether content was cut.',
    parameters: {
      resourceId: { type: 'string', required: true, description: 'A resource id from `library_structure`.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          resourceId: { type: 'string', required: true },
          name: { type: 'string', required: true },
          content: { type: 'string', required: true },
          truncated: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [text(readText(value))],
    },
    execute: async (args) => {
      const id = ResourceId(args.resourceId)
      const resource = ctx.librarian.resource(id)
      if (resource === undefined) throw new Error(`unknown resource '${args.resourceId}'`)
      const content = await ctx.librarian.readMarkdown(id)
      const truncated = content.length > config.maxReadChars
      return {
        resourceId: args.resourceId,
        name: resource.name,
        content: truncated ? content.slice(0, config.maxReadChars) : content,
        truncated,
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Read library resource', kind: 'read', rawInput: args.resourceId }),
  }))

  ctx.tools.register(defineTool({
    name: 'library_ingest',
    description:
      'File a document into a Library notebook: give literal text OR a readable file path. The '
      + 'document converts to Markdown and becomes part of the knowledge base (kind `source` for '
      + 'raw material, `result` for synthesized analysis, `deliverable` for finished outputs).',
    parameters: {
      notebook: { type: 'string', required: true, description: NOTEBOOK_REF },
      name: { type: 'string', required: true, description: 'Display name including an extension, e.g. `notes.md`.' },
      content: { type: 'string', description: 'Literal document text; exactly one of content and path.' },
      path: { type: 'string', description: 'Readable file path to ingest; exactly one of content and path.' },
      kind: { type: 'string', description: 'Content class: source (default), result, or deliverable.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          resourceId: { type: 'string', required: true },
          name: { type: 'string', required: true },
          status: { type: 'string', required: true },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => [text(ingestText(value))],
    },
    execute: async (args) => {
      if ((args.content === undefined) === (args.path === undefined)) {
        throw new Error('provide exactly one of content and path')
      }
      const notebook = resolveNotebook(ctx, args.notebook)
      const kind = args.kind === 'result' || args.kind === 'deliverable' ? args.kind : 'source'
      const resource = await ctx.librarian.ingest({
        notebookId: notebook.id,
        name: args.name,
        kind,
        content: args.content !== undefined ? { text: args.content } : { path: args.path as string },
      })
      return {
        resourceId: String(resource.id),
        name: resource.name,
        status: resource.status,
        ...(resource.error === undefined ? {} : { error: resource.error }),
      }
    },
    presentCall: args => ({ card: 'generic', title: `File "${args.name}" into the library`, kind: 'edit', rawInput: args.notebook }),
  }))
}

/** Resolve a notebook reference (id or exact title) or throw listing what exists. */
function resolveNotebook(ctx: Context, reference: string): Notebook {
  const notebooks = ctx.librarian.listNotebooks()
  const found = notebooks.find(notebook => String(notebook.id) === reference)
    ?? notebooks.find(notebook => notebook.title === reference)
  if (found === undefined) {
    const listing = notebooks.length === 0
      ? 'the library has no notebooks yet'
      : `known notebooks:\n${notebooks.map(notebook => `  ${notebook.id}: ${notebook.title}`).join('\n')}`
    throw new Error(`unknown notebook '${reference}'; ${listing}`)
  }
  return found
}

function askText(value: { answer: string; grounded: boolean; sources: { name: string; heading: string }[] }): string {
  if (!value.grounded) return value.answer
  const sources = value.sources.map(source =>
    `  - ${source.name}${source.heading === '' ? '' : ` (${source.heading})`}`).join('\n')
  return `${value.answer}\n\nSources:\n${sources}`
}

function structureText(notebooks: {
  notebookId: string
  title: string
  resources: { resourceId: string; name: string; kind: string; status: string; outline: string[] }[]
}[]): string {
  if (notebooks.length === 0) return 'The library has no notebooks yet.'
  return notebooks.map((notebook) => {
    const resources = notebook.resources.length === 0
      ? '  (empty)'
      : notebook.resources.map((resource) => {
        const outline = resource.outline.length === 0 ? '' : `\n      ${resource.outline.join(' · ')}`
        return `  - ${resource.name} [${resource.kind}, ${resource.status}] (${resource.resourceId})${outline}`
      }).join('\n')
    return `${notebook.title} (${notebook.notebookId})\n${resources}`
  }).join('\n\n')
}

function readText(value: { name: string; content: string; truncated: boolean }): string {
  const truncated = value.truncated ? '\n[content truncated]' : ''
  return `${value.name}:\n\n${value.content}${truncated}`
}

function ingestText(value: { resourceId: string; name: string; status: string; error?: string }): string {
  if (value.status === 'ready') return `Filed "${value.name}" as resource ${value.resourceId} (converted to Markdown).`
  return `Filed "${value.name}" as resource ${value.resourceId}, but conversion failed: ${value.error ?? 'unknown error'}. The original file is kept.`
}
