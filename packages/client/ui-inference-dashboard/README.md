# @deepseek-ai/dsh-client-ui-inference-dashboard

English | [简体中文](README.zh.md) | [繁體中文](README.zh-tw.md)

The inference dashboard is a native DSH Settings section for live vLLM runtime status. It stays inside the existing Settings dialog rather than embedding or navigating to another application. The compact LLM panel shows the model and context limit, generation and prefill throughput with short trends, engine state, running and waiting requests, KV-cache occupancy, cumulative generated tokens and preemptions, prefix-cache and speculative-decoding acceptance rates, and p95 TTFT, end-to-end, and inter-token latency.

The browser calls the authenticated `llm.metrics` RPC. The Host reads the deployment-owned Prometheus endpoint configured by `DSH_INFERENCE_METRICS_URL`, bounds each response, applies a deadline, and returns only the curated panel values without the endpoint address, raw labels, or non-vLLM process metrics. When the URL ends in `/metrics`, the Host also makes a best-effort same-origin `/v1/models` request for the model id and context limit. The parser examines at most 10,000 vLLM samples and rejects malformed or oversized results. A successful response supplies the next refresh interval. A failed scrape stops automatic polling, keeps a visible error state, and requires an explicit retry.

Set `DSH_INFERENCE_METRICS_URL` to the complete vLLM metrics URL, normally `http://<vllm-host>:<port>/metrics`, before starting the Web composition. Leaving it unset keeps the section available with an explicit unconfigured state.

The LLM panel, metric selection, live-rate formulas, and sparklines are adapted from [SparkDash](https://github.com/MiaAI-Lab/sparkDash) under its MIT license; the preserved notice is in [`SPARKDASH_LICENSE`](SPARKDASH_LICENSE). The implementation uses DSH's Settings slots, design tokens, authenticated RPC carrier, and locale system. It does not bundle the SparkDash server, iframe, or separate application.

## Model Experience

None, as the package reads operational metrics for a human-facing browser section and adds nothing to model requests or Session logs.

#### KV Cache effect

None. The displayed occupancy is observational; the dashboard neither allocates cache nor changes inference requests.

## Known Limitations and Deferred Work

- **Request counts are deployment aggregates** — vLLM's running and waiting gauges do not identify the current user, Session, or request and therefore cannot establish a task's queue position. Exact position requires request identity and lifecycle tracking at the DSH LLM proxy.
- **vLLM is the only recognized backend** — a configured endpoint that does not expose the required vLLM request gauges produces a visible invalid-metrics error.
- **History is process-local and short** — the two sparklines retain the latest 30 successful browser samples. SparkDash's daily persistence, historical charts, benchmarks, and showcase workflows are outside this observational Settings section.
- **Failure recovery is manual** — successful samples poll at the Host-provided cadence, while a failed scrape waits for the user to retry instead of creating an uncontrolled retry loop.
