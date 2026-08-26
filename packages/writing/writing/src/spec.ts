/**
 * Durable storage-domain declaration for report projects, their version
 * snapshots, and their templates. The zod schemas are the durable-boundary
 * validators and the direct source of the RPC wire projection.
 * @module @deepseek-ai/dsh-writing/src/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { ReportId, TemplateId, VersionId } from './types.ts'

/** Report id schema at the durable boundary; branding has no runtime representation. */
const reportId = z.string().min(1).transform(value => value as ReportId)

/** Template id schema at the durable boundary. */
const templateId = z.string().min(1).transform(value => value as TemplateId)

const isoInstant = z.string().min(1)

/**
 * Durable shape of one report record. `source` is the current LaTeX text;
 * `templateId` is frozen at create; timestamps are ISO-8601 strings.
 */
export const reportRecord = z.object({
  title: z.string(),
  templateId,
  source: z.string(),
  createdAt: isoInstant,
  updatedAt: isoInstant,
})

/** One stored report record, inferred from {@link reportRecord}. */
export type ReportRecord = z.infer<typeof reportRecord>

/**
 * Durable shape of one immutable version snapshot. Snapshots keep the full
 * source text plus a stable label; they are written once and never updated.
 */
export const reportVersionRecord = z.object({
  reportId,
  label: z.string(),
  source: z.string(),
  createdAt: isoInstant,
})

/** One stored version snapshot, inferred from {@link reportVersionRecord}. */
export type ReportVersionRecord = z.infer<typeof reportVersionRecord>

/**
 * Durable shape of one template record. `name` is unique across templates;
 * `builtIn` marks shipped templates (never deletable); `source` is the LaTeX
 * template text.
 */
export const reportTemplateRecord = z.object({
  name: z.string(),
  source: z.string(),
  builtIn: z.boolean(),
  createdAt: isoInstant,
})

/** One stored template record, inferred from {@link reportTemplateRecord}. */
export type ReportTemplateRecord = z.infer<typeof reportTemplateRecord>

/**
 * The writing domain spec: three tables over one `writing` unit. The domain
 * registry opens this through `ctx.storageDomain`; the spec object is the
 * single source of the domain's identity, version, and schemas.
 */
export const writingDomainSpec = defineDomain({
  name: 'writing',
  version: 1,
  tables: {
    reports: domainTable<ReportId, ReportRecord>(reportRecord),
    versions: domainTable<VersionId, ReportVersionRecord>(reportVersionRecord),
    templates: domainTable<TemplateId, ReportTemplateRecord>(reportTemplateRecord),
  },
})
