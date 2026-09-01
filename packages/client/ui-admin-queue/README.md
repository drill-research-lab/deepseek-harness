# @deepseek-ai/dsh-client-ui-admin-queue

English | [简体中文](README.zh.md) | [繁體中文](README.zh-tw.md)

The admin queue page is a native DSH Settings section that shows the internal-vLLM admission queue (`@deepseek-ai/dsh-llm-admission-queue`) and lets an admin drag the waiting requests into the order they should run. It stays inside the existing Settings dialog. The Settings entry itself never appears for a non-admin browser: `apply()` calls `auth.me()` once at connection start and registers the `settings.section` occupant only when the response reports `isAdmin: true`. This is UX convenience, not the security boundary — the `queue.list` and `queue.reorder` RPCs independently enforce the admin check on the server before touching the queue, so a non-admin invoking either method directly (bypassing this UI, for example from browser devtools) still receives a `forbidden` error at HTTP 200 (the four-quadrant RPC model puts business errors on the `RpcResult` error branch, never a distinct HTTP status).

The table has three columns — position, user, state. The running request (or requests, if the deployment's `limit` is above 1) is pinned at the top with no position; the waiting requests follow, numbered from 1. `user` is the owner's login name resolved from the session header (`ldap:` login for an LDAP account, the registration name for a local one) — identity only, never conversation content or a session id. Each waiting row is draggable (`@dnd-kit/sortable`, with keyboard support); dropping it sends the full new waiting order to `queue.reorder({ orderedQueueIds })`, and the running rows cannot be dragged or dropped onto. The page polls `queue.list` every `ADMIN_QUEUE_POLL_MS` (2 seconds, matching the inference dashboard's default cadence — `queue.list` carries no server-suggested interval); the poll is suspended for the duration of a drag and resumes on drop so a stale snapshot cannot undo the move.

## Model Experience

None, as the package reads and reorders admission-queue metadata for a human-facing browser section and adds nothing to model requests or Session logs.

#### KV Cache effect

None. The page is observational except for the waiting order it can set; it neither allocates cache nor issues inference requests itself.

## Known Limitations and Deferred Work

- **The admin check is a login-time snapshot, not real-time** — `isAdmin` is decided once per connection (mirroring the identity cookie's own login-time LDAP `memberOf` snapshot). A user promoted to or removed from the admin group keeps their prior standing in this UI, and in the RPC's own scope, until they reconnect. This matches the identity-chain design's existing known limitation; it is not specific to this page.
- **Local (non-LDAP) accounts can never be admin** — the admin queue entry point is unreachable from a `dsh-auth-local` session regardless of that account's own privileges, because `AuthenticatedUser.isAdmin` is only ever set from the LDAP `memberOf` chain.
- **No abuse prevention beyond the audit trail** — every successful `queue.reorder` writes an audit record (operator identity and the full order set), but nothing rate-limits or reviews repeated reorders by one admin. Reviewing that trail is a manual, out-of-band operation.
- **Single admin-facing process is assumed** — the admission queue, like the harness generally, assumes one DSH Web process per vLLM backend; this page has no cross-process aggregation and shows only the queue of the process it is connected to.
- **v1 polling, not live push** — unlike the general user's `session/llm-queue` mux frame, this page has no push channel of its own; a reorder by one admin is invisible to another admin's open page until its next poll tick (at most `ADMIN_QUEUE_POLL_MS`). Wiring `queue.onChange` into a dedicated admin-scoped mux broadcast is deferred.
- **Running requests cannot be reordered** — `queue.reorder` only affects still-waiting entries (matching `AdmissionQueue.reorder`'s own contract); there is no control here for the concurrency limit or already-admitted requests.
- **The manual order is process-local** — it lives only in the admission queue's memory; a Web-process restart drops it and the wait line reverts to FIFO.
