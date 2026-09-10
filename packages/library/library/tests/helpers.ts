import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import LibrarianService, { LIBRARIAN_PROMPT } from '../src/index.ts'

export interface TestHarness {
  readonly ctx: Context
  readonly root: string
  dispose(): Promise<void>
}

/** Compose the librarian over the real storage hub/domain/JSON backend in a temp home. */
export async function setupHarness(): Promise<TestHarness> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-library-test-'))
  const ctx = new Context()
  try {
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root: join(root, 'storages') })
    await ctx.plugin(StorageDomain, { backend: 'json' })
    // markitdown stays off so tests exercise the built-in text converter only.
    await ctx.plugin(LibrarianService, {
      dshHome: root,
      markitdown: false,
      python: 'python',
      convertTimeoutMs: 120_000,
      persona: LIBRARIAN_PROMPT,
      traditionalChinese: true,
      searchLimit: 8,
      maxAnswerTokens: 2048,
      askTimeoutMs: 60_000,
    })
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
