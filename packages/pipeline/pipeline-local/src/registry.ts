/**
 * File-backed pipeline registry: one JSON definition per pipeline, one index
 * with run metrics, and per-pipeline run records with retention. Every write
 * is atomic (temp file + rename); every load validates through
 * `validateWorkflowJson`, so a hand-edited or truncated store fails loud at
 * startup instead of leaking a bad definition into a run.
 * @module @deepseek-ai/dsh-pipeline-local/registry
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { rename as renameAsync, writeFile as writeFileAsync } from 'node:fs/promises'
import { join } from 'node:path'
import { validateWorkflowJson } from '@deepseek-ai/dsh-pipeline'
import { PipelineId } from '@deepseek-ai/dsh-pipeline'
import type { PipelineRunStatus, PipelineSummary, WorkflowJson } from '@deepseek-ai/dsh-pipeline'

/** On-disk index record for one pipeline: the metrics projection plus ordinal bookkeeping. */
interface IndexEntry {
  /** Display name, duplicated from the definition for cheap listing. */
  name: string
  /** Paused pipelines keep their definition and schedule but fire nothing. */
  enabled: boolean
  /** Next scheduled fire (RFC 3339 UTC); undefined until the scheduler computes it. */
  nextRunAt: string | undefined
  lastRunAt: string | undefined
  lastStatus: PipelineRunStatus | undefined
  lastError: string | undefined
  failureStreak: number
  runCount: number
  /** Triggers skipped under the overlap policy. */
  skippedCount: number
  /** Next run ordinal; monotonic even across retention pruning. */
  nextOrdinal: number
}

/** One settled run's durable record (`runs/<pipelineId>/<ordinal>.json`). */
export interface PipelineRunRecord {
  /** The run's id (`<pipelineId>-run-<ordinal>`). */
  runId: string
  /** Epoch milliseconds when the run started. */
  startedAt: number
  /** Epoch milliseconds when the run settled. */
  finishedAt: number
  /** How the run settled. */
  status: PipelineRunStatus
  /** The failure message (present iff `status` is `'failed'`). */
  error?: string
  /** How many nodes produced an outcome (skipped nodes excluded). */
  nodeCount: number
}

/** Extract the numeric ordinal from a `<pipelineId>-run-<ordinal>` run id. */
function runOrdinal(runId: string): number {
  return Number(runId.slice(runId.lastIndexOf('-') + 1))
}

/** Directory names inside the storage root; one level, fixed. */
const LAYOUT = {
  definitions: 'definitions',
  runs: 'runs',
  state: 'state',
} as const

/**
 * Read, validate, and parse one JSON file, or return `undefined` when absent.
 * @throws Error naming the file when it exists but is unreadable or unparseable.
 */
function readJsonFile(path: string): unknown {
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (cause) {
    throw new Error(`pipeline registry: ${path} is not readable JSON`, { cause })
  }
}

/**
 * The file-backed registry. All mutating operations are synchronous and
 * atomic; callers own when they happen (inside the engine's run lifecycle).
 */
export class PipelineFileRegistry {
  private readonly definitionsDir: string
  private readonly runsDir: string
  private readonly stateDir: string
  private readonly index = new Map<string, IndexEntry>()
  private readonly definitions = new Map<string, WorkflowJson>()

  /** Retained run records per pipeline; older records are pruned after each run. */
  readonly retainedRuns: number

  constructor(
    /** Storage root directory (created on construction). */
    readonly rootDir: string,
    /** Retained run records per pipeline; omission defaults to 50. */
    retainedRuns?: number,
  ) {
    this.retainedRuns = retainedRuns ?? 50
    this.definitionsDir = join(rootDir, LAYOUT.definitions)
    this.runsDir = join(rootDir, LAYOUT.runs)
    this.stateDir = join(rootDir, LAYOUT.state)
    for (const dir of [rootDir, this.definitionsDir, this.runsDir, this.stateDir]) {
      mkdirSync(dir, { recursive: true })
    }
    this.load()
  }

  /** Read the index and every definition from disk, failing loud on corruption. */
  private load(): void {
    const rawIndex = readJsonFile(join(this.rootDir, 'registry.json'))
    if (rawIndex !== undefined) {
      for (const [id, entry] of Object.entries(rawIndex as Record<string, IndexEntry>)) {
        this.index.set(id, entry)
      }
    }
    for (const file of readdirSync(this.definitionsDir)) {
      if (!file.endsWith('.json')) continue
      const definition = validateWorkflowJson(readJsonFile(join(this.definitionsDir, file)))
      const id = String(definition.id)
      this.definitions.set(id, definition)
      if (!this.index.has(id)) {
        // A definition without an index entry (hand-placed or interrupted
        // index write) is adopted rather than rejected: definitions are the
        // durable source of truth, the index is the derived projection.
        this.index.set(id, PipelineFileRegistry.freshEntry(definition.name))
      }
    }
    for (const id of this.index.keys()) {
      if (!this.definitions.has(id)) {
        throw new Error(`pipeline registry: index entry ${JSON.stringify(id)} has no definition file`)
      }
    }
  }

  private static freshEntry(name: string): IndexEntry {
    return {
      name,
      enabled: true,
      nextRunAt: undefined,
      lastRunAt: undefined,
      lastStatus: undefined,
      lastError: undefined,
      failureStreak: 0,
      runCount: 0,
      skippedCount: 0,
      nextOrdinal: 1,
    }
  }

  /** Atomically write one file (temp sibling + rename). */
  private static async writeFileAtomic(path: string, value: unknown): Promise<void> {
    const temp = `${path}.tmp`
    await writeFileAsync(temp, `${JSON.stringify(value, null, 2)}\n`)
    await renameAsync(temp, path)
  }

  /** Persist the index after any mutation of {@link index}. */
  private async flushIndex(): Promise<void> {
    const raw: Record<string, IndexEntry> = {}
    for (const [id, entry] of this.index) raw[id] = entry
    await PipelineFileRegistry.writeFileAtomic(join(this.rootDir, 'registry.json'), raw)
  }

  /** List every persisted pipeline's projection, in definition-id order. */
  list(): PipelineSummary[] {
    return [...this.index.keys()].sort().map(id => this.summary(PipelineId(id)))
  }

  /** Build one pipeline's projection from its index entry. */
  private summary(id: PipelineId): PipelineSummary {
    // Callers pass ids from the index itself, so the entry always resolves.
    const entry = this.index.get(String(id)) as IndexEntry
    return {
      id,
      name: entry.name,
      enabled: entry.enabled,
      status: 'idle',
      ...entry.nextRunAt !== undefined ? { nextRunAt: entry.nextRunAt } : {},
      ...entry.lastRunAt !== undefined ? { lastRunAt: entry.lastRunAt } : {},
      ...entry.lastStatus !== undefined ? { lastStatus: entry.lastStatus } : {},
      ...entry.lastError !== undefined ? { lastError: entry.lastError } : {},
      failureStreak: entry.failureStreak,
      runCount: entry.runCount,
      skippedCount: entry.skippedCount,
    }
  }

  /** Read one persisted definition, or undefined when unknown. */
  get(id: PipelineId): WorkflowJson | undefined {
    return this.definitions.get(String(id))
  }

  /**
   * List one pipeline's settled run records, oldest first. An unknown pipeline
   * or one without runs yields an empty list.
   */
  listRuns(id: PipelineId): readonly PipelineRunRecord[] {
    const dir = join(this.runsDir, String(id))
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter(file => file.endsWith('.json'))
      .map(file => JSON.parse(readFileSync(join(dir, file), 'utf8')) as PipelineRunRecord)
      .sort((a, b) => runOrdinal(a.runId) - runOrdinal(b.runId))
  }

  /** Read one settled run record, or `undefined` when the pipeline or ordinal is unknown. */
  readRun(id: PipelineId, ordinal: number): PipelineRunRecord | undefined {
    const raw = readJsonFile(join(this.runsDir, String(id), `${ordinal}.json`))
    return raw === undefined ? undefined : (raw as PipelineRunRecord)
  }

  /** List every persisted definition's id (the durable source-of-truth set). */
  definitionIds(): string[] {
    return [...this.definitions.keys()].sort()
  }

  /** Persist one validated definition (create or replace) and refresh its index name. */
  async save(definition: WorkflowJson): Promise<void> {
    const id = String(definition.id)
    await PipelineFileRegistry.writeFileAtomic(join(this.definitionsDir, `${id}.json`), definition)
    this.definitions.set(id, definition)
    const existing = this.index.get(id)
    this.index.set(id, { ...PipelineFileRegistry.freshEntry(definition.name), ...(existing ?? {}), name: definition.name })
    await this.flushIndex()
  }

  /**
   * Delete one definition and its index entry. Run records and step state are
   * kept: deletion never destroys recorded data.
   * @returns true when the definition existed.
   */
  async delete(id: PipelineId): Promise<boolean> {
    const key = String(id)
    if (!this.definitions.has(key)) return false
    rmSync(join(this.definitionsDir, `${key}.json`))
    this.definitions.delete(key)
    this.index.delete(key)
    await this.flushIndex()
    return true
  }

  /** Pause or resume one pipeline's trigger; unknown ids return false. */
  async setEnabled(id: PipelineId, enabled: boolean): Promise<boolean> {
    const entry = this.index.get(String(id))
    if (entry === undefined) return false
    if (entry.enabled !== enabled) {
      entry.enabled = enabled
      await this.flushIndex()
    }
    return true
  }

  /** The current trigger-enabled flag, or undefined when the id is unknown. */
  enabledOf(id: PipelineId): boolean | undefined {
    return this.index.get(String(id))?.enabled
  }

  /** The next run ordinal for one pipeline (monotonic across retention). */
  nextOrdinal(id: PipelineId): number {
    // Only the engine calls this, and only after resolving the definition.
    return (this.index.get(String(id)) as IndexEntry).nextOrdinal
  }

  /** The persisted next-scheduled-fire projection, or undefined when unset. */
  nextRunAtOf(id: PipelineId): string | undefined {
    return this.index.get(String(id))?.nextRunAt
  }

  /** Store or clear the next-scheduled-fire projection. */
  async setNextRunAt(id: PipelineId, nextRunAt: string | undefined): Promise<void> {
    // Only the engine calls this, and only for a persisted pipeline.
    const entry = this.index.get(String(id)) as IndexEntry
    entry.nextRunAt = nextRunAt
    await this.flushIndex()
  }

  /** Count one trigger skipped under the overlap policy. */
  async incrementSkipped(id: PipelineId): Promise<void> {
    // Only the engine calls this, and only for a persisted pipeline.
    const entry = this.index.get(String(id)) as IndexEntry
    entry.skippedCount += 1
    await this.flushIndex()
  }

  /**
   * Record one settled run: update the metrics projection, write the run
   * record, and prune records past the retention bound.
   * @param id - the pipeline's id.
   * @param ordinal - the run's ordinal (from {@link nextOrdinal}, which this advances).
   * @param record - the settled run's durable record.
   */
  async recordRun(id: PipelineId, ordinal: number, record: Omit<PipelineRunRecord, 'runId'>): Promise<void> {
    const key = String(id)
    // Only the engine calls this, and only for a pipeline it just ran.
    const entry = this.index.get(key) as IndexEntry
    const runRecord: PipelineRunRecord = { ...record, runId: `${key}-run-${ordinal}` }
    const runDir = join(this.runsDir, key)
    mkdirSync(runDir, { recursive: true })
    await PipelineFileRegistry.writeFileAtomic(join(runDir, `${ordinal}.json`), runRecord)
    entry.nextOrdinal = ordinal + 1
    entry.runCount += 1
    entry.lastRunAt = new Date(record.startedAt).toISOString()
    entry.lastStatus = record.status
    entry.lastError = record.error
    entry.failureStreak = record.status === 'failed' ? entry.failureStreak + 1 : 0
    await this.flushIndex()
    const records = readdirSync(runDir).filter(file => file.endsWith('.json')).sort((left, right) => Number(left.slice(0, -5)) - Number(right.slice(0, -5)))
    for (const file of records.slice(0, Math.max(0, records.length - this.retainedRuns))) {
      rmSync(join(runDir, file))
    }
  }

  /** The per-pipeline state directory a builtin step may use for cross-run data (created on demand). */
  stateDirFor(id: PipelineId): string {
    const dir = join(this.stateDir, String(id))
    mkdirSync(dir, { recursive: true })
    return dir
  }
}
