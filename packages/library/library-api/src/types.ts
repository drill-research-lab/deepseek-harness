/**
 * Wire contract of the library Remote namespace: plain-JSON request and view
 * types shared by the Host gateway and the generated browser client.
 * @module @deepseek-ai/dsh-library-api/src/types
 */

/** One notebook row for the browser. */
export interface NotebookView {
  /** Notebook id. */
  readonly notebookId: string
  /** Display title. */
  readonly title: string
  /** Number of resources currently stored. */
  readonly resourceCount: number
  /** ISO-8601 creation instant. */
  readonly createdAt: string
  /** ISO-8601 last-mutation instant. */
  readonly updatedAt: string
}

/** One resource row for the browser. */
export interface ResourceView {
  /** Resource id. */
  readonly resourceId: string
  /** Owning notebook id. */
  readonly notebookId: string
  /** Display name. */
  readonly name: string
  /** Content class: `source`, `result`, or `deliverable`. */
  readonly kind: string
  /** Conversion state: `converting`, `ready`, or `error`. */
  readonly status: string
  /** Sniffed media type; `''` when unknown. */
  readonly mediaType: string
  /** Original file size in bytes. */
  readonly bytes: number
  /** Conversion failure summary; present only on `error`. */
  readonly error?: string
  /** ISO-8601 creation instant. */
  readonly createdAt: string
  /** ISO-8601 last-mutation instant. */
  readonly updatedAt: string
}

/** Request to create one notebook. */
export interface CreateNotebookRequest {
  /** Display title. */
  readonly title: string
}

/** Request to rename one notebook. */
export interface RenameNotebookRequest {
  /** Notebook id. */
  readonly notebookId: string
  /** New display title. */
  readonly title: string
}

/** Request addressing one notebook. */
export interface NotebookRequest {
  /** Notebook id. */
  readonly notebookId: string
}

/** Request addressing one resource. */
export interface ResourceRequest {
  /** Resource id. */
  readonly resourceId: string
}

/** Request to ingest pasted text as a new resource. */
export interface IngestTextRequest {
  /** Target notebook id. */
  readonly notebookId: string
  /** Display name for the pasted content (extension selects preview behavior). */
  readonly name: string
  /** The pasted text. */
  readonly text: string
  /** Content class; defaults to `source`. */
  readonly kind?: string
}

/** Converted-Markdown payload of one resource. */
export interface MarkdownView {
  /** Resource id. */
  readonly resourceId: string
  /** The converted Markdown text. */
  readonly content: string
}

/** Request to answer one question from a notebook. */
export interface AskRequest {
  /** Notebook id. */
  readonly notebookId: string
  /** Natural-language question. */
  readonly question: string
}

/** One cited source behind an answer. */
export interface AskSourceView {
  /** Resource the excerpt came from. */
  readonly resourceId: string
  /** Resource display name (the citation label). */
  readonly name: string
  /** Nearest enclosing heading of the excerpt; `''` before the first heading. */
  readonly heading: string
}

/** A grounded answer with its citations. */
export interface AskView {
  /** Answer text. */
  readonly answer: string
  /** Excerpt provenance, ordered by retrieval relevance. */
  readonly sources: readonly AskSourceView[]
  /** Whether any grounding excerpt was found (`false` answers decline). */
  readonly grounded: boolean
}
