/**
 * Queue replace-semantics E2E (issue #691).
 *
 * Runs after app-launch.e2e in the same session: the fixture video's 3
 * parts are loaded on /search and the initial download session has fully
 * settled (done). Requires E2E_SLOW_MEDIA=1 so a part stays observably
 * RUNNING (~5s/stream) while later parts sit PENDING — the branch matrix
 * below is state-driven, never timing-driven.
 *
 * Branch matrix (enqueue while…):
 * - a SETTLED (done) part   → appends a fresh queued row, done row stays
 * - a PENDING part          → replaced IN PLACE, row count unchanged
 * - a RUNNING part          → old row cancelled, fresh row appended
 * - a user-CANCELLED part   → appends a fresh queued row, cancelled stays
 */
import { browser } from '@wdio/globals'
import { saveScreenshot, waitForMainUI } from '../helpers/app.helpers'
import * as S from '../helpers/selectors'

/** Waits until the /downloads page shows exactly `n` rows in a status. */
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

/** Navigates to /search, checks exactly the given part indexes, downloads. */
async function enqueueParts(indexes: number[]) {
  // Wait for the sidebar button before clicking: the previous spec may
  // have left the app mid-animation or on another page.
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
  before(async () => {
    await waitForMainUI()
  })

  it('re-enqueue of a DONE part appends a queued row and keeps the done row', async () => {
    await enqueueParts([0])

    const bar = await browser.$(S.QUEUE_BOTTOM_BAR)
    await bar.waitForExist({ timeout: 10_000 })
    // done rows: 3 from the app-launch session; queued: 1 fresh.
    await waitForRowCount('done', 3)
    await waitForRowCount('pending', 1)
    await saveScreenshot('queue-replace', '00-done-append')
  })

  it('re-enqueue of a PENDING part replaces it in place (no new row)', async () => {
    // Part 0 is RUNNING (slow media); part 1 lands PENDING behind it.
    await enqueueParts([1])
    await waitForRowCount('running', 1)
    await waitForRowCount('pending', 1)

    // Same part again: in-place replace — the queued count stays 1 and no
    // running part is cancelled (still exactly 1 running row).
    await enqueueParts([1])
    await waitForRowCount('running', 1)
    await waitForRowCount('pending', 1)
    await saveScreenshot('queue-replace', '01-pending-in-place')
  })

  it('re-enqueue of a RUNNING part cancels it and appends a fresh row', async () => {
    await enqueueParts([0])

    // Old part 0 settles as cancelled; the fresh part 0 queues at the tail.
    await waitForRowCount('cancelled', 1)
    await waitForRowCount('running', 0)
    await waitForRowCount('pending', 2)
    await saveScreenshot('queue-replace', '02-running-replace')
  })

  it('re-enqueue of a user-CANCELLED part appends a fresh queued row', async () => {
    // Cancel one queued row from /downloads…
    const cancel = await browser.$(S.QUEUE_ROW_CANCEL)
    await cancel.waitForClickable({ timeout: 10_000 })
    await cancel.click()
    await waitForRowCount('pending', 1)
    await waitForRowCount('cancelled', 2)
    await saveScreenshot('queue-replace', '03-cancelled-row')

    // …then re-enqueue that part: fresh queued row, cancelled row stays.
    await enqueueParts([2])
    await waitForRowCount('pending', 2)
    await waitForRowCount('cancelled', 2)
    await saveScreenshot('queue-replace', '04-cancelled-append')
  })

  it('drains to completion with finished entries accumulating', async () => {
    // The bottom bar persists while the queue holds items — drain is
    // asserted via zero active rows, not via the bar hiding.
    await waitForRowCount('pending', 0, 120_000)
    await waitForRowCount('running', 0, 120_000)
    await saveScreenshot('queue-replace', '05-drained')
  })
})
