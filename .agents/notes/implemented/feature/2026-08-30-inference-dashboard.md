# Agent Note: Embedded inference runtime dashboard

Status: implemented

## Problem

Operators need the current inference service load while they work in DSH. SparkDash presents useful vLLM signals, but sending users to another page fragments the product, and embedding its server or browser application would add a second authentication and deployment surface. Prometheus request gauges also describe the whole inference deployment rather than one authenticated DSH request, so they cannot truthfully answer a user's exact queue position.

## Decision

The Web bundle includes a native `ui-inference-dashboard` Settings section. Its browser half renders a compact LLM panel adapted from SparkDash and calls the authenticated `llm.metrics` API. The Host reads one deployment-owned HTTP(S) Prometheus URL from `DSH_INFERENCE_METRICS_URL`, applies a deadline and response-size limit, and returns only the panel's fixed fields. The configured URL, raw Prometheus labels, provider diagnostics, and non-vLLM process/runtime series never enter a browser response.

Required running and waiting request gauges are summed across labeled series and must be non-negative integers. Optional KV-cache occupancy, counters, ratios, engine state, and histogram quantiles are omitted when invalid. The parser examines at most 10,000 vLLM samples inside the response byte limit; malformed vLLM rows reject the sample. A best-effort same-origin `/v1/models` lookup supplies model and context metadata without making metrics availability depend on that companion endpoint. Successful samples carry the deployment-configured refresh cadence; browser-local counter deltas provide generation and prefill rates plus 30-sample sparklines. A failed sample stops polling and remains visible until an explicit retry.

The dashboard labels running and waiting values as deployment aggregates. Exact per-task position remains absent until a DSH-owned LLM proxy can assign request identities and record queued, running, completed, and cancelled transitions under the authenticated Session.

## Verification

Parser and carrier tests cover aggregation, selected-field projection, histogram interpolation, model metadata enrichment, malformed input, response bounds, network failures, protocol validation, unconfigured deployments, and successful wire projection. Browser package tests cover panel rendering, live-rate derivation, polling ownership, failure display, retry, and late-response suppression. The assembled-Web snapshot starts the real Web application, opens Settings, observes a real HTTP scrape failure, retries against the recovered metrics service, and records the ready dashboard.

## Alternatives considered

**Embed SparkDash in an iframe.** This requires deploying and authenticating another Web application, inherits its navigation and styling, and makes DSH responsible for a cross-application trust relationship. The native section uses the existing Settings, authentication, localization, and design systems.

**Fetch Prometheus from the browser.** This exposes an infrastructure address, requires browser network and CORS access to the inference host, and bypasses the existing authenticated API carrier. Host-side retrieval keeps deployment details and limits in the deployment plane.

**Infer queue position from aggregate gauges.** A waiting count contains neither ordering nor request identity. Reporting a rank from it would fabricate a user-specific guarantee, especially under a scheduler that is not strict FIFO.

## Consequences

Users gain SparkDash's curated vLLM LLM panel inside DSH without another page or service. Deployments must explicitly expose the vLLM metrics endpoint to the DSH Host and configure its URL. The dashboard adds bounded periodic Host traffic while its Settings section is mounted, and its short trends restart with the browser controller. SparkDash's persistent history, benchmark, and showcase features remain outside this observational surface. The panel deliberately provides no per-user queue rank; adding that capability requires request-lifecycle ownership in the DSH LLM proxy rather than another Prometheus parser.
