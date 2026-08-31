# @deepseek-ai/dsh-client-ui-inference-dashboard

English | [简体中文](README.zh.md) | [繁體中文](README.zh-tw.md)

The inference dashboard is a native DSH Settings section for live vLLM runtime status. It stays inside the existing Settings dialog rather than embedding or navigating to another application. The cards show running and waiting request totals, KV-cache occupancy when available, cumulative prompt and generated tokens, and scheduler preemptions.

The browser calls the authenticated `llm.metrics` RPC. The Host reads the deployment-owned Prometheus endpoint configured by `DSH_INFERENCE_METRICS_URL`, bounds each response, applies a deadline, parses only the displayed vLLM metrics, and returns no endpoint address. A successful response supplies the next refresh interval. A failed scrape stops automatic polling, keeps a visible error state, and requires an explicit retry.

Set `DSH_INFERENCE_METRICS_URL` to the complete vLLM metrics URL, normally `http://<vllm-host>:<port>/metrics`, before starting the Web composition. Leaving it unset keeps the section available with an explicit unconfigured state.

The layout is informed by [SparkDash](https://github.com/MiaAI-Lab/sparkDash), while the implementation uses DSH's Settings slots, design tokens, authenticated RPC carrier, and locale system. No SparkDash source, server, iframe, or additional page is bundled.

## Model Experience

None, as the package reads operational metrics for a human-facing browser section and adds nothing to model requests or Session logs.

#### KV Cache effect

None. The displayed occupancy is observational; the dashboard neither allocates cache nor changes inference requests.

## Known Limitations and Deferred Work

- **Request counts are deployment aggregates** — vLLM's running and waiting gauges do not identify the current user, Session, or request and therefore cannot establish a task's queue position. Exact position requires request identity and lifecycle tracking at the DSH LLM proxy.
- **vLLM is the only recognized backend** — a configured endpoint that does not expose the required vLLM request gauges produces a visible invalid-metrics error.
- **Failure recovery is manual** — successful samples poll at the Host-provided cadence, while a failed scrape waits for the user to retry instead of creating an uncontrolled retry loop.
