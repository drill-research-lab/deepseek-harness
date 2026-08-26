import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import ReportService from '../src/index.ts'

export interface TestHarness {
  readonly ctx: Context
  readonly root: string
  dispose(): Promise<void>
}

/** Compose the report registry over the real storage hub/domain/JSON backend. */
export async function setupHarness(): Promise<TestHarness> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-writing-test-'))
  const ctx = new Context()
  try {
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root })
    await ctx.plugin(StorageDomain, { backend: 'json' })
    await ctx.plugin(ReportService)
  } catch (error) {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
    throw error
  }
  return {
    ctx,
    root,
    async dispose() {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    },
  }
}
