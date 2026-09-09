// Real Web composition: Settings opens the embedded inference dashboard over
// authenticated LLM and resource RPCs, including visible failure and retry.

import { createServer, type Server } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold,
  watchConsole, webSnapshotMode, WELCOME_NOTICE_COPY, type WebScaffold,
} from './scaffold.ts'
import { ZH_BROWSER_LOCALE, saveFailureShot } from './support.ts'

const MODE = webSnapshotMode()
const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/inference-dashboard', import.meta.url))
const READY_EXPECTED = join(SNAPSHOT_DIR, 'ready.expected.md')
const METRICS = `
# HELP vllm:num_requests_running Number of requests currently running.
# TYPE vllm:num_requests_running gauge
vllm:num_requests_running{engine="0",model_name="test-model"} 2
# HELP vllm:num_requests_waiting Number of requests waiting to be processed.
# TYPE vllm:num_requests_waiting gauge
vllm:num_requests_waiting{engine="0",model_name="test-model"} 7
vllm:kv_cache_usage_perc 0.42
vllm:prompt_tokens_total 1200
vllm:generation_tokens_total 345
vllm:num_preemptions_total 6
vllm:iteration_tokens_total_sum 1500
vllm:engine_sleep_state{sleep_state="awake"} 1
vllm:prefix_cache_hits_total 75
vllm:prefix_cache_queries_total 100
vllm:spec_decode_num_accepted_tokens_total 60
vllm:spec_decode_num_draft_tokens_total 100
# HELP vllm:time_to_first_token_seconds Time to first token.
# TYPE vllm:time_to_first_token_seconds histogram
vllm:time_to_first_token_seconds_bucket{engine="0",model_name="test-model",le="0.5"} 8
vllm:time_to_first_token_seconds_bucket{engine="0",model_name="test-model",le="1.0"} 10
vllm:time_to_first_token_seconds_bucket{engine="0",model_name="test-model",le="+Inf"} 10
vllm:time_to_first_token_seconds_count{engine="0",model_name="test-model"} 10
`
const RESOURCES = {
  metrics: {
    gpu: {
      temperature: 47,
      usage: 12,
      power: { draw: 9.94, limit: 120 },
      vram: { used: 112246, total: 122566, available: 2329 },
      processes: [{ pid: 40781, name: 'VLLM::EngineCore', vramMB: 112246 }],
      throttle: { active: false, reason: 'ok', smClockMHz: 2190, smClockMaxMHz: 3003 },
    },
    storage: [{
      device: 'nvme0n1p2', label: '/', used: 387884, total: 3845092,
      available: 3261857, readSpeed: 0, writeSpeed: 7372,
    }],
    network: {
      primaryInterface: 'enP7s7',
      linkSpeedMbps: 1000,
      interfaces: [{
        name: 'enP7s7', rxSpeed: 38912, txSpeed: 2764,
        ip: '192.168.101.70', operstate: 'up',
      }],
    },
  },
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('metrics fixture did not bind a TCP port'))
        return
      }
      resolve(address.port)
    })
  })
}

describe('web e2e: embedded inference dashboard', () => {
  let root: string
  let metricsServer: Server
  let metricsReady = false
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-inference-dashboard-'))
    metricsServer = createServer((request, response) => {
      if (!metricsReady) {
        response.writeHead(503, { 'content-type': 'text/plain' })
        response.end('warming up')
        return
      }
      if (request.url === '/v1/models') {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ data: [{ id: 'test-model', max_model_len: 128_000 }] }))
        return
      }
      if (request.url === '/resources') {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify(RESOURCES))
        return
      }
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.end(METRICS)
    })
    const port = await listen(metricsServer)
    const overlay = join(root, 'metrics.overlay.yml')
    await writeFile(overlay, `- id: api-gateway
  config:
    inferenceMetricsUrl: http://127.0.0.1:${String(port)}/metrics
    inferenceResourcesUrl: http://127.0.0.1:${String(port)}/resources
    inferenceMetricsRefreshMs: 60000
`, 'utf8')
    scaffold = await launchWebScaffold({ extraOverlayPath: overlay })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    const welcome = page.getByRole('dialog', { name: WELCOME_NOTICE_COPY.zh.title })
    await welcome.getByRole('button', { name: WELCOME_NOTICE_COPY.zh.continueLabel }).click()
    await welcome.waitFor({ state: 'detached' })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
    if (metricsServer?.listening) {
      await new Promise<void>((resolve, reject) => {
        metricsServer.close((error) => { if (error === undefined) resolve(); else reject(error) })
      })
    }
    if (root !== undefined) await rm(root, { recursive: true, force: true })
  })

  it('shows endpoint failure inside DSH and retries into live metric cards', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-inference-dashboard'))
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '设置' })
    await dialog.getByRole('button', { name: '推理状态' }).click()
    await dialog.getByRole('alert').first().waitFor({ timeout: 10_000 })
    expect(await dialog.getByRole('alert').first().textContent()).toContain('HTTP 503')

    metricsReady = true
    await dialog.getByRole('button', { name: '重试' }).first().click()
    await dialog.getByRole('heading', { name: '模型运行状态' }).waitFor({ timeout: 10_000 })
    const panel = dialog.getByRole('article', { name: 'LLM 运行指标' })
    expect(await panel.textContent()).toContain('test-model')
    expect(await panel.textContent()).toContain('Requests2 run / 7 wait')
    expect(await panel.textContent()).toContain('KV Cache42.0%')
    expect(await panel.textContent()).toContain('Context128,000')
    expect(await panel.textContent()).toContain('Prefix Cache75.0%')
    await dialog.getByRole('button', { name: '重试' }).click()
    const gpu = dialog.getByRole('article', { name: 'GPU 资源' })
    expect(await gpu.textContent()).toContain('VLLM::EngineCore')
    expect(await dialog.getByRole('article', { name: '存储资源' }).textContent()).toContain('nvme0n1p2')
    expect(await dialog.getByRole('article', { name: '网络资源' }).textContent()).toContain('192.168.101.70')

    const snapshot = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(READY_EXPECTED, snapshot, MODE)
    expect(snapshot).toContain('Requests 是整个 vLLM 部署的总量，不代表当前 DSH 任务的排队位置。')
    expect(snapshot).toContain('VLLM::EngineCore')
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)
})
