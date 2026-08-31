// Real Web composition: Settings opens the embedded inference dashboard over
// the authenticated llm.metrics RPC, including visible failure and retry.

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
vllm:num_requests_running 2
vllm:num_requests_waiting 7
vllm:kv_cache_usage_perc 0.42
vllm:prompt_tokens_total 1200
vllm:generation_tokens_total 345
vllm:num_preemptions_total 6
`

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
    metricsServer = createServer((_request, response) => {
      if (!metricsReady) {
        response.writeHead(503, { 'content-type': 'text/plain' })
        response.end('warming up')
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
    await dialog.getByRole('alert').waitFor({ timeout: 10_000 })
    expect(await dialog.getByRole('alert').textContent()).toContain('HTTP 503')

    metricsReady = true
    await dialog.getByRole('button', { name: '重试' }).click()
    await dialog.getByRole('heading', { name: '模型运行状态' }).waitFor({ timeout: 10_000 })
    const requests = dialog.getByRole('article', { name: '请求' })
    expect(await requests.textContent()).toContain('运行中2')
    expect(await requests.textContent()).toContain('等待中7')
    expect(await dialog.getByRole('progressbar', { name: 'KV 缓存' }).getAttribute('aria-valuenow')).toBe('42')

    const snapshot = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(READY_EXPECTED, snapshot, MODE)
    expect(snapshot).toContain('这里显示总请求数，不代表当前任务的排队序位。')
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)
})
