/**
 * LOCAL-REAL E2E: parallel part downloads against the LIVE bilibili
 * API/CDN. Enqueues the real 3-part CM with the default cap (2) and
 * asserts at least two parts run simultaneously, then the queue fully
 * settles.
 *
 * Preconditions mirror the other local specs (see wdio.local.conf.ts):
 * Firefox logged in to bilibili (real cookies) and no other app instance
 * or dev server running — REQUIRED now that single-instance is enabled:
 * a leftover instance makes this launched instance exit immediately.
 */

import { expect } from 'chai'

import {
  setupDownloadEnv,
  submitVideoUrl,
  teardownDownloadEnv,
  waitForMainUI,
  type DownloadEnv,
} from '../helpers/app.helpers'
import * as S from '../helpers/selectors'

/** Real 3-part official CM (the fixture snapshot's source video). */
const CM_VIDEO_URL = 'https://www.bilibili.com/video/BV1FV411d7u7'

/** Navigates to the URL page via the i18n-proof sidebar testid, then
 * loads the given real video. */
async function loadRealVideo(url: string): Promise<void> {
  const btn = await browser.$('[data-testid="nav-search"]')
  await btn.waitForExist({ timeout: 15_000 })
  await btn.click()
  const input = await browser.$(S.URL_INPUT)
  await input.waitForExist({ timeout: 10_000 })
  await submitVideoUrl(url)
}

/** Clicks the download dock button once it becomes clickable. */
async function clickDownloadDock(): Promise<void> {
  const button = await browser.$(S.DOWNLOAD_DOCK_BUTTON)
  await button.waitForClickable({ timeout: 10_000 })
  await button.click()
}

/** Navigates via the queue bottom bar (structural, i18n-proof). */
async function gotoDownloadsViaBar(): Promise<void> {
  const bar = await browser.$(S.QUEUE_BOTTOM_BAR)
  await bar.waitForExist({ timeout: 15_000 })
  await bar.click()
  await browser.waitUntil(
    async () => {
      const rows = await browser.$$(
        '[data-status="running"], [data-status="pending"], [data-status="done"]',
      )
      return (await rows.length) > 0
    },
    { timeout: 15_000, timeoutMsg: 'expected queue rows after bar click' },
  )
}

/** Waits until the persistent bottom bar shows no active parts — the
 * whole queue has settled. */
async function waitForQueueIdle(): Promise<void> {
  await browser.waitUntil(
    async () => {
      const avatars = await browser.$$(
        `${S.QUEUE_BOTTOM_BAR} [data-slot="avatar"]`,
      )
      return (await avatars.length) === 0
    },
    {
      timeout: 300_000,
      interval: 1_000,
      timeoutMsg: 'expected the queue to go idle (no active avatars)',
    },
  )
}

describe('local real API: parallel part downloads', () => {
  let env: DownloadEnv

  before(async () => {
    env = await setupDownloadEnv()
    await waitForMainUI()
  })

  after(async () => {
    await teardownDownloadEnv(env)
  })

  it('downloads the 3-part CM with at least 2 parts in flight at once', async () => {
    // All 3 parts are selected by default on load.
    await loadRealVideo(CM_VIDEO_URL)
    await clickDownloadDock()
    await gotoDownloadsViaBar()

    // Sample row statuses while the queue drains. The merge stage keeps
    // each part 'running' for seconds, so 500 ms polling reliably
    // observes the overlap window of the default cap (2).
    let peak = 0
    await browser.waitUntil(
      async () => {
        const running = await browser.$$(S.QUEUE_ROW_BY_STATUS('running'))
        peak = Math.max(peak, await running.length)
        if (peak >= 2) return true
        // Stop condition: nothing active anymore.
        const pending = await browser.$$(S.QUEUE_ROW_BY_STATUS('pending'))
        return (await pending.length) === 0 && (await running.length) === 0
      },
      {
        timeout: 300_000,
        interval: 500,
        timeoutMsg: 'expected at least 2 simultaneously running parts',
      },
    )

    expect(peak).to.be.at.least(2)
    await waitForQueueIdle()
  })
})
