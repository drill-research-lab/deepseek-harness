/**
 * llm domain contract: host-scoped provider topology for configuration
 * surfaces. `llm.providers` merges the configurable-provider directory
 * (which providers CAN be configured, and where their settings live) with the
 * live route registry; `llm.models` is the session-independent model catalog
 * (the same groups as `session.models`, without a per-session selection).
 * Clients invalidate from the forwarded `llm/adapters-updated` and
 * `settings/document-updated` owner events.
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'
import type { ModelCatalogFailure, ModelProviderGroup } from './sessions.ts'

/** Wire view of one configurable provider. */
export interface ConfigurableProviderView {
  /** Provider route key (`deepseek-official`, `openai`, …). */
  provider: string
  /** Human-readable name for configuration surfaces. */
  displayName: string
  /** Settings namespace whose section configures this provider. */
  settingsNs: string
  /** Path from that section's root to the provider's profile object (empty = whole section). */
  settingsPath: string[]
  /** Whether the route is currently registered (its models are requestable). */
  active: boolean
  /**
   * Whether the owning adapter knows this route only because configuration
   * declared it. Absent when the adapter draws no such distinction, so a
   * surface must treat absence as "unknown", not as "shipped".
   */
  declared?: boolean
}

/** Llm-domain unary methods (the map keys llm.* of RpcMethodMap). */
export interface LlmApi {
  /**
   * List every configurable provider with its live/dormant state, in
   * directory declaration order. Routes registered outside the directory
   * (an adapter that never declared configurability) are appended with their
   * registration identity and no settings address.
   */
  providers(request: RpcRequest<{}>): Promise<RpcResponse<{ providers: ConfigurableProviderView[] }>>

  /**
   * Host-scoped model catalog over every registered provider route: the
   * settings surface's models view, needing no session. Per-provider listing
   * failures ride `failures` without failing the sound groups.
   */
  models(request: RpcRequest<{}>): Promise<RpcResponse<{ groups: ModelProviderGroup[]; failures: ModelCatalogFailure[] }>>

  /**
   * Read one bounded metrics sample from the deployment's configured vLLM
   * Prometheus endpoint. The response exposes the curated runtime values used
   * by the in-product dashboard, while the internal endpoint remains Host-only.
   */
  metrics(
    request: RpcRequest<{}>,
    signal?: AbortSignal,
  ): Promise<RpcResponse<InferenceMetricsView>>

  /**
   * Read the bounded GPU, storage, and network projection from the deployment's
   * configured SparkDash metrics endpoint. The source endpoint remains Host-only.
   */
  resources(
    request: RpcRequest<{}>,
    signal?: AbortSignal,
  ): Promise<RpcResponse<InferenceResourcesView>>

  /**
   * Interrogate a provider endpoint the configuration surface is still
   * drafting, and return the models it advertises for the user to adopt.
   *
   * The payload is the draft, not a stored route: `settingsNs` selects the
   * adapter family that answers, and the rest comes from the form. `provider`
   * names the route being edited when there is one — an adapter that already
   * describes that route answers from its own registry, with better metadata
   * and no network call, and needs no endpoint. A route it does not describe is
   * asked over the wire, which is what `baseURL`, `api`, and `apiKey` are for.
   *
   * Nothing is written — the reply is candidates, and only a later
   * `settings.mutate` decides what a route serves. `apiKey` is accepted here
   * but never stored or returned; a provider whose key is already stored omits
   * it and the endpoint answers unauthenticated or refuses.
   */
  discoverModels(
    request: RpcRequest<{
      settingsNs: string
      provider?: string
      baseURL?: string
      api?: string
      apiKey?: string
    }>,
    signal?: AbortSignal,
  ): Promise<RpcResponse<{ models: DiscoveredModelView[] }>>
}

/** Authenticated browser projection of one vLLM metrics sample. */
export interface InferenceMetricsView {
  /** Recognized inference backend. */
  backend: 'vllm'
  /** Host sample time in Unix milliseconds. */
  sampledAt: number
  /** Delay before the browser requests another successful sample. */
  refreshAfterMs: number
  /** Served model id, when vLLM labels or model metadata disclose it. */
  modelId?: string
  /** Maximum model context from `/v1/models`, when disclosed. */
  contextLength?: number
  /** Current engine residency inferred from the labeled sleep-state gauges. */
  engineState?: 'active' | 'weights-offloaded' | 'discarded'
  /** Requests in model execution batches. */
  requestsRunning: number
  /** Requests accepted but waiting for processing. */
  requestsWaiting: number
  /** KV-cache occupancy as a fraction from zero through one, when exposed. */
  kvCacheUsage?: number
  /** Cumulative prompt tokens, when exposed. */
  promptTokensTotal?: number
  /** Cumulative generated tokens, when exposed. */
  generationTokensTotal?: number
  /** Cumulative scheduler preemptions, when exposed. */
  preemptionsTotal?: number
  /** Cumulative engine-step tokens used to derive live prefill throughput. */
  iterationTokensTotal?: number
  /** Cumulative TTFT seconds used to derive completed-prefill throughput. */
  ttftSecondsTotal?: number
  /** Lifetime prefix-cache hit fraction, when both source counters exist. */
  prefixCacheHitRate?: number
  /** Lifetime speculative-token acceptance fraction, when enabled. */
  mtpAcceptanceRate?: number
  /** Histogram-derived time-to-first-token p95 in seconds. */
  ttftP95Seconds?: number
  /** Histogram-derived end-to-end request-latency p95 in seconds. */
  e2eP95Seconds?: number
  /** Histogram-derived inter-token-latency p95 in seconds. */
  itlP95Seconds?: number
}

/** GPU process row disclosed by the authenticated resources dashboard. */
export interface InferenceGpuProcessView {
  /** Host process id. */
  pid: number
  /** Bounded process display name. */
  name: string
  /** GPU memory attributed to the process in MiB. */
  vramMb: number
}

/** GPU resources disclosed by the authenticated dashboard. */
export interface InferenceGpuResourcesView {
  /** Current device utilization percentage. */
  usagePercent: number
  /** Current device temperature in degrees Celsius. */
  temperatureC: number
  /** Current GPU board draw in watts. */
  powerDrawWatts: number
  /** Configured GPU power limit in watts. */
  powerLimitWatts: number
  /** Current streaming-multiprocessor clock in MHz. */
  smClockMhz?: number
  /** Maximum streaming-multiprocessor clock in MHz. */
  smClockMaxMhz?: number
  /** Current GPU memory allocation in MiB. */
  vramUsedMb: number
  /** Total GPU memory in MiB. */
  vramTotalMb: number
  /** Available GPU memory in MiB. */
  vramAvailableMb: number
  /** Whether the source reports an active throttle reason. */
  throttled: boolean
  /** Bounded source throttle summary. */
  throttleReason: string
  /** At most five GPU process rows. */
  processes: InferenceGpuProcessView[]
}

/** Mounted storage row disclosed by the authenticated dashboard. */
export interface InferenceStorageResourceView {
  /** Kernel device name. */
  device: string
  /** Mounted path or source label. */
  label: string
  /** Used capacity in MiB. */
  usedMb: number
  /** Total capacity in MiB. */
  totalMb: number
  /** Available capacity in MiB. */
  availableMb: number
  /** Current read throughput in bytes per second. */
  readBytesPerSecond: number
  /** Current write throughput in bytes per second. */
  writeBytesPerSecond: number
}

/** Active network interface row disclosed by the authenticated dashboard. */
export interface InferenceNetworkInterfaceView {
  /** Kernel interface name. */
  name: string
  /** Source-reported interface address. */
  ip: string
  /** Whether this is the source's primary interface. */
  primary: boolean
  /** Current receive throughput in bytes per second. */
  rxBytesPerSecond: number
  /** Current transmit throughput in bytes per second. */
  txBytesPerSecond: number
}

/** Authenticated browser projection of one SparkDash resource sample. */
export interface InferenceResourcesView {
  /** Host sample time in Unix milliseconds. */
  sampledAt: number
  /** Delay before the browser requests another successful sample. */
  refreshAfterMs: number
  /** GPU details when the monitored host exposes a GPU. */
  gpu?: InferenceGpuResourcesView
  /** Enabled mounted storage rows. */
  storage: InferenceStorageResourceView[]
  /** Source primary network interface, when identified. */
  primaryNetworkInterface?: string
  /** Source-reported primary link speed in Mbps, when known. */
  networkLinkSpeedMbps?: number
  /** Active addressed network interfaces. */
  networkInterfaces: InferenceNetworkInterfaceView[]
}

/** Wire view of one model an interrogated endpoint advertises. */
export interface DiscoveredModelView {
  /** Model id the endpoint accepts. */
  id: string
  /** Human-readable name when the endpoint supplies one. */
  name?: string
  /** Maximum combined request and response context, when disclosed. */
  contextWindow?: number
  /** Maximum output tokens, when disclosed. */
  maxTokens?: number
}
