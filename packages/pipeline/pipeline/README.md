# @deepseek-ai/dsh-pipeline

English | [简体中文](README.zh.md) | [繁體中文](README.zh-tw.md)

Pipeline capability seam vocabulary: the durable `WorkflowJSON` definition format for Drill Pipelines, its pure load-time validation, and the branded ids that identify pipelines, runs, and nodes. A pipeline engine provider executes validated definitions; consumers surface them. The `ctx.pipelineEngine` Service Definition and the `pipeline/*` lifecycle events land with the engine provider.

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

`validateWorkflowJson(value)` is the load-time parser boundary: pure, no I/O, throwing `PipelineSchemaError` with a closed `PipelineSchemaErrorCode` and a message naming the first defect's field path (`nodes[2].prompt`). It checks shape and allowed keys at every level (unknown fields reject — typo protection for LLM-authored definitions), unique node ids, exactly one trigger node, edge endpoint/duplicate/target rules, acyclicity (self-edges included), the five-field cron structure, and the IANA time-zone name through `Intl`. Deliberately not here: cron range and step semantics belong to the scheduler provider that parses the expression, and `builtin.ref` resolution belongs to the provider registry.

## Model Experience

None, as the schema vocabulary and its validation register no prompt, tool schema, or provider request; the engine provider and its consumers own every model-visible effect.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No Service Definition yet** — `ctx.pipelineEngine` and the `pipeline/*` lifecycle events land with the engine provider; this package currently ships vocabulary and validation only.
- **Linear graphs only** — the schema has no branching or fan-out fields; they land with the execution slice that evaluates them, as additive optional fields.
- **Cron semantics deferred** — validation checks structure only (five fields, character set); range and step validation happens when the scheduler provider parses the expression, failing loud at registration.
