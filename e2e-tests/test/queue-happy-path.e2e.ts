/**
 * Queue happy-path E2E (issue #691 core user routes):
 * - enqueueing shows one bottom-bar avatar per ACTIVE part
 * - the bottom bar's whole area navigates to /downloads
 * - the search page's part card carries a queue badge while the part is
 *   still active (videoId+cid scope — the /search responsibility split)
 *
 * Self-contained session: wdio launches a fresh app per spec file, so the
 * setup loads the fixture video and patches the output directory itself.
 * Requires E2E_SLOW_MEDIA=1 (parts stay active long enough to observe).
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

/** Bottom-bar avatar tiles currently rendered (thumbnails + remainder). */
async function barAvatarCount(): Promise<number> {
  return (await browser.$$('[data-queue-avatar-target] [data-slot="avatar"]'))
    .length
}

describe('queue happy paths', () => {
  let downloadEnv: DownloadEnv | null = null

  before(async () => {
    await waitForMainUI()
    downloadEnv = await setupDownloadEnv()
    await loadFixtureVideo()
  })

  after(async () => {
    if (downloadEnv) await teardownDownloadEnv(downloadEnv)
  })

  it('shows one bottom-bar avatar per active part and navigates to /downloads', async () => {
    // Enqueue all three parts: 1 running + 2 pending → 3 avatars.
    const nav = await browser.$(S.NAV_SEARCH)
    await nav.waitForExist({ timeout: 15_000 })
    await nav.click()
    const list = await browser.$(S.DATA_PART_LIST)
    await list.waitForExist({ timeout: 10_000 })

    const button = await browser.$(S.HEADER_DOWNLOAD_BUTTON)
    await button.waitForClickable({ timeout: 10_000 })
    await button.click()

    const bar = await browser.$(S.QUEUE_BOTTOM_BAR)
    await bar.waitForExist({ timeout: 10_000 })
    await browser.waitUntil(async () => (await barAvatarCount()) === 3, {
      timeout: 10_000,
      timeoutMsg: 'expected 3 active-part avatars on the bottom bar',
    })

    // The whole bar area is the navigation affordance.
    await bar.click()
    await browser.waitUntil(
      async () => {
        const rows = await browser.$$(
          '[data-status="running"], [data-status="pending"]',
        )
        return (await rows.length) > 0
      },
      {
        timeout: 10_000,
        timeoutMsg: 'expected /downloads rows after bar click',
      },
    )
    await saveScreenshot('queue-happy', '00-bar-navigates')
  })

  it('marks the search part card with a pending badge while queued', async () => {
    // Back to /search: the still-queued parts show data-status badges.
    const nav = await browser.$(S.NAV_SEARCH)
    await nav.click()
    const list = await browser.$(S.DATA_PART_LIST)
    await list.waitForExist({ timeout: 10_000 })

    await browser.waitUntil(
      async () => {
        const badges = await browser.$$(
          '[data-part-list] [data-status="pending"], [data-part-list] [data-status="running"]',
        )
        return (await badges.length) > 0
      },
      { timeout: 15_000, interval: 500 },
    )
    await saveScreenshot('queue-happy', '01-search-badges')
  })

  it('drains the queue fully after the happy-path round trip', async () => {
    // Persistent bar: drain = no active rows on /downloads.
    await browser.waitUntil(
      async () => {
        const rows = await browser.$$(
          '[data-status="pending"], [data-status="running"]',
        )
        return (await rows.length) === 0
      },
      { timeout: 120_000, interval: 500 },
    )
    await saveScreenshot('queue-happy', '02-drained')
  })
})
