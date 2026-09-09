# Agent Note: Embedded inference runtime dashboard

Status: implemented

## Problem

Operators need the current inference service load while they work in DSH. SparkDash presents useful vLLM signals, but sending users to another page fragments the product, and embedding its server or browser application would add a second authentication and deployment surface. Prometheus request gauges also describe the whole inference deployment rather than one authenticated DSH request, so they cannot truthfully answer a user's exact queue position.

## Decision

The Web bundle includes a native `ui-inference-dashboard` Settings section. Its browser half renders SparkDash-derived LLM and host-resource panels and calls the authenticated `llm.metrics` and `llm.resources` APIs. The Host reads deployment-owned HTTP(S) URLs from `DSH_INFERENCE_METRICS_URL` and `DSH_INFERENCE_RESOURCES_URL`, applies a deadline and response-size limit, and returns fixed field allowlists. Configured URLs, raw Prometheus labels, provider diagnostics, Spark identity, MAC addresses, disabled or inactive resources, and unselected SparkDash fields never enter a browser response.

Required running and waiting request gauges are summed across labeled series and must be non-negative integers. Optional KV-cache occupancy, counters, ratios, engine state, and histogram quantiles are omitted when invalid. The parser examines at most 10,000 vLLM samples inside the response byte limit; malformed vLLM rows reject the sample. A best-effort same-origin `/v1/models` lookup supplies model and context metadata without making metrics availability depend on that companion endpoint. Successful samples carry the deployment-configured refresh cadence; browser-local counter deltas provide generation and prefill rates plus 30-sample sparklines. A failed sample stops polling and remains visible until an explicit retry.

The resource API accepts one SparkDash metrics snapshot and projects GPU utilization, temperature, power, clocks, VRAM and at most five processes; enabled mounted-storage capacity and I/O; and active addressed network interfaces, primary status, link speed, and transfer rates. GPU utilization and temperature retain browser-local 30-sample sparklines. Resource and LLM polling have independent state and retry, so one unavailable source does not hide the other. The dashboard exposes no SparkDash mutation, refresh, device-toggle, or Wake-on-LAN operation.

The dashboard labels running and waiting values as deployment aggregates. Exact per-task position remains absent until a DSH-owned LLM proxy can assign request identities and record queued, running, completed, and cancelled transitions under the authenticated Session.

## Verification

Parser and carrier tests cover aggregation, both selected-field projections, omission of unselected resource fields, histogram interpolation, model metadata enrichment, malformed input, row and response bounds, network failures, protocol validation, unconfigured deployments, and successful wire projection. Browser package tests cover LLM and resource rendering, live-rate and trend derivation, polling ownership, independent failure display, retry, and late-response suppression. The assembled-Web snapshot starts the real Web application, opens Settings, observes a real HTTP scrape failure, retries against the recovered metrics service, and records the ready dashboard.

## Alternatives considered

**Embed SparkDash in an iframe.** This requires deploying and authenticating another Web application, inherits its navigation and styling, and makes DSH responsible for a cross-application trust relationship. The native section uses the existing Settings, authentication, localization, and design systems.

**Fetch Prometheus from the browser.** This exposes an infrastructure address, requires browser network and CORS access to the inference host, and bypasses the existing authenticated API carrier. Host-side retrieval keeps deployment details and limits in the deployment plane.

**Infer queue position from aggregate gauges.** A waiting count contains neither ordering nor request identity. Reporting a rank from it would fabricate a user-specific guarantee, especially under a scheduler that is not strict FIFO.

## Consequences

Users gain SparkDash's curated vLLM and resource panels inside DSH without another page or browser application. Deployments must expose the vLLM metrics and SparkDash snapshot endpoints to the DSH Host and configure their URLs. The dashboard adds bounded periodic Host traffic while its Settings section is mounted, and its short trends restart with the browser controller. SparkDash's persistent history, mutation controls, benchmark, and showcase features remain outside this observational section. The panel deliberately provides no per-user queue rank; adding that capability requires request-lifecycle ownership in the DSH LLM proxy rather than another Prometheus parser.
