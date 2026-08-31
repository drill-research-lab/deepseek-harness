/**
 * llm domain zod schemas (names derived from map keys: llmProvidersRequestSchema /
 * llmProvidersValueSchema / llmModelsRequestSchema / llmModelsValueSchema).
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import type { ConfigurableProviderView, DiscoveredModelView, InferenceMetricsView } from './llm.ts'
import { modelCatalogFailureSchema, modelProviderGroupSchema } from './sessions.schema.ts'

/** ConfigurableProviderView row of llm.providers. */
export const configurableProviderViewSchema = z.object({
  provider: z.string().min(1),
  displayName: z.string().min(1),
  settingsNs: z.string(),
  settingsPath: z.array(z.string()),
  active: z.boolean(),
  declared: z.boolean().optional(),
}) satisfies z.ZodType<Wire<ConfigurableProviderView>>

/** llm.providers request payload. */
export const llmProvidersRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'llm.providers'>>>

/** llm.providers response value. */
export const llmProvidersValueSchema = z.object({
  providers: z.array(configurableProviderViewSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'llm.providers'>>>

/** llm.models request payload. */
export const llmModelsRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'llm.models'>>>

/** llm.models response value. */
export const llmModelsValueSchema = z.object({
  groups: z.array(modelProviderGroupSchema),
  failures: z.array(modelCatalogFailureSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'llm.models'>>>

/** llm.metrics request payload. */
export const llmMetricsRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'llm.metrics'>>>

const inferenceMetricTypeSchema = z.enum([
  'counter',
  'gauge',
  'histogram',
  'summary',
  'untyped',
  'info',
  'stateset',
  'gaugehistogram',
  'unknown',
])

const inferenceMetricLabelViewSchema = z.object({
  name: z.string().min(1),
  value: z.string(),
})

const inferenceMetricSeriesViewSchema = z.object({
  metric: z.string().min(1),
  labels: z.array(inferenceMetricLabelViewSchema),
  value: z.string().min(1),
})

const inferenceMetricFamilyViewSchema = z.object({
  name: z.string().min(1),
  help: z.string().optional(),
  type: inferenceMetricTypeSchema.optional(),
  series: z.array(inferenceMetricSeriesViewSchema),
})

/** llm.metrics response value. */
export const llmMetricsValueSchema = z.object({
  backend: z.literal('vllm'),
  sampledAt: z.number().int().nonnegative(),
  refreshAfterMs: z.number().int().positive(),
  requestsRunning: z.number().int().nonnegative(),
  requestsWaiting: z.number().int().nonnegative(),
  kvCacheUsage: z.number().min(0).max(1).optional(),
  promptTokensTotal: z.number().nonnegative().optional(),
  generationTokensTotal: z.number().nonnegative().optional(),
  preemptionsTotal: z.number().nonnegative().optional(),
  metricFamilies: z.array(inferenceMetricFamilyViewSchema),
}) satisfies z.ZodType<Wire<InferenceMetricsView>>

/** DiscoveredModelView row of llm.discoverModels. */
export const discoveredModelViewSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  contextWindow: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional(),
}) satisfies z.ZodType<Wire<DiscoveredModelView>>

/** llm.discoverModels request payload. */
export const llmDiscoverModelsRequestSchema = z.object({
  settingsNs: z.string().min(1),
  provider: z.string().min(1).optional(),
  baseURL: z.string().min(1).optional(),
  api: z.string().min(1).optional(),
  // Write-only at the host: used for this one interrogation, never stored and
  // never returned. It does ride the client's outgoing envelope like every
  // other secret-bearing payload (`credentials.set`, `settings.update`), which
  // `subscribeEnvelopes()` observers can see — redacting that tap is a
  // configuration-plane-wide change, not this method's to make alone.
  apiKey: z.string().min(1).optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'llm.discoverModels'>>>

/** llm.discoverModels response value. */
export const llmDiscoverModelsValueSchema = z.object({
  models: z.array(discoveredModelViewSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'llm.discoverModels'>>>
