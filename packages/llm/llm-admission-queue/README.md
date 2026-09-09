# `@deepseek-ai/dsh-llm-admission-queue`

English | [简体中文](README.zh.md) | [繁體中文](README.zh-tw.md)

Function plugin that puts a FIFO admission gate with a concurrency ceiling in front of the internal vLLM backend, wrapped around the `llm/stream` waterfall. It assumes one queue per process — one vLLM backend per DSH web process — so all state is in memory and nothing is shared across processes.

## What it gates

Only providers on the `gatedProviders` allowlist are queued. `GenerateOptions.provider` is the routing key: it selects the adapter and endpoint, so it cannot be spoofed — changing it changes where the request actually goes. Every other provider — every external pay-per-use API, and any provider added to the deployment later — passes straight through `next()` with no enqueue, no wait, no slot, and no position. A blocklist would need editing on every new external provider; the allowlist is safe by default.

All gated calls are queued regardless of purpose (agent step, compaction summary, session-title). Skipping the auxiliary calls would let real vLLM traffic exceed the ceiling and make reported positions wrong.

```yaml
- id: llm-admission-queue
  name: '@deepseek-ai/dsh-llm-admission-queue'
  config:
    limit: 1
    gatedProviders: ['vllm-local']
```

`limit` is the maximum number of concurrently admitted requests. It defaults to `1` — one vLLM backend serving one request at a time, so the wait shows as a position instead of an opaque hang inside vLLM; raise it for a backend that genuinely serves more in parallel. `0` disables the ceiling: gated calls are counted but never blocked. `gatedProviders` defaults to `[]` (gate nothing). Both are hot-reloaded from a `llm-admission-queue:` section in `$DSH_HOME/settings.yaml`: raising `limit` admits waiters immediately, lowering it never interrupts a running request, and admission resumes once `running` falls back below the new ceiling.

## Ordering and audit

`ctx.llmAdmissionQueue` exposes `positionFor`, `reorder`, `listAll`, `onChange`, and `audit` for the RPC and transport layer; `enqueue`/`release` stay private to the `llm/stream` listener. `reorder(orderedQueueIds)` sets the explicit front-to-back order of the still-waiting entries — ids that are unknown or no longer waiting are dropped, and waiting entries the list omits keep FIFO order behind the named ones. A later enqueue joins behind the manually ordered entries. It never preempts a running request or adds a slot. `audit(record)` appends one JSON line to `$DSH_HOME/audit/queue-admin.jsonl` through the atomic-write file lock; the caller supplies `operator`, and this package owns only the durable write.

`onChange` publishes one `PositionChange` per entry whose 1-based waiting position moved, plus one `running` notice per entry the moment it is admitted.

## Model Experience

None, as the gate only defers when a gated request reaches the provider and never alters the request, messages, tools, response, or session log.

#### KV Cache effect

None. The request that eventually reaches the adapter is byte-for-byte the one the loop built, so provider prefix-cache identity is unaffected. The queue only defers the send.

## Known Limitations and Deferred Work

- **One process only** — the queue is in-memory and per-process. A deployment that ever runs more than one DSH web process against one vLLM backend needs a shared-state redesign; this package deliberately does not provide one.
- **Reordering has no abuse control** — nothing rate-limits an admin's `reorder` calls or reviews them; a careless admin can keep one user's request permanently behind. The audit log is the only after-the-fact control.
- **Reordering cannot preempt** — a waiter moved to the front still waits for the longest-running in-flight request to finish before it gets that freed slot.
- **A manual order is not durable** — it lives only in process memory; a restart drops it and the wait line reverts to FIFO.
- **`audit()` write failures are swallowed** — a failed append is logged and dropped rather than propagated, so the admin action still succeeds even if the audit line is lost.
- **Split provider ids must all be listed** — if a deployment declares more than one provider id pointing at the same vLLM endpoint, every one of them must appear in `gatedProviders` or the unlisted route escapes the ceiling.
