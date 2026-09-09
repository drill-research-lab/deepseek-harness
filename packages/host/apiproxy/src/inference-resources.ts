/** Bounded SparkDash resource retrieval for the authenticated inference dashboard. */

import { z } from 'zod'
import type { InferenceResourcesView } from './api/llm.ts'
import { boundedText, InferenceMetricsError } from './inference-metrics.ts'

const MAX_RESOURCE_ROWS = 32
const MAX_RESOURCE_STRING = 256

const finiteNonnegative = z.number().nonnegative()
const boundedString = z.string().max(MAX_RESOURCE_STRING)

const sourceSchema = z.object({
  metrics: z.object({
    gpu: z.object({
      temperature: finiteNonnegative,
      usage: finiteNonnegative.max(100),
      power: z.object({ draw: finiteNonnegative, limit: finiteNonnegative }),
      vram: z.object({
        used: finiteNonnegative,
        total: finiteNonnegative,
        available: finiteNonnegative,
      }),
      processes: z.array(z.object({
        pid: z.number().int().nonnegative(),
        name: boundedString,
        vramMB: finiteNonnegative,
      })).max(MAX_RESOURCE_ROWS).optional(),
      throttle: z.object({
        active: z.boolean(),
        reason: boundedString,
        smClockMHz: finiteNonnegative.nullable(),
        smClockMaxMHz: finiteNonnegative.nullable(),
      }).nullable().optional(),
    }).nullable().optional(),
    storage: z.array(z.object({
      device: boundedString,
      label: boundedString,
      used: finiteNonnegative,
      total: finiteNonnegative,
      available: finiteNonnegative,
      readSpeed: finiteNonnegative,
      writeSpeed: finiteNonnegative,
      disabled: z.boolean().optional(),
    })).max(MAX_RESOURCE_ROWS).optional(),
    network: z.object({
      primaryInterface: boundedString.nullable(),
      linkSpeedMbps: finiteNonnegative.nullable(),
      interfaces: z.array(z.object({
        name: boundedString,
        rxSpeed: finiteNonnegative,
        txSpeed: finiteNonnegative,
        ip: boundedString.nullable(),
        operstate: boundedString,
        disabled: z.boolean().optional(),
      })).max(MAX_RESOURCE_ROWS),
    }).nullable().optional(),
  }),
})

/** SparkDash resource values before browser refresh metadata is attached. */
export type InferenceResourcesSample = Omit<InferenceResourcesView, 'refreshAfterMs'>

/**
 * Parse and project one SparkDash metrics snapshot.
 * @param input - untrusted JSON response.
 * @param sampledAt - Host sample timestamp.
 * @returns the detached resource allowlist.
 * @throws {@link InferenceMetricsError} when resource fields are malformed.
 */
export function parseInferenceResources(input: unknown, sampledAt = Date.now()): InferenceResourcesSample {
  const parsed = sourceSchema.safeParse(input)
  if (!parsed.success) {
    throw new InferenceMetricsError(
      'The configured resource endpoint did not expose valid SparkDash metrics.',
      'inference-metrics-invalid',
      { cause: parsed.error },
    )
  }
  const { gpu, storage = [], network } = parsed.data.metrics
  return {
    sampledAt,
    ...gpu === undefined || gpu === null ? {} : {
      gpu: {
        usagePercent: gpu.usage,
        temperatureC: gpu.temperature,
        powerDrawWatts: gpu.power.draw,
        powerLimitWatts: gpu.power.limit,
        vramUsedMb: gpu.vram.used,
        vramTotalMb: gpu.vram.total,
        vramAvailableMb: gpu.vram.available,
        throttled: gpu.throttle?.active ?? false,
        throttleReason: gpu.throttle?.reason ?? 'unknown',
        ...gpu.throttle?.smClockMHz === undefined || gpu.throttle.smClockMHz === null
          ? {} : { smClockMhz: gpu.throttle.smClockMHz },
        ...gpu.throttle?.smClockMaxMHz === undefined || gpu.throttle.smClockMaxMHz === null
          ? {} : { smClockMaxMhz: gpu.throttle.smClockMaxMHz },
        processes: (gpu.processes ?? []).slice(0, 5).map(process => ({
          pid: process.pid,
          name: process.name,
          vramMb: process.vramMB,
        })),
      },
    },
    storage: storage.filter(disk => disk.disabled !== true).map(disk => ({
      device: disk.device,
      label: disk.label,
      usedMb: disk.used,
      totalMb: disk.total,
      availableMb: disk.available,
      readBytesPerSecond: disk.readSpeed,
      writeBytesPerSecond: disk.writeSpeed,
    })),
    ...network?.primaryInterface === undefined || network.primaryInterface === null
      ? {} : { primaryNetworkInterface: network.primaryInterface },
    ...network?.linkSpeedMbps === undefined || network.linkSpeedMbps === null
      ? {} : { networkLinkSpeedMbps: network.linkSpeedMbps },
    networkInterfaces: (network?.interfaces ?? []).flatMap((item) => {
      if (item.disabled === true || item.operstate !== 'up' || item.ip === null) return []
      return [{
        name: item.name,
        ip: item.ip,
        primary: item.name === network?.primaryInterface,
        rxBytesPerSecond: item.rxSpeed,
        txBytesPerSecond: item.txSpeed,
      }]
    }),
  }
}

/**
 * Fetch one bounded SparkDash metrics snapshot.
 * @param url - validated HTTP(S) endpoint.
 * @param maxBytes - complete response byte limit.
 * @param signal - caller and timeout cancellation.
 * @returns current projected resource sample.
 */
export async function fetchInferenceResources(
  url: URL,
  maxBytes: number,
  signal: AbortSignal,
): Promise<InferenceResourcesSample> {
  let response: Response
  try {
    response = await fetch(url, { headers: { accept: 'application/json' }, signal })
  } catch (error) {
    throw new InferenceMetricsError(
      'The inference resource endpoint could not be reached.',
      'inference-metrics-unavailable',
      { cause: error },
    )
  }
  if (!response.ok) {
    await response.body?.cancel().catch((_alreadyClosed: unknown) => {
      // The non-success status is complete; cancellation only releases unread bytes.
    })
    throw new InferenceMetricsError(
      `The inference resource endpoint returned HTTP ${String(response.status)}.`,
      'inference-metrics-unavailable',
    )
  }
  try {
    return parseInferenceResources(JSON.parse(await boundedText(response, maxBytes)))
  } catch (error: unknown) {
    if (error instanceof InferenceMetricsError) throw error
    throw new InferenceMetricsError(
      'The configured resource endpoint did not return valid JSON.',
      'inference-metrics-invalid',
      { cause: error },
    )
  }
}
