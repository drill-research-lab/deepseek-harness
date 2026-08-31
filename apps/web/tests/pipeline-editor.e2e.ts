// Keyless assembled-browser coverage for the pipelines surface over the
// shipped Web bundles and FixtureApiClient wire: the sidebar block boots
// empty, the template gallery creates a Scheduled Search pipeline through
// the real host RPC (expand + validate + persist), the editor opens on it,
// run-now settles a real run record, and the sidebar reflects the pause
// toggle. No model turn is involved, so the whole flow is keyless.
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

/** controlled-input fill helper: see comment */
async function fillReact(page: Page, testId: string, value: string): Promise<void> {
  await page.getByTestId(testId).evaluate((input, text) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/pipeline-editor', import.meta.url))
const SIDEBAR_EXPECTED = join(SNAPSHOT_DIR, 'sidebar.expected.md')
const MODE = webSnapshotMode()

describe('web e2e: pipelines create, run, and pause', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ welcomeNoticePending: true })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(`${scaffold.baseUrl}?fixture`, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    // The fixture cannot acknowledge the welcome notice (its settings.mutate
    // rejects by design), so the testing-notice modal masks the frame for the
    // whole flow. Pointer events never reach the app: every click below is a
    // DOM click through the mask, matching the goal-bar precedent.
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('creates a Scheduled Search pipeline, runs it, and pauses it from the sidebar', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-pipeline-editor'))
    // The navigation block boots into its empty state.
    const emptyState = page.getByText('No pipelines yet')
    await expect.poll(() => emptyState.count(), { timeout: 15_000 }).toBeGreaterThan(0)

    // Gallery form: name + query are the required fields; the rest ship defaults.
    await page.getByTestId('pipeline-new').evaluate((button) => { button.click() })
    const createView = page.getByTestId('pipeline-create')
    await createView.waitFor({ timeout: 10_000 })
    await fillReact(page, 'create-name', 'Lab Digest')
    await fillReact(page, 'create-query', 'LLM agents')
    await createView.getByRole('button', { name: 'Create' }).evaluate((button) => { button.click() })

    // The editor opens on the created pipeline with the DAG canvas mounted.
    const editor = page.getByTestId('pipeline-editor')
    await editor.waitFor({ timeout: 15_000 })
    await expect.poll(() => editor.getByText('Lab Digest').count(), { timeout: 15_000 }).toBeGreaterThan(0)
    await page.getByTestId('pipeline-canvas').waitFor({ timeout: 15_000 })

    // Run now settles a real run record on the host (arXiv fetch included);
    // either status proves the RPC -> engine -> record loop.
    await editor.getByRole('button', { name: 'Run now' }).evaluate((button) => { button.click() })
    const runRow = editor.locator('[data-testid^="run-"]').first()
    await runRow.waitFor({ timeout: 60_000 })
    await runRow.evaluate((button) => { button.click() })
    await page.getByTestId('run-detail').waitFor({ timeout: 10_000 })
    expect(await page.getByTestId('run-detail').textContent()).toMatch(/Nodes/iu)

    // Close the editor; the sidebar block lists the created pipeline and the
    // pause toggle flips to its resume glyph without an error. The fixture
    // mints its own ids (fx-pipeline-N), so the row is located by name.
    await editor.getByRole('button', { name: 'Close', exact: true }).evaluate((button) => { button.click() })
    const row = page.locator('[data-testid^="pipeline-"]').filter({ hasText: 'Lab Digest' })
    await row.waitFor({ timeout: 10_000 })
    const snapshot = await captureStableAria(page, '[data-testid="pipelines-nav"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(SIDEBAR_EXPECTED, snapshot, MODE)

    await page.getByRole('button', { name: 'Pause', exact: true }).evaluate((button) => { button.click() })
    await expect.poll(() => page.getByRole('button', { name: 'Resume', exact: true }).count(), { timeout: 10_000 }).toBe(1)
    expect(tripwire.pageErrors).toEqual([])
  }, 180_000)

  it.skipIf(MODE === 'record')('keeps the fixture inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['sidebar.expected.md'])
  })
})
