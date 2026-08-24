import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import ReportService from '@deepseek-ai/dsh-writing'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as WritingInvariant from '../src/invariant.ts'

describe('report registry invariants', () => {
  it('registers the companion and runs the install', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-writing-invariant-'))
    const ctx = new Context()
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root })
    await ctx.plugin(StorageDomain, { backend: 'json' })
    await ctx.plugin(ReportService)
    await ctx.plugin(InvariantRegistry, { enabled: true })

    await expect(ctx.plugin(WritingInvariant)).resolves.toBeDefined()
    await new Promise(resolve => setImmediate(resolve))

    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
})
