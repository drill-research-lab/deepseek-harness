# @deepseek-ai/dsh-pipeline

English | [简体中文](README.zh.md) | [繁體中文](README.zh-tw.md)

Pipeline capability seam: the durable `WorkflowJSON` definition format for Drill Pipelines, its pure load-time validation, branded ids, and the `ctx.pipelineEngine` Service Definition with observe-only `pipeline/*` lifecycle events. A pipeline engine provider (file-backed registry, cron scheduler, DAG evaluator over run sessions) executes validated definitions; consumers surface them.

## The definition format

A definition is one plain JSON document — the single source of truth for the engine, the validator, UI rendering, and export/import:

```json
{
  "version": 1,
  "id": "sch-search-arxiv",
  "name": "arXiv weekly scan",
  "template": { "ref": "scheduled-search", "inputs": { "query": "LLM agents" } },
  "trigger": { "kind": "cron", "expression": "0 9 * * 1", "timeZone": "Asia/Taipei", "enabled": true },
  "nodes": [
    { "id": "trigger", "type": "trigger" },
    { "id": "collect", "type": "builtin", "ref": "scheduled-search/search", "config": { "source": "arxiv" } },
    { "id": "summarize", "type": "llm", "prompt": "Summarize the new records." }
  ],
  "edges": [ { "from": "trigger", "to": "collect" }, { "from": "collect", "to": "summarize" } ]
}
```

Node types are a merge-extensible union on the `type` discriminant — future kinds add members, and internal switches fall through a documented default:

| type | fields | meaning |
|---|---|---|
| `trigger` | — | the single entry node; exactly one per definition; no edge may target it |
| `builtin` | `ref`, `config?` | an engine-provider-registered named step (a pure transformation); unknown refs fail loud at load |
| `llm` | `prompt`, `model?` | one single LLM ask; the response is the node output |
| `agent` | `prompt`, `skills?`, `tools?` | one multistep subagent execution |

Every node carries a unique stable `id` (edges reference it, so display renames never break the graph) plus optional `disabled` and `notes`. A definition created from a built-in template records the `template` block it was expanded from.

## Validation

`validateWorkflowJson(value)` is the load-time parser boundary: pure, no I/O, throwing `PipelineSchemaError` with a closed `PipelineSchemaErrorCode` and a message naming the first defect's field path (`nodes[2].prompt`). It checks shape and allowed keys at every level (unknown fields reject — typo protection for LLM-authored definitions), unique node ids, exactly one trigger node, edge endpoint/duplicate/target rules, acyclicity (self-edges included), the five-field cron structure, the IANA time-zone name through `Intl`, and cron semantics through the scheduler's own pattern engine (croner): an expression croner cannot compute fails at load, before any registration. Deliberately not here: `builtin.ref` resolution belongs to the provider registry.

## The seam

`PipelineEngine` (default export, `ctx.pipelineEngine`) is the abstract contract the engine provider implements:

| operation | contract |
|---|---|
| `list()` | registry projections (`PipelineSummary`: status, next/last run, failure streak, run count) |
| `get(id)` | the validated definition, or `undefined` when unknown |
| `save({ definition })` | validates raw JSON at the durable parser boundary, persists, emits `pipeline/definition-changed` after commit |
| `delete(id)` | removes the definition; run sessions and artifacts are kept (deletion never destroys recorded data) |
| `setEnabled(id, enabled)` | pauses or resumes the cron trigger |
| `startRun({ id, trigger })` | applies the overlap policy — one executing run per pipeline; a further trigger returns `{ outcome: 'skipped', reason: 'already-running' }` instead of queueing; unknown ids throw `PipelineError` with code `'PIPELINE_UNKNOWN'` |

Lifecycle events (`pipeline/definition-changed`, `pipeline/run-start`, `pipeline/node-start`, `pipeline/node-end`, `pipeline/run-end`) are observe-only data snapshots with per-listener containment; they carry no node input or output values — run data lives in each run's own session log.

## Model Experience

None, as the schema vocabulary and its validation register no prompt, tool schema, or provider request; the engine provider and its consumers own every model-visible effect.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Linear graphs only** — the schema has no branching or fan-out fields; they land with the execution slice that evaluates them, as additive optional fields.
