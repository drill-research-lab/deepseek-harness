# @deepseek-ai/dsh-pipeline-local

English | [简体中文](README.zh.md) | [繁體中文](README.zh-tw.md)

File-backed provider for the pipeline capability seam (`ctx.pipelineEngine`): persists `WorkflowJSON` definitions under a configured storage root, projects registry summaries with run metrics, and evaluates definitions — `builtin` and `llm` nodes — applying the overlap policy. The Service Definition it implements is [`dsh-pipeline`](../../pipeline/pipeline).

## Storage layout

```
<storageDir>/
  registry.json               # index: per-pipeline metrics projection (name, enabled, last/next run, failure streak, run count)
  definitions/<id>.json       # one validated WorkflowJSON per pipeline (atomic write)
  runs/<id>/<ordinal>.json    # one settled run's record; retained per `retainedRuns`, pruned oldest-first
  state/<id>/                 # per-pipeline directory builtin steps may use for cross-run state (dedupe indexes)
```

Every write is atomic (temp file + rename); every load validates through `validateWorkflowJson`, so a hand-edited or truncated store fails loud at startup. A definition file without an index entry is adopted (definitions are the durable source of truth; the index is derived); an index entry without a definition file is corruption and refuses to load.

## Evaluation

`startRun` applies the overlap policy — one executing run per pipeline; a further trigger returns `{ outcome: 'skipped', reason: 'already-running' }` as data instead of queueing. Runs evaluate topologically from the trigger: each node's input is its single upstream's output (several upstreams merge into a record keyed by node id; none gives `null`), each node emits its start/end pair, and a failed node fails the run and stops downstream execution. Disabled nodes and everything only reachable through them are skipped. Metrics update at commit: `lastRunAt`, `lastStatus`, `lastError`, and the `failureStreak` that successful runs reset.

`registerBuiltin(ref, step)` mounts the named pure transformations `builtin` nodes reference; unknown refs fail loud at execution (`STEP_UNKNOWN`). LLM nodes call the mounted `ctx.llm` runtime with `llmProvider`/`llmModel` config defaults (a node-level `model` overrides the model); an unconfigured route fails loud (`LLM_NODE_UNCONFIGURED`).

## Config

| key | required | meaning |
|---|---|---|
| `storageDir` | yes | absolute storage root; a mount without one fails at load |
| `retainedRuns` | no | run records kept per pipeline (default 50) |
| `llmProvider` | no | provider route for llm nodes |
| `llmModel` | no | model for llm nodes without a node-level override |

## Model Experience

None, as the engine registers no prompt, tool schema, or provider request; the model-facing consumer and the llm nodes' own requests own every model-visible effect.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Agent nodes fail loud** — executing an agent node throws `AGENT_NODE_RUNTIME_UNAVAILABLE`; the background-agent runtime (run sessions over the agent factory, subagent delegation) is the next slice, and with it the skills option gains its execution story.
- **Run sessions not yet projected** — run records are file metrics under `runs/`; projecting node lifecycles into per-run session logs (with the SDK expected-output ripple) is a later slice.
- **Single storage root** — the provider owns one `storageDir`; per-workspace scoping lands with the BFF/UI wiring that selects the root.
