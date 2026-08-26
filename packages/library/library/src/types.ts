/**
 * Public vocabulary of the Library capability: branded ids, entity snapshots,
 * and the request/response types of the librarian service.
 * @module @deepseek-ai/dsh-library/src/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies one notebook (an independent knowledge base). */
export type NotebookId = Branded<'LibraryNotebookId'>

/** Identifies one resource stored inside a notebook. */
export type ResourceId = Branded<'LibraryResourceId'>

/**
 * Content classes a resource can carry, mirroring the Drill Library spec:
 * `source` is user-supplied raw material, `result` is model-synthesized
 * content flowing in from pipelines, and `deliverable` is a finished output
 * (for example a Writing report) archived for reference.
 */
export const RESOURCE_KINDS = ['source', 'result', 'deliverable'] as const

/** One of {@link RESOURCE_KINDS}. */
export type ResourceKind = (typeof RESOURCE_KINDS)[number]

/**
 * Conversion lifecycle of a resource: `converting` while a converter runs,
 * `ready` once Markdown exists beside the original, `error` when every
 * eligible converter failed (the original file is kept and previewable).
 */
export const RESOURCE_STATUSES = ['converting', 'ready', 'error'] as const

/** One of {@link RESOURCE_STATUSES}. */
export type ResourceStatus = (typeof RESOURCE_STATUSES)[number]

/** Immutable snapshot of one notebook. */
export interface Notebook {
  /** Notebook id; doubles as the notebook's directory name under the library root. */
  readonly id: NotebookId
  /** Display title; duplicates across notebooks are allowed. */
  readonly title: string
  /** ISO-8601 creation instant. */
  readonly createdAt: string
  /** ISO-8601 instant of the last durable mutation. */
  readonly updatedAt: string
}

/** Immutable snapshot of one resource. */
export interface Resource {
  /** Resource id; prefixes the stored file names. */
  readonly id: ResourceId
  /** Owning notebook id. */
  readonly notebookId: NotebookId
  /** Display name, taken from the uploaded file name or caller input. */
  readonly name: string
  /** Content class; see {@link RESOURCE_KINDS}. */
  readonly kind: ResourceKind
  /** Conversion lifecycle state; see {@link RESOURCE_STATUSES}. */
  readonly status: ResourceStatus
  /** Media type sniffed from the file name at ingest; `''` when unknown. */
  readonly mediaType: string
  /** Byte length of the stored original file. */
  readonly bytes: number
  /** Converter id that produced the Markdown; absent until `ready`. */
  readonly convertedBy?: string
  /** Failure summary; present only when {@link Resource.status} is `error`. */
  readonly error?: string
  /** ISO-8601 creation instant. */
  readonly createdAt: string
  /** ISO-8601 instant of the last durable mutation. */
  readonly updatedAt: string
}

/** Content payload of an ingest: exactly one of the three carriers. */
export type IngestContent =
  | { readonly data: Uint8Array }
  | { readonly text: string }
  | { readonly path: string }

/** Request to ingest one document into a notebook. */
export interface IngestRequest {
  /** Target notebook. */
  readonly notebookId: NotebookId
  /** Display name; its extension selects converters and the preview behavior. */
  readonly name: string
  /** Content class; defaults to `source`. */
  readonly kind?: ResourceKind
  /** The document content: raw bytes, literal text, or a readable file path. */
  readonly content: IngestContent
}

/** One cited grounding excerpt behind a librarian answer. */
export interface AskSource {
  /** Resource the excerpt came from. */
  readonly resourceId: ResourceId
  /** Resource display name (the citation label). */
  readonly name: string
  /** Nearest enclosing heading of the excerpt; `''` before the first heading. */
  readonly heading: string
}

/** A grounded librarian answer with its citations. */
export interface AskResult {
  /** Answer text; grounded in the returned sources only. */
  readonly answer: string
  /** Excerpt provenance, ordered by retrieval relevance. */
  readonly sources: readonly AskSource[]
  /** Whether any grounding excerpt was found (`false` answers decline). */
  readonly grounded: boolean
}

/** Structure listing of one resource inside {@link NotebookStructure}. */
export interface ResourceStructure {
  /** Resource id. */
  readonly resourceId: ResourceId
  /** Resource display name. */
  readonly name: string
  /** Content class. */
  readonly kind: ResourceKind
  /** Conversion state. */
  readonly status: ResourceStatus
  /** Leading Markdown headings of the converted document (empty until `ready`). */
  readonly outline: readonly string[]
}

/** Structure listing of one notebook. */
export interface NotebookStructure {
  /** Notebook id. */
  readonly notebookId: NotebookId
  /** Notebook display title. */
  readonly title: string
  /** Resources in creation order (newest first). */
  readonly resources: readonly ResourceStructure[]
}

/**
 * Media types recognized by the name-based sniffer, keyed by lowercase file
 * extension without the dot. Preview keys off these values: `application/pdf`
 * gets the PDF viewer and `text/*` renders inline.
 */
export const MEDIA_TYPES_BY_EXTENSION: Readonly<Record<string, string>> = Object.freeze({
  pdf: 'application/pdf',
  md: 'text/markdown',
  markdown: 'text/markdown',
  txt: 'text/plain',
  csv: 'text/csv',
  html: 'text/html',
  htm: 'text/html',
  json: 'application/json',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  doc: 'application/msword',
  epub: 'application/epub+zip',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
})

/**
 * Sniff a media type from a file name.
 * @param name - File name in any spelling; only the extension is read.
 * @returns the mapped media type, or `''` when the extension is unknown.
 */
export function mediaTypeOf(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return ''
  return MEDIA_TYPES_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? ''
}
