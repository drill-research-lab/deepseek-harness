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
   * Prometheus endpoint. The response includes summary values and every
   * parsed vLLM series, while the internal endpoint address remains Host-only.
   */
  metrics(
    request: RpcRequest<{}>,
    signal?: AbortSignal,
  ): Promise<RpcResponse<InferenceMetricsView>>

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

/** Prometheus metric types accepted from a vLLM exposition. */
export type InferenceMetricType =
  | 'counter'
  | 'gauge'
  | 'histogram'
  | 'summary'
  | 'untyped'
  | 'info'
  | 'stateset'
  | 'gaugehistogram'
  | 'unknown'

/** One decoded label on a Prometheus series. */
export interface InferenceMetricLabelView {
  /** Prometheus label name. */
  name: string
  /** Decoded Prometheus label value. */
  value: string
}

/** One vLLM Prometheus sample, preserving its exact numeric token. */
export interface InferenceMetricSeriesView {
  /** Exact metric name, including a histogram suffix when present. */
  metric: string
  /** Labels that distinguish this series from its siblings. */
  labels: InferenceMetricLabelView[]
  /** Prometheus numeric token, including `NaN` and infinities. */
  value: string
}

/** One declared or inferred vLLM Prometheus metric family. */
export interface InferenceMetricFamilyView {
  /** Family name from `TYPE`/`HELP`, or the exact sample name when undeclared. */
  name: string
  /** Provider description from `HELP`, when exposed. */
  help?: string
  /** Provider metric type from `TYPE`, when recognized. */
  type?: InferenceMetricType
  /** Every sample assigned to this family. */
  series: InferenceMetricSeriesView[]
}

/** Authenticated browser projection of one vLLM metrics sample. */
export interface InferenceMetricsView {
  /** Recognized inference backend. */
  backend: 'vllm'
  /** Host sample time in Unix milliseconds. */
  sampledAt: number
  /** Delay before the browser requests another successful sample. */
  refreshAfterMs: number
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
  /** Complete parsed vLLM metric families from the bounded exposition. */
  metricFamilies: InferenceMetricFamilyView[]
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
