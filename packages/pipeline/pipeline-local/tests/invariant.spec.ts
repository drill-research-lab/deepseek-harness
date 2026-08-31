import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import PipelineEngine from '@deepseek-ai/dsh-pipeline'
import type { PipelineSaveRequest, WorkflowJson } from '@deepseek-ai/dsh-pipeline'
import PipelineLocalEngine from '@deepseek-ai/dsh-pipeline-local'
import { checkRegistryConsistency } from '@deepseek-ai/dsh-pipeline-local/invariant'
import * as PipelineLocalInvariant from '@deepseek-ai/dsh-pipeline-local/invariant'

const CLEANUP: string[] = []

function tempStorage(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pipeline-local-invariant-'))
  CLEANUP.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of CLEANUP.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('checkRegistryConsistency', () => {
  it('accepts matching index and definition sets', () => {
    expect(() => {
      checkRegistryConsistency(['a', 'b'], ['b', 'a'], () => {
        throw new Error('must not fail')
      })
    }).not.toThrow()
  })

  it('rejects an unindexed definition and an index entry without a definition', () => {
    expect(() => {
      checkRegistryConsistency(['a'], ['a', 'ghost'], (message) => {
        throw new Error(message)
      })
    }).toThrow(/definition "ghost" is not indexed/)
    expect(() => {
      checkRegistryConsistency(['a', 'orphan'], ['a'], (message) => {
        throw new Error(message)
      })
    }).toThrow(/index entry "orphan" has no definition/)
  })
})

/** A foreign PipelineEngine implementation: the invariant must reject it. */
class ForeignEngine extends PipelineEngine {
  list(): readonly [] {
    return []
  }

  get(): WorkflowJson | undefined {
    return undefined
  }

  async save(request: PipelineSaveRequest): Promise<WorkflowJson> {
    void request
    throw new Error('not under test')
  }

  async delete(): Promise<boolean> {
    return false
  }

  async setEnabled(): Promise<boolean> {
    return false
  }

  startRun(): never {
    throw new Error('not under test')
  }
}

describe('pipeline-local invariant companion', () => {
  it('verifies a consistent live registry and disposes cleanly', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(PipelineLocalEngine, { storageDir: tempStorage() })
    const fiber = await ctx.plugin(PipelineLocalInvariant)
    expect(typeof fiber.dispose).toBe('function')
    await fiber.dispose()
  })

  it('fails loud when the mounted pipelineEngine is not the file-backed provider', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(ForeignEngine)
    await expect(ctx.plugin(PipelineLocalInvariant)).rejects.toThrow(/not the file-backed provider/)
  })
})
