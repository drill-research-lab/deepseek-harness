/**
 * Model-facing librarian tools over the Library knowledge base, mirroring the
 * DeepWiki MCP face: `library_ask` is the primary interaction — question in,
 * grounded cited answer out — with `library_structure` and `library_read` as
 * the direct navigation and content reads beside it, and `library_ingest` as
 * the programmatic write entry the UI upload shares. Asking delegates to the
 * `librarian` subagent when one is mounted (the issue-#23 workflow: the child
 * navigates the notebook with structure/read and answers with citations);
 * without a subagent runtime the service's direct retrieval-and-answer route
 * answers instead. Both routes land in the notebook's ask log.
 * @module @deepseek-ai/dsh-tool-library
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createConverter } from 'zhtw-js'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { ResourceId } from '@deepseek-ai/dsh-library'
import type { AskResult, AskSource, Notebook } from '@deepseek-ai/dsh-library'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
// Type-only: resolves ctx.get('subagents') for the librarian delegation route.
import type {} from '@deepseek-ai/dsh-subagent'
import type { SubagentRun } from '@deepseek-ai/dsh-subagent'

export type {} from '@deepseek-ai/dsh-library'

export const name = 'tool-library'

export const inject = ['tools', 'librarian']

/** The subagent provider name `library_ask` delegates to when mounted. */
export const LIBRARIAN_PROVIDER = 'librarian'

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
      + 'The question is answered by the librarian agent reading the notebook; only an empty '
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
      const delegated = await askViaLibrarian(ctx, notebook, args.question, exec)
      const result = delegated
        ?? await ctx.librarian.ask(notebook.id, args.question, exec.signal, 'agent')
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
      'List the Library structure: every notebook (id and title) with its resources, their '
      + 'leading Markdown headings, and a leading excerpt — served from the ingest-time index. '
      + 'Use this to discover what the knowledge base holds before asking or reading.',
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
                      summary: { type: 'string', required: true },
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
            summary: resource.summary,
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

/**
 * Answer one question through the `librarian` subagent — the issue-#23
 * `ask_question` workflow: a fresh librarian child navigates the notebook
 * with `library_structure` and `library_read` (asking and filing are filtered
 * out so a child never recurses into this tool) and answers with inline
 * [name] citations. Sources are recovered from those citations against the
 * notebook's resource names, and the exchange lands in the notebook's ask
 * log as an agent entry.
 * @param ctx - registrant context.
 * @param notebook - resolved target notebook.
 * @param question - the question as asked.
 * @param exec - the tool execution (calling agent + cancellation).
 * @returns the answer, or `undefined` when no delegation route exists
 *   (no subagent runtime, no `librarian` provider, or a non-agent caller).
 */
async function askViaLibrarian(
  ctx: Context,
  notebook: Notebook,
  question: string,
  exec: ToolRunContext,
): Promise<AskResult | undefined> {
  const subagents = ctx.get('subagents')
  const parent = exec.agent
  if (subagents === undefined || parent === undefined) return undefined
  if (subagents.getProvider(LIBRARIAN_PROVIDER) === undefined) return undefined
  const prompt: ContentBlock[] = [{
    type: 'text',
    text:
      `Answer one question from the Library notebook "${notebook.title}" (notebook id ${notebook.id}).\n\n`
      + `Question: ${question}\n\n`
      + 'Ground yourself in this notebook only: call library_structure with the notebook id to see its '
      + 'resources, outlines, and summaries, read the relevant resources with library_read, then answer '
      + 'the question in the question\'s language. Cite the documents you used inline as [name] after each '
      + 'claim, exactly matching their resource names. When the notebook does not contain the answer, say '
      + 'so plainly instead of guessing.',
  }]
  const run: SubagentRun = await subagents.start(LIBRARIAN_PROVIDER, {
    label: `Library ask: ${question.length > 60 ? `${question.slice(0, 60)}…` : question}`,
    prompt,
    parent,
    signal: exec.signal,
    toolFilter: { deny: ['library_ask', 'library_ingest'] },
  })
  // Collect, then dispose — a disposal failure must not mask the result.
  const [execution] = await Promise.allSettled([run.result])
  const [disposal] = await Promise.allSettled([Promise.resolve().then(() => run.dispose())])
  if (execution.status === 'rejected') throw execution.reason
  if (disposal.status === 'rejected') throw disposal.reason
  const result = execution.value
  if (result.stopReason !== 'completed') {
    throw new Error(`librarian subagent ended with '${result.stopReason}' instead of an answer`)
  }
  const answer = result.output
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim()
  if (answer === '') throw new Error('librarian subagent finished without an answer')
  const sources = citedSources(ctx, notebook, answer)
  const recorded: AskResult = { answer, grounded: true, sources }
  await ctx.librarian.recordAsk(notebook.id, { origin: 'agent', question, ...recorded })
  return recorded
}

/** Recover cited sources from inline [name] citations against the notebook's resources. */
function citedSources(ctx: Context, notebook: Notebook, answer: string): AskSource[] {
  return ctx.librarian.listResources(notebook.id)
    .filter(resource => answer.includes(`[${resource.name}]`))
    .map(resource => ({ resourceId: resource.id, name: resource.name, heading: '' }))
}

const titleConverter = createConverter()

/**
 * Title-matching normal form: trimmed and converted through the zh-TW
 * converter, so a model writing a notebook title in Simplified Chinese still
 * matches the stored Traditional title.
 * @param value - Reference or stored title.
 * @returns the comparison form.
 */
function normalizeTitle(value: string): string {
  return titleConverter.convert(value.trim())
}

/** Resolve a notebook reference (id or title, Simplified/Traditional-insensitive) or throw listing what exists. */
function resolveNotebook(ctx: Context, reference: string): Notebook {
  const notebooks = ctx.librarian.listNotebooks()
  const wanted = normalizeTitle(reference)
  const found = notebooks.find(notebook => String(notebook.id) === reference.trim())
    ?? notebooks.find(notebook => normalizeTitle(notebook.title) === wanted)
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
  resources: { resourceId: string; name: string; kind: string; status: string; outline: string[]; summary: string }[]
}[]): string {
  if (notebooks.length === 0) return 'The library has no notebooks yet.'
  return notebooks.map((notebook) => {
    const resources = notebook.resources.length === 0
      ? '  (empty)'
      : notebook.resources.map((resource) => {
        const outline = resource.outline.length === 0 ? '' : `\n      ${resource.outline.join(' · ')}`
        const summary = resource.summary === '' ? '' : `\n      ${resource.summary}`
        return `  - ${resource.name} [${resource.kind}, ${resource.status}] (${resource.resourceId})${outline}${summary}`
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
