# Agent Note: Pipelines — cron-scheduled workflows over background sessions

Status: implemented

## Problem

The harness automates one conversation at a time: a session runs when a user (or an API caller) drives it. Recurring research work — watch arXiv for papers matching a query, dedupe against what was already collected, persist provenance-stamped results — needs the opposite contract: definitions that fire on a schedule without anyone driving, settle on their own, and keep a durable history. n8n and hermes solve this with a workflow engine, but bolting their shape onto a conversation harness risks two dead ends: a node-type library that must grow a node for every integration, and workflow runs compiled into the conversation session log where they would pollute the transcript the model replays.

## Decision

Pipelines are a new capability seam (`ctx.pipelineEngine` in `@deepseek-ai/dsh-pipeline`) with a local provider (`@deepseek-ai/dsh-pipeline-local`) and a symmetric observation face. Definitions are WorkflowJSON v1 documents stored per file under a storage root; a run is NOT a conversation session — it evaluates the DAG in the host process (D3 defers per-run background sessions to a later slice) and persists one JSON run record plus artifacts. The model-visible ⟺ logged rule is preserved by construction: nothing from a run reaches any model request.

Node types are closed at four — `trigger`, `builtin`, `llm`, `agent` — and the long tail is deliberately absorbed by agent nodes rather than an n8n-style node library (D11). The shipped Scheduled Search template demonstrates the full loop with four builtin steps (arXiv search → normalize → dedupe → persist, keyed by arXiv-id → DOI → canonical-URL priority against a per-pipeline seen state) and an optional LLM summary node; cron semantics are validated by the same croner engine the scheduler ticks with, at load, in the dsh-pipeline validator. Croner's `nextRun` powers the latest-only catch-up: a paused or down host does not fire missed runs retroactively, and overlap resolves to skip-plus-count (D12), recorded as `skippedCount` on the pipeline index. Retention keeps the last N run records per pipeline (D13).

The Remote face (`PipelineRpcService`, namespace `pipelines`) exposes list/get/save/delete/setEnabled/triggerNow/createFromTemplate/runs/run over Typert. `createFromTemplate` keeps template knowledge server-side: the client form posts name plus `ScheduledSearchInputs`, and the host expands, validates, and persists — the browser never assembles WorkflowJSON. `save` doubles as the JSON import path and `get` as export. The Typert contract forced the payload vocabulary into a public `./types` subpath of both pipeline packages whose declarations are free of host-side imports; the generated remote-client for the browser imports those, not the node file registry.

The web surface (`@deepseek-ai/dsh-client-ui-pipeline`) registers a sidebar navigation block (a new `sidebar.pipelines` seat declared by ui-sidebar's shell contract) and one full-window editor overlay in `shell.overlay`. Both share a root-scoped store carrying the open pipeline id and view mode. The DAG canvas is read-only by design — definitions carry no positions, elkjs computes the layered layout per render, and React Flow runs with every interaction except node selection disabled (D8). The inspector edits a draft of the whole definition (per-type config, downstream-edge retargeting) and commits through full-replace `save`; no partial patches.

## Alternatives considered

- **Compile runs into the workflowEngine/session log** — a run is not a conversation turn; folding it into `SessionEventMap` would force every session log consumer to know pipeline internals and would violate the log-version discipline for what is host-side bookkeeping.
- **Node-type library (n8n-style)** — every integration becomes a node with schema, UI, and tests; agent nodes already cover arbitrary long-tail transforms. v1 ships exactly the four discriminants and `assertNever`s the union.
- **Client-side template expansion** — would either duplicate template knowledge into the browser bundle or leak the node file registry into it; the host-owned RPC keeps one home for template structure.
- **Per-run sessions now** — the tracer bullet proves scheduling, evaluation, dedupe, and persistence with file records; per-run background sessions (with their SDK projection ripple) are deferred until the run-history UI needs model-visible context.

## Consequences

- The shipped web composition mounts pipeline-local with `llmProvider`/`llmModel` unset, so llm nodes fail loud with `LLM_NODE_UNCONFIGURED` until model-selection wiring lands; the Scheduled Search summary toggle therefore needs engine config in the composition (the lab-model e2e wires the lab vLLM endpoint explicitly).
- Run sessions are real session-store objects (`origin: 'pipeline'`, session id = run id) in a per-run scope, appended with an ignorable `pipeline/*` event vocabulary — the first users of `Session.append`'s LogIntent. They stay off the visible conversation surface (the session mux and visible list exclude the origin), persistence is wide on the wire so the SDK needs no type ripple, and D13 retention retires pruned logs through the new `SessionPersistence.forget`. A missing session store fails the run loudly; a failed log flush only warns because the file-backed run record stays the authoritative summary.
- The arXiv adapter budgets one request per run inside the politeness window and stamps the last-successful window only after artifacts land, so a crash between the two re-processes instead of dropping records.
- The closed node union plus full-replace saves keep the wire vocabulary small: every new node type widens the discriminator union, and every inspector affordance must express itself as a whole-definition diff, which bounds UI complexity at the cost of multi-user-style concurrent editing.
- Definitions stay file documents under one storage root; per-workspace isolation (D15) still needs its wiring decision when multi-workspace lands.
