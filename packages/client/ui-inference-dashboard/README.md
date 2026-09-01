# @deepseek-ai/dsh-client-ui-inference-dashboard

English | [简体中文](README.zh.md) | [繁體中文](README.zh-tw.md)

The inference dashboard is a native DSH Settings section for live vLLM runtime and host-resource status. It stays inside the existing Settings dialog rather than embedding or navigating to another application. The compact LLM panel shows the model and context limit, generation and prefill throughput with short trends, engine state, running and waiting requests, KV-cache occupancy, cumulative generated tokens and preemptions, prefix-cache and speculative-decoding acceptance rates, and p95 TTFT, end-to-end, and inter-token latency. The Resources group adds SparkDash-style GPU, mounted-storage, and active-network panels.

The browser calls the authenticated `llm.metrics` and `llm.resources` RPCs. The Host reads the deployment-owned Prometheus endpoint configured by `DSH_INFERENCE_METRICS_URL` and the SparkDash snapshot configured by `DSH_INFERENCE_RESOURCES_URL`; both requests use the configured byte limit and deadline. The resource response is an allowlist: GPU utilization, temperature, power, clocks, memory, and up to five GPU processes; enabled mounted storage capacity and I/O; and active addressed network interfaces, primary-interface status, link speed, and transfer rates. Spark identity, MAC addresses, disabled devices, inactive interfaces, CPU/RAM details, source URLs, and the remaining snapshot never enter the browser response. A failure in one RPC remains local to its panel group and requires an explicit retry.

Set `DSH_INFERENCE_METRICS_URL` to the complete vLLM metrics URL, normally `http://<vllm-host>:<port>/metrics`, and `DSH_INFERENCE_RESOURCES_URL` to one SparkDash snapshot URL, normally `http://<sparkdash-host>:5555/api/sparks/<spark-id>/metrics`, before starting the Web composition. An absent URL leaves its panel group available with an explicit unconfigured state.

The LLM and resource panels, metric selection, live-rate formulas, and sparklines are adapted from [SparkDash](https://github.com/MiaAI-Lab/sparkDash) under its MIT license; the preserved notice is in [`SPARKDASH_LICENSE`](SPARKDASH_LICENSE). The implementation uses DSH's Settings slots, design tokens, authenticated RPC carrier, and locale system. It does not bundle the SparkDash server, iframe, or separate application.

## Model Experience

None, as the package reads operational metrics for a human-facing browser section and adds nothing to model requests or Session logs.

#### KV Cache effect

None. The displayed occupancy is observational; the dashboard neither allocates cache nor changes inference requests.

## Known Limitations and Deferred Work

- **Request counts are deployment aggregates** — vLLM's running and waiting gauges do not identify the current user, Session, or request and therefore cannot establish a task's queue position. Exact position requires request identity and lifecycle tracking at the DSH LLM proxy.
- **vLLM is the only recognized backend** — a configured endpoint that does not expose the required vLLM request gauges produces a visible invalid-metrics error.
- **History is process-local and short** — throughput, GPU utilization, and GPU temperature sparklines retain the latest 30 successful browser samples. SparkDash's daily persistence, historical charts, benchmarks, and showcase workflows are outside this observational Settings section.
- **Resources are observational** — DSH does not expose SparkDash refresh, device-toggle, Wake-on-LAN, or settings mutations. The Host must be able to reach the configured read-only snapshot URL.
- **Failure recovery is manual** — successful samples poll at the Host-provided cadence, while a failed scrape waits for the user to retry instead of creating an uncontrolled retry loop.
