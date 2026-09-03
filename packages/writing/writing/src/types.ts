/**
 * Public type vocabulary of the writing entity: the `ReportId`, `VersionId`,
 * and `TemplateId` brands plus the consumer-facing report, version, and
 * template interfaces. Types only — the branded factories live in `index.ts`
 * (this file carries no runtime code).
 * @module @deepseek-ai/dsh-writing/src/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies one report project record. Generated uuid, stable across renames. */
export type ReportId = Branded<'ReportId'>

/** Identifies one version snapshot of a report. Generated uuid, immutable. */
export type VersionId = Branded<'VersionId'>

/** Identifies one report template. Built-in templates use derived ids; custom ones are uuids. */
export type TemplateId = Branded<'TemplateId'>

/**
 * One report project: a stable id, a display title, the template it was
 * seeded from, and the current LaTeX source. Consumers only see this
 * interface; the implementation is the service's frozen projection.
 */
export interface Report {
  /** Stable record id (generated uuid). */
  readonly id: ReportId
  /** Display title; duplicates across reports are allowed. */
  readonly title: string
  /** Template that seeded the initial source, never rewritten afterwards. */
  readonly templateId: TemplateId
  /** Current LaTeX source text (UI snapshot; the file under `workspaceDir` is authoritative). */
  readonly source: string
  /** Session workspace directory holding the report's source file + git repository. */
  readonly workspaceDir: string
  /** ISO-8601 creation instant. */
  readonly createdAt: string
  /** ISO-8601 instant of the last durable mutation. */
  readonly updatedAt: string
}

/**
 * One immutable version snapshot. A snapshot is the full source text at a
 * point in time plus a human-readable label; it is never mutated in place.
 */
export interface ReportVersion {
  /** Stable version id (generated uuid). */
  readonly id: VersionId
  /** Report this snapshot belongs to. */
  readonly reportId: ReportId
  /** Human-readable label, e.g. "successful compile #3". */
  readonly label: string
  /** The complete LaTeX source captured at snapshot time. */
  readonly source: string
  /** ISO-8601 snapshot instant. */
  readonly createdAt: string
}

/**
 * One report template. A template is the LaTeX source baked into a new report
 * plus metadata. Built-in templates are fixed and cannot be deleted; custom
 * templates are user-added and deletable.
 */
export interface ReportTemplate {
  /** Stable template id. */
  readonly id: TemplateId
  /** Display name, unique across templates. */
  readonly name: string
  /** LaTeX template source, possibly carrying `%%TITLE%%`-style placeholders. */
  readonly source: string
  /** Whether this is a shipped built-in template rather than a custom upload. */
  readonly builtIn: boolean
  /** ISO-8601 creation instant. */
  readonly createdAt: string
}

/**
 * A create-report request: a display title, an optional template to seed the
 * source from, and an optional initial source. When `source` is omitted the
 * template source is used; when `templateId` is also omitted the first
 * built-in template defaults. When `source` is provided it wins over the
 * template.
 */
export interface CreateReportRequest {
  /** Display title. */
  readonly title: string
  /** Template to seed from; omitted picks the default built-in template. */
  readonly templateId?: TemplateId
  /** Explicit initial source; wins over the template source. */
  readonly source?: string
  /** Session workspace directory holding the report's source file + git repository. */
  readonly workspaceDir?: string
}

/** An add-template request: a display name and the LaTeX template source. */
export interface AddTemplateRequest {
  /** Display name, unique across templates. */
  readonly name: string
  /** LaTeX template source. */
  readonly source: string
}
