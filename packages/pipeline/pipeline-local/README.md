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

`registerBuiltin(ref, step)` mounts the named pure transformations `builtin` nodes reference; unknown refs fail loud at execution (`STEP_UNKNOWN`). LLM nodes call the mounted `ctx.llm` runtime with `llmProvider`/`llmModel` config defaults (a node-level `model` overrides the model); an unconfigured route fails loud (`LLM_NODE_UNCONFIGURED`). The Scheduled Search builtins (`scheduled-search/*`) come pre-registered, and `createFromTemplate` expands the `scheduled-search` template — trigger → search → normalize → dedupe → persist, plus an optional llm `summarize` node — into a validated definition.

## Run sessions

Every run projects into its own background session (origin `'pipeline'`, off the visible surface): the definition snapshot, per-node started/settled events with the JSON output and duration, and one run-settled event — all carrying the envelope's `ignorable` mark, so session readers outside the pipeline seam skip them safely. The run record carries the minted session id (run id plus a random suffix, unique across delete + re-create cycles), the settled run's node detail folds back out of the persisted log, and the flush lands before the metrics commit. Retention prunes a retired run's record and its log together through the persistence `forget` seam.

## Scheduling

The engine mounts a cron tick loop (interval via `ctx.effect`, disposed with the fiber). Each pass initializes missing fire times through croner, fires due schedules through `startRun` with the `'scheduled'` lane (overlap skips increment the summary's `skippedCount`), and recomputes the next fire strictly from now — latest-only catch-up, never a missed backlog. Resuming a paused pipeline recomputes from now instead of firing retroactively; saving a definition clears the projection so the next tick recomputes it.

## Config

| key | required | meaning |
|---|---|---|
| `storageDir` | yes | absolute storage root; a mount without one fails at load |
| `retainedRuns` | no | run records kept per pipeline (default 50) |
| `llmProvider` | no | provider route for llm nodes |
| `llmModel` | no | model for llm nodes without a node-level override |
| `scheduler` | no | mounts the tick loop (default true) |
| `tickSeconds` | no | tick interval in seconds (default 60) |

## Model Experience

None, as the engine registers no prompt, tool schema, or provider request; the model-facing consumer and the llm nodes' own requests own every model-visible effect.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Agent nodes fail loud** — executing an agent node throws `AGENT_NODE_RUNTIME_UNAVAILABLE`; the background-agent runtime over the agent factory and subagent delegation is deferred, and with it the skills option gains its execution story.
- **Reasoning-channel models summarize empty** — llm nodes aggregate `text-delta` output only; a reasoning model that returns its text on the reasoning channel (`content: null`) produces an empty string. Deployments pick a text-first model; a later slice aggregates reasoning content.
- **Single storage root** — the provider owns one `storageDir` (the web bundle mounts the dsh-home `pipelines` directory); per-workspace scoping lands with the workspace-aware wiring.