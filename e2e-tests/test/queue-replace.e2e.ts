/**
 * Queue replace-semantics E2E (issue #691).
 *
 * Self-contained session: wdio launches a fresh app per spec file, so the
 * setup loads the fixture video, patches the output directory, and
 * downloads all three parts to a settled done baseline.
 *
 * Requires E2E_SLOW_MEDIA=1 so a part stays observably RUNNING (~20s:
 * throttled CDN probe + streams) while the matrix's enqueue/navigate
 * clicks land — every assertion waits for a stable row state, never a
 * timing window.
 *
 * Assertions follow the runner's ACTUAL semantics (shared/queue/runner.ts):
 * the next pending part is picked in the same call stack that settles the
 * previous one, so an enqueue on an idle queue shows up as RUNNING (never
 * pending) within one poll, and cancelling a RUNNING part immediately
 * starts the next queued part.
 *
 * Branch matrix (each test builds its own precondition and leaves the
 * queue idle, so tests never depend on each other's leftovers):
 * - a SETTLED (done) part   → fresh row appended and started at once; done row stays
 * - a PENDING part          → replaced IN PLACE, row count unchanged
 * - a RUNNING part          → old row cancelled, fresh row appended and started
 * - a user-CANCELLED part   → fresh row appended, cancelled row stays
 */
import { browser } from '@wdio/globals'
import {
  loadFixtureVideo,
  saveScreenshot,
  setupDownloadEnv,
  teardownDownloadEnv,
  waitForMainUI,
  type DownloadEnv,
} from '../helpers/app.helpers'
import * as S from '../helpers/selectors'

/**
 * Waits until exactly `n` rows show a status on /downloads.
 *
 * Must run on /downloads: the /search part cards carry data-status badges
 * too, so the global selector is page-scoped by navigation, not by CSS.
 */
async function waitForRowCount(status: string, n: number, timeout = 30_000) {
  await browser.waitUntil(
    async () => {
      const rows = await browser.$$(S.QUEUE_ROW_BY_STATUS(status))
      return (await rows.length) === n
    },
    {
      timeout,
      interval: 500,
      timeoutMsg: `expected ${n} rows with status ${status}`,
    },
  )
}

/** Waits until no pending/running rows remain — queue idle for the next test. */
async function waitForIdle(timeout = 120_000) {
  await waitForRowCount('pending', 0, timeout)
  await waitForRowCount('running', 0, timeout)
}

/** Navigates to /downloads where the queue rows (and Cancel) live. */
async function gotoDownloads() {
  const nav = await browser.$(S.NAV_DOWNLOADS)
  await nav.waitForExist({ timeout: 15_000 })
  await nav.waitForClickable({ timeout: 10_000 })
  await nav.click()
}

/** Navigates to /search, checks exactly the given part indexes, downloads. */
async function enqueueParts(indexes: number[]) {
  // Wait for the sidebar button before clicking: the previous test may
  // have left the app on /downloads.
  const nav = await browser.$(S.NAV_SEARCH)
  await nav.waitForExist({ timeout: 15_000 })
  await nav.waitForClickable({ timeout: 10_000 })
  await nav.click()
  const list = await browser.$(S.DATA_PART_LIST)
  await list.waitForExist({ timeout: 10_000 })

  // Start from a clean selection, then check only the target parts.
  await browser.execute(() => {
    document
      .querySelectorAll<HTMLInputElement>(
        '[data-part-list] [data-slot="checkbox"]',
      )
      .forEach((el) => {
        if (el.checked) el.click()
      })
  })
  for (const index of indexes) {
    const checkbox = await browser.$(
      `${S.DATA_PART_INDEX(index)} [data-slot="checkbox"]`,
    )
    // role=checkbox is a button — isSelected() is native-input-only, so
    // read aria-checked instead.
    if ((await checkbox.getAttribute('aria-checked')) !== 'true') {
      await checkbox.click()
    }
  }
  const button = await browser.$(S.HEADER_DOWNLOAD_BUTTON)
  await button.waitForClickable({ timeout: 10_000 })
  await button.click()
}

describe('queue replace semantics', () => {
  let downloadEnv: DownloadEnv | null = null

  before(async () => {
    await waitForMainUI()
    downloadEnv = await setupDownloadEnv()
    await loadFixtureVideo()

    // Baseline: download all three parts to a settled done state so the
    // matrix below always re-enqueues against SETTLED rows first.
    const button = await browser.$(S.HEADER_DOWNLOAD_BUTTON)
    await button.waitForClickable({ timeout: 10_000 })
    await button.click()
    await gotoDownloads()
    await waitForRowCount('done', 3, 120_000)
  })

  after(async () => {
    if (downloadEnv) await teardownDownloadEnv(downloadEnv)
  })

  it('re-enqueue of a DONE part appends a fresh row that starts at once, done row stays', async () => {
    await enqueueParts([0])
    await gotoDownloads()

    // The queue is idle, so the runner picks the fresh part up immediately
    // — it renders RUNNING, never pending (see runner.ts pickup design).
    await waitForRowCount('done', 3)
    await waitForRowCount('running', 1)
    await saveScreenshot('queue-replace', '00-done-append')

    // Leave the queue idle for the next test's precondition.
    await waitForIdle()
    await waitForRowCount('done', 4)
  })

  it('re-enqueue of a PENDING part replaces it in place (no new row)', async () => {
    // Part 0 RUNNING (slow media); part 1 lands PENDING behind it.
    await enqueueParts([0])
    await gotoDownloads()
    await waitForRowCount('running', 1)

    await enqueueParts([1])
    await gotoDownloads()
    await waitForRowCount('running', 1)
    await waitForRowCount('pending', 1)

    // Same part again: in-place replace — the queued count stays 1 and no
    // running part is cancelled (still exactly 1 running row).
    await enqueueParts([1])
    await gotoDownloads()
    await waitForRowCount('running', 1)
    await waitForRowCount('pending', 1)
    await saveScreenshot('queue-replace', '01-pending-in-place')

    await waitForIdle()
    await waitForRowCount('done', 6)
  })

  it('re-enqueue of a RUNNING part cancels it and appends a fresh running row', async () => {
    await enqueueParts([0])
    await gotoDownloads()
    await waitForRowCount('running', 1)

    // Old part 0 settles as cancelled; the fresh part 0 is appended and —
    // with nothing else queued — picked up as the new RUNNING row.
    await enqueueParts([0])
    await gotoDownloads()
    await waitForRowCount('cancelled', 1)
    await waitForRowCount('running', 1)
    await saveScreenshot('queue-replace', '02-running-replace')

    await waitForIdle()
    await waitForRowCount('done', 7)
  })

  it('re-enqueue of a user-CANCELLED part appends a fresh running row', async () => {
    // Cancel the running row from /downloads…
    await enqueueParts([2])
    await gotoDownloads()
    await waitForRowCount('running', 1)
    const cancel = await browser.$(S.QUEUE_ROW_CANCEL)
    await cancel.waitForClickable({ timeout: 10_000 })
    await cancel.click()
    // Nothing else is queued, so the queue goes fully idle.
    await waitForIdle()
    await waitForRowCount('cancelled', 2)
    await saveScreenshot('queue-replace', '03-cancelled-row')

    // …then re-enqueue that part: fresh row appended and started, the
    // cancelled row stays.
    await enqueueParts([2])
    await gotoDownloads()
    await waitForRowCount('running', 1)
    await waitForRowCount('cancelled', 2)
    await saveScreenshot('queue-replace', '04-cancelled-append')

    await waitForIdle()
    await waitForRowCount('done', 8)
  })

  it('leaves every matrix branch drained and settled', async () => {
    // Final invariant: no active rows, all branches terminal
    // (done=8: setup 3 + one per matrix branch; cancelled=2).
    await waitForIdle()
    await waitForRowCount('done', 8)
    await waitForRowCount('cancelled', 2)
    await saveScreenshot('queue-replace', '05-drained')
  })
})
