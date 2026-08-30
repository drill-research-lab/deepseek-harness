/**
 * Pure payload vocabulary of the pipeline Remote face: the wire shapes the
 * `pipelines` namespace serves, free of host-side imports. Definition and
 * summary types are declared by `@deepseek-ai/dsh-pipeline/types`; this module
 * owns the run-record and trigger-outcome shapes local to this provider.
 * @module @deepseek-ai/dsh-pipeline-local/types
 */

import type { PipelineRunResultInfo, PipelineRunStatus } from '@deepseek-ai/dsh-pipeline/types'

/** The template inputs a Scheduled Search pipeline is created from. */
export interface ScheduledSearchInputs {
  /** The free-text search query sent to arXiv on every run. */
  query: string
  /** Cron expression for the trigger (default weekly Monday 09:00 UTC). */
  cron?: string
  /** IANA time zone for the trigger (default `UTC`). */
  timeZone?: string
  /** Fetch cap per run (default 20). */
  maxResults?: number
  /** Absolute artifact directory; defaults to the engine's per-pipeline artifacts. */
  destination?: string
  /** Whether every run appends an LLM summary of the new records (D14 toggle, default false). */
  summary?: boolean
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

/** One "run now" request's outcome: the awaited run facts, or the overlap skip. */
export type TriggerNowResult =
  | {
    /** The run started and settled. */
    outcome: 'started'
    /** The run's id (`<pipelineId>-run-<ordinal>`). */
    runId: string
    /** How the run settled. */
    result: PipelineRunResultInfo
  }
  | {
    /** No run started. */
    outcome: 'skipped'
    /** Why not. */
    reason: 'already-running'
  }
