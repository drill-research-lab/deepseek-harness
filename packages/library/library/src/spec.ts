/**
 * Durable storage-domain declaration for Library notebooks and their
 * resources. The zod schemas are the durable-boundary validators; entity
 * snapshots project from these records plus the table key.
 * @module @deepseek-ai/dsh-library/src/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { RESOURCE_KINDS, RESOURCE_STATUSES } from './types.ts'
import type { NotebookId, ResourceId } from './types.ts'

/** Notebook id schema at the durable boundary; branding has no runtime representation. */
const notebookId = z.string().min(1).transform(value => value as NotebookId)

const isoInstant = z.string().min(1)

/** Durable shape of one notebook record. */
export const notebookRecord = z.object({
  title: z.string(),
  createdAt: isoInstant,
  updatedAt: isoInstant,
})

/** One stored notebook record, inferred from {@link notebookRecord}. */
export type NotebookRecord = z.infer<typeof notebookRecord>

/**
 * Durable shape of one resource record. `originalFile` and `markdownFile` are
 * file names relative to the owning notebook's directory under the library
 * root, so relocating the root (or a future per-user rebase) never rewrites
 * records.
 */
export const resourceRecord = z.object({
  notebookId,
  name: z.string().min(1),
  kind: z.enum(RESOURCE_KINDS),
  status: z.enum(RESOURCE_STATUSES),
  mediaType: z.string(),
  bytes: z.number().int().nonnegative(),
  originalFile: z.string().min(1),
  markdownFile: z.string().optional(),
  convertedBy: z.string().optional(),
  error: z.string().optional(),
  createdAt: isoInstant,
  updatedAt: isoInstant,
})

/** One stored resource record, inferred from {@link resourceRecord}. */
export type ResourceRecord = z.infer<typeof resourceRecord>

/**
 * The library domain spec: two tables over one `library` unit. The librarian
 * service opens this through `ctx.storageDomain`; the spec object is the
 * single source of the domain's identity, version, and schemas.
 */
export const libraryDomainSpec = defineDomain({
  name: 'library',
  version: 1,
  tables: {
    notebooks: domainTable<NotebookId, NotebookRecord>(notebookRecord),
    resources: domainTable<ResourceId, ResourceRecord>(resourceRecord),
  },
})
