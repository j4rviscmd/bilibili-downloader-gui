/**
 * LOCAL-REAL E2E: live concurrency-cap changes against the LIVE bilibili
 * API/CDN. Seeds cap 1 through the Settings UI, starts the 3-part CM,
 * observes a single running part, then follows the bottom-bar
 * concurrency badge into Settings (deep link) and raises the cap to 3 —
 * the running count must grow to 3 without restarting anything.
 *
 * Shrink (non-preemptive) coverage stays in the runner unit tests:
 * externally it can only be observed as "no NEW part starts", which
 * needs leftover pending parts and is timing-flaky on the real CDN.
 *
 * Preconditions mirror the other local specs: Firefox logged in to
 * bilibili, no other app instance or dev server running (single-instance
 * makes a leftover instance absorb the launch).
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

/** The concurrency SettingToggleGroup lives inside this anchor div. */
const CONCURRENCY_SETTING = '#setting-max-concurrent-downloads'

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

/** Opens Settings on the download category via the sidebar. */
async function gotoDownloadSettings(): Promise<void> {
  const btn = await browser.$('[data-testid="nav-settings"]')
  await btn.waitForExist({ timeout: 15_000 })
  await btn.click()
  const cat = await browser.$('[data-category="download"]')
  await cat.waitForExist({ timeout: 15_000 })
  await cat.click()
  await (
    await browser.$(CONCURRENCY_SETTING)
  ).waitForExist({
    timeout: 15_000,
  })
  // Let the visibility-triggered settings.json re-read (issue #560)
  // settle before any interaction: a slow read landing after a click
  // clobbers the just-saved value in the store.
  await browser.pause(1_500)
}

async function pickConcurrency(value: number): Promise<void> {
  const option = await browser.$(
    `//*[@id="setting-max-concurrent-downloads"]//button[normalize-space()="${value}"]`,
  )
  await option.waitForClickable({ timeout: 10_000 })
  await option.click()
  // saveByForm debounces the patch_settings invoke — wait for the toggle
  // to reflect the picked value before returning.
  await browser.waitUntil(
    async () =>
      (await option.getAttribute('data-state')) === 'on' ||
      (await option.getAttribute('aria-pressed')) === 'true',
    { timeout: 10_000, timeoutMsg: `concurrency option ${value} never on` },
  )
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

/** Current count of /downloads rows in the given status. */
async function rowCount(status: string): Promise<number> {
  return (await browser.$$(S.QUEUE_ROW_BY_STATUS(status))).length
}

/** Waits until the running-row count reaches n (timeout = drained). */
async function waitForRunning(n: number, timeoutMsg: string): Promise<boolean> {
  return browser.waitUntil(
    async () => {
      const running = await rowCount('running')
      if (running >= n) return true
      // Drained without ever reaching n — let waitUntil fail on timeout.
      return false
    },
    { timeout: 120_000, interval: 500, timeoutMsg },
  )
}

/** Waits until the persistent bottom bar shows no active parts. */
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

describe('local real API: live concurrency cap changes', () => {
  let env: DownloadEnv

  before(async () => {
    env = await setupDownloadEnv()
    await waitForMainUI()
  })

  after(async () => {
    await teardownDownloadEnv(env)
  })

  it('grows the running count live when the cap is raised mid-download', async () => {
    // Seed cap 1 through the real Settings UI before enqueueing.
    await gotoDownloadSettings()
    await pickConcurrency(1)

    // Load the 3-part CM (all parts selected by default) and start.
    await loadRealVideo(CM_VIDEO_URL)
    const dock = await browser.$(S.DOWNLOAD_DOCK_BUTTON)
    await dock.waitForClickable({ timeout: 10_000 })
    await dock.click()

    // Cap 1: exactly one part runs while others stay pending. `pending
    // >= 1` (not 2): a fast first part legitimately promotes the next
    // one, and demanding two pending would flake on quick CDNs.
    await gotoDownloadsViaBar()
    expect(await waitForRunning(1, 'expected 1 running part at cap 1')).to.be
      .true
    expect(await rowCount('pending')).to.be.at.least(1)

    // Follow the bottom-bar badge into Settings — the deep link target
    // must be the concurrency row, and the badge must show the live cap.
    const badge = await browser.$('[data-testid="concurrency-link"]')
    await badge.waitForExist({ timeout: 10_000 })
    expect(await badge.getText()).to.contain('1')
    await badge.click()
    await (
      await browser.$(CONCURRENCY_SETTING)
    ).waitForExist({
      timeout: 15_000,
    })

    // Raise the cap to 3 — running downloads pick it up immediately.
    // `>= 2` (not 3): parts finished at cap 1 shrink what is left to
    // observe; the live-apply signal is the running count GROWING past
    // the single slot, however many parts remain.
    await pickConcurrency(3)
    await gotoDownloadsViaBar()
    expect(
      await waitForRunning(2, 'expected ≥2 running parts after raising cap'),
    ).to.be.true

    await waitForQueueIdle()
  })
})
