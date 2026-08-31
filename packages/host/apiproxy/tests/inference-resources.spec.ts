/** SparkDash resource allowlist parsing and rejection behavior. */

import { describe, expect, it } from 'vitest'
import { InferenceMetricsError } from '../src/inference-metrics.ts'
import { parseInferenceResources } from '../src/inference-resources.ts'

function snapshot(): unknown {
  return {
    spark: { id: 'park-secret', host: 'internal.example' },
    metrics: {
      gpu: {
        temperature: 47,
        usage: 12,
        power: { draw: 9.94, limit: 120, systemDraw: 35 },
        vram: { used: 112246, total: 122566, available: 2329, percentage: 92 },
        processes: [{ pid: 40781, name: 'VLLM::EngineCore', vramMB: 112246 }],
        throttle: { active: false, reason: 'ok', smClockMHz: 2190, smClockMaxMHz: 3003 },
      },
      storage: [
        { device: 'nvme0n1p2', label: '/', used: 387884, total: 3845092, available: 3261857, readSpeed: 0, writeSpeed: 7372 },
        { device: 'secret', label: '/secret', used: 1, total: 2, available: 1, readSpeed: 0, writeSpeed: 0, disabled: true },
      ],
      network: {
        primaryInterface: 'enP7s7',
        linkSpeedMbps: 1000,
        wolMac: '00:11:22:33:44:55',
        interfaces: [
          { name: 'enP7s7', rxSpeed: 38912, txSpeed: 2764, ip: '192.168.101.70', operstate: 'up' },
          { name: 'docker0', rxSpeed: 0, txSpeed: 0, ip: '172.17.0.1', operstate: 'down' },
        ],
      },
      cpu: { usage: 99 },
    },
  }
}

describe('parseInferenceResources', () => {
  it('returns only enabled resource rows and omits unrelated SparkDash fields', () => {
    expect(parseInferenceResources(snapshot(), 123)).toEqual({
      sampledAt: 123,
      gpu: {
        usagePercent: 12,
        temperatureC: 47,
        powerDrawWatts: 9.94,
        powerLimitWatts: 120,
        smClockMhz: 2190,
        smClockMaxMhz: 3003,
        vramUsedMb: 112246,
        vramTotalMb: 122566,
        vramAvailableMb: 2329,
        throttled: false,
        throttleReason: 'ok',
        processes: [{ pid: 40781, name: 'VLLM::EngineCore', vramMb: 112246 }],
      },
      storage: [{
        device: 'nvme0n1p2', label: '/', usedMb: 387884, totalMb: 3845092,
        availableMb: 3261857, readBytesPerSecond: 0, writeBytesPerSecond: 7372,
      }],
      primaryNetworkInterface: 'enP7s7',
      networkLinkSpeedMbps: 1000,
      networkInterfaces: [{
        name: 'enP7s7', ip: '192.168.101.70', primary: true,
        rxBytesPerSecond: 38912, txBytesPerSecond: 2764,
      }],
    })
    expect(JSON.stringify(parseInferenceResources(snapshot()))).not.toContain('wolMac')
    expect(JSON.stringify(parseInferenceResources(snapshot()))).not.toContain('park-secret')
  })

  it('rejects malformed or unbounded source fields', () => {
    expect(() => parseInferenceResources({ metrics: { gpu: { usage: 101 } } })).toThrow(InferenceMetricsError)
    expect(() => parseInferenceResources({ metrics: { network: { interfaces: Array.from({ length: 33 }, () => ({})) } } }))
      .toThrow(InferenceMetricsError)
  })
})
