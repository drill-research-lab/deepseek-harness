# Agent Note: pi-ai adapter forwards the Harness session id header

Status: implemented

## Problem

`dsh-llm-deepseek` has sent `x-deepseek-harness-session-id` from `GenerateOptions.sessionId` since the [DeepSeek request identity header](../feature/2026-08-11-deepseek-request-user-id-header.md) decision. The pi-ai multi-provider adapter accepted the same option and forwarded it to pi-ai as an SDK field, but never emitted it as an HTTP header. OpenCode Go routes and caches provider traffic by that header: a request without it fails `400 {"type":"MissingSessionID"}` — "Request is missing x-opencode-session and cannot be routed efficiently". Every `opencode-go` model therefore failed through the pi-ai adapter even with a valid credential and endpoint. OpenCode's own Go documentation lists DeepSeek Harness under "Known Problematic Clients" for exactly this gap: "session information arrives on some model paths, but is missing on others."

A deployment could work around this by pinning a constant `x-opencode-session` in `PiAiProviderProfile.headers`, but that discards the per-conversation id the routing and prompt caching are meant to key on.

## Decision

`PiAiAdapter` merges `x-deepseek-harness-session-id` into every provider request, read from `GenerateOptions.sessionId` alongside the profile headers and `attributionHeaders()`. The value is the durable `Session.id` the agent loop already supplies for ordinary agent, title-generation, and compaction requests, so it matches what the DeepSeek adapter sends. The header is absent when a request carries no session, and the option still reaches pi-ai unchanged; the header is additive transport metadata.

The session header joins attribution as Harness-owned: both win case-insensitive collisions against `PiAiProviderProfile.headers`, so a deployment cannot pin the current conversation's id through profile configuration.

## Verification

- The adapter test asserts an authorized request carries the supplied session id as `x-deepseek-harness-session-id`, that a profile header of the same name loses, and that the header is absent when no session id is supplied.
- No keyless snapshot changes because the header is HTTP metadata, absent from the request body, and not model-visible transcript content.

## Alternatives considered

| Rejected | Reason |
|---|---|
| Pin `x-opencode-session` in `PiAiProviderProfile.headers` | A constant cannot carry the current conversation id, so routing and prompt caching would bucket every session together; it also puts a routing fact in deployment config instead of its owning runtime contract |
| Send only `x-opencode-session` instead of the Harness name | The Go endpoint recognizes the Harness's native `x-deepseek-harness-session-id` (confirmed against the live endpoint), and one header name keeps the DeepSeek and pi-ai adapters aligned |
| Add the session id to generic `attributionHeaders()` | That helper is static app identity; a per-request value there would violate its privacy contract and reach every HTTP adapter |
| Pass the id only through pi-ai's `sessionId` option | pi-ai does not translate that option into a provider header, which is the observed failure |

## Consequences

- Every opencode-go model reaches the endpoint with the conversation's session id and is routed as intended; the other pi-ai routes gain the same metadata at no cost.
- A configured gateway receives the conversation's session id, so operators must treat the resolved `baseURL` as an identity recipient — the same boundary the DeepSeek adapter already sets.
- The request body, prompt, token accounting, KV-cache identity, and session log are unchanged.
