/**
 * LOCAL-REAL E2E: the keyword-search discovery route against the LIVE
 * Bilibili backend — the popular page's search box → /video-search
 * results → a result card's download setup → one finished merged file.
 * The highest-frequency user flow the suite did not cover yet (URL
 * entry is covered by url-download.local.e2e.ts).
 *
 * Never runs in CI: bilibili risk-controls CI runner IPs (issue #565),
 * and the download half requires a logged-in Firefox profile.
 * wdio.local.conf runs this via `npm run test:local`; the CI glob never
 * matches local/.
 *
 * Structural selectors only — never match on localized aria-labels or
 * visible text, because this run shares the developer's real
 * settings.json (any language).
 *
 * Tests are order-dependent by design (same convention as
 * url-download.local.e2e.ts): each it() builds on the state the
 * previous one established.
 *
 * The downloaded card is picked at runtime — the first result whose
 * duration chip stays under MAX_PICK_SECONDS, at the lowest available
 * video quality — bounding the real CDN transfer regardless of ranking
 * churn.
 */

import { expect } from 'chai'
import fs from 'node:fs'
import path from 'node:path'

import {
  ensureScreenshotDir,
  saveScreenshot,
  setupDownloadEnv,
  tauriInvoke,
  teardownDownloadEnv,
  waitForMainUI,
  type DownloadEnv,
} from '../helpers/app.helpers'
import * as S from '../helpers/selectors'

/** Evergreen keyword — the real search API always returns results. */
const SEARCH_KEYWORD = 'ffmpeg'

/**
 * Real CDN segments are far larger than the committed fixture media
 * (a few KB), so this threshold doubles as a mock-leak detector: if the
 * E2E fixture pipeline ever serves this spec, the size assert fails.
 */
const MIN_REAL_MP4_BYTES = 100_000

/** Duration cap (seconds) for the result card picked for the download
 * loop — keeps the real transfer bounded against ranking churn. */
const MAX_PICK_SECONDS = 600

/** Bilibili video-quality id → maximum expected stream height (used
 * only to validate the quality ids; mirrors url-download's map). */
const VQ_MAX_HEIGHT: Record<string, number> = {
  '16': 360,
  '32': 480,
  '64': 720,
  '74': 720,
  '80': 1080,
  '112': 1080,
  '120': 2160,
  '125': 2160,
  '126': 2160,
  '127': 4320,
}

/** Navigates to the popular feed via the i18n-proof sidebar testid. */
async function gotoPopular(): Promise<void> {
  const btn = await browser.$('[data-testid="nav-popular"]')
  await btn.waitForExist({ timeout: 15_000 })
  await btn.click()
}

/** Types a keyword into the header search box and submits via the form's
 * submit button. Why not Enter: WKWebView's WebDriver did not turn a
 * synthesized Enter into form submission (observed 2026-10-24: the draft
 * was set, no navigation) — the suite is click-first for the same reason
 * submitVideoUrl avoids key events. */
async function submitKeywordSearch(keyword: string): Promise<void> {
  const input = await browser.$('input[role="combobox"]')
  await input.waitForExist({ timeout: 15_000 })
  await input.click()
  await input.setValue(keyword)
  // The button stays disabled until the draft is non-empty, so waiting
  // for clickability also proves the typed keyword reached the
  // controlled input.
  const submit = await (await input.$('..')).$('button[type="submit"]')
  await submit.waitForClickable({ timeout: 10_000 })
  await submit.click()
}

/**
 * Waits until the VISIBLE results grid shows at least n cards and
 * returns it. The persistent layout keeps /popular mounted
 * (display:none) after the hand-off to /video-search, so its hidden
 * grid matches the same testid — visibility filtering is mandatory.
 * Skeleton grids carry no testid, so existence ⇒ real results.
 */
async function waitForDisplayedCards(
  n: number,
  timeout = 30_000,
): Promise<WebdriverIO.Element> {
  return browser.waitUntil(
    async () => {
      const grids = await browser.$$('[data-testid="video-card-grid"]')
      for (const grid of grids) {
        if (!(await grid.isDisplayed())) continue
        const cards = await grid.$$('li')
        if ((await cards.length) >= n) return grid
      }
      return undefined as unknown as WebdriverIO.Element
    },
    {
      timeout,
      interval: 500,
      timeoutMsg: `expected ${n} displayed search-result cards`,
    },
  )
}

/**
 * Clicks the first result card whose duration chip fits
 * MAX_PICK_SECONDS and returns the card title (aria-label). Runs in
 * the page so the pick and the click are one atomic step against
 * re-renders. Structure: card button = each li's FIRST button (the
 * sibling preview button is second); the m:ss/h:mm:ss chip is the only
 * span inside the thumbnail box (button > span > span).
 */
async function openShortResultCard(): Promise<string> {
  return browser.execute((maxSeconds: number) => {
    const grid = [
      ...document.querySelectorAll<HTMLElement>(
        '[data-testid="video-card-grid"]',
      ),
    ].find((g) => g.offsetParent !== null)
    if (!grid) throw new Error('no visible card grid')
    const cardBtns = [
      ...grid.querySelectorAll<HTMLElement>('li > button:first-of-type'),
    ]
    if (!cardBtns.length) throw new Error('no result cards')
    const seconds = (btn: HTMLElement): number | null => {
      const chip = btn.querySelector(':scope > span > span')
      const parts = (chip?.textContent ?? '').trim().split(':').map(Number)
      if (parts.some((v) => Number.isNaN(v))) return null
      return parts.reduce((acc, v) => acc * 60 + v, 0)
    }
    const pick =
      cardBtns.find((btn) => {
        const s = seconds(btn)
        return s !== null && s <= maxSeconds
      }) ?? cardBtns[0]
    const title = pick.getAttribute('aria-label') ?? ''
    pick.click()
    return title
  }, MAX_PICK_SECONDS)
}

/**
 * Leaves only part 0 selected. The selection checkbox is the FIRST
 * checkbox inside a card — subtitle-language checkboxes render later,
 * inside the expanded options accordion.
 */
async function selectOnlyFirstPart(): Promise<void> {
  await browser.execute(() => {
    document
      .querySelectorAll<HTMLElement>('[data-part-list] [data-part-index]')
      .forEach((card, index) => {
        const box = card.querySelector<HTMLElement>('[data-slot="checkbox"]')
        if (!box) return
        const want = index === 0
        const has = box.getAttribute('aria-checked') === 'true'
        if (want !== has) box.click()
      })
  })
}

/** Opens part i's per-part options accordion (idempotent). */
async function openPartOptions(index: number): Promise<void> {
  // Self-healing against the mount race: a click fired while the fresh
  // page is still swapping cards can be absorbed by the re-render (the
  // accordion then stays closed and its quality fetches never fire).
  // Poll aria-expanded and re-click until verifiably open.
  const card = `[data-part-index="${index}"]`
  const toggle = await browser.$(`${card} button[aria-expanded]`)
  await toggle.waitForExist({ timeout: 10_000 })
  await browser.waitUntil(
    async () => {
      const state = await toggle.getAttribute('aria-expanded')
      if (state === 'true') return true
      await toggle.click()
      await browser.pause(500)
      return false
    },
    { timeout: 15_000, timeoutMsg: `part ${index} options never expanded` },
  )
}

/** Picks and clicks the lowest AVAILABLE video-quality radio of a part
 * (unavailable qualities render disabled) — bounds the real CDN
 * transfer for the runtime-picked result card. */
async function selectLowestVideoQuality(index: number): Promise<string> {
  const scope = `[data-part-index="${index}"]`
  // Radios only render once the real per-part quality fetch resolves
  // (the options accordion shows a loading skeleton until then).
  await (
    await browser.$(`${scope} [id^="vq-"]`)
  ).waitForExist({ timeout: 30_000 })
  let lowest: string | null = null
  for (const radio of await browser.$$(`${scope} [id^="vq-"]`)) {
    const id = (await radio.getAttribute('id')) ?? ''
    const qualityId = id.split('-').pop() ?? ''
    if (!VQ_MAX_HEIGHT[qualityId]) continue
    const disabled =
      (await radio.getAttribute('disabled')) !== null ||
      (await radio.getAttribute('aria-disabled')) === 'true'
    if (disabled) continue
    if (lowest === null || Number(qualityId) < Number(lowest)) {
      lowest = qualityId
    }
  }
  if (lowest === null) throw new Error('no available video-quality radio')
  // Why: the radio id is 1-based — the app renders `vq-${page}` with
  // page = data-part-index + 1 (src/pages/search/index.tsx) — while this
  // spec scopes selectors by the 0-based data-part-index attribute.
  await (await browser.$(`${scope} #vq-${index + 1}-${lowest}`)).click()
  return lowest
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
 * whole queue (including this test's enqueue) has settled. Robust to
 * whatever earlier tests downloaded, unlike absolute done-row counts. */
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

/** Clicks the download dock button once it becomes clickable. */
async function clickDownloadDock(): Promise<void> {
  const button = await browser.$(S.DOWNLOAD_DOCK_BUTTON)
  await button.waitForClickable({ timeout: 10_000 })
  await button.click()
}

/** All .mp4 files under dir, recursively (merged outputs live in
 * per-video subdirectories of the output dir). */
function listMp4s(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listMp4s(full))
    else if (entry.name.endsWith('.mp4')) out.push(full)
  }
  return out
}

/** True when the file starts with an MP4 ftyp box. */
function hasFtypHeader(file: string): boolean {
  const fd = fs.openSync(file, 'r')
  try {
    const buf = Buffer.alloc(12)
    fs.readSync(fd, buf, 0, 12, 0)
    return buf.subarray(4, 8).toString('ascii') === 'ftyp'
  } finally {
    fs.closeSync(fd)
  }
}

describe('local real API: keyword search to download', () => {
  let downloadEnv: DownloadEnv | null = null

  before(async () => {
    ensureScreenshotDir()
    await browser.maximizeWindow()
    await waitForMainUI()
    downloadEnv = await setupDownloadEnv()
  })

  after(async () => {
    if (downloadEnv) await teardownDownloadEnv(downloadEnv)
  })

  // -- Phase 0: fail-fast preconditions --

  it('boots with a logged-in real session', async () => {
    // fetch_user returns the raw bilibili envelope: { data: { isLogin, uname } }
    const user = await tauriInvoke<{
      data: { isLogin: boolean; uname?: string }
    }>('fetch_user')
    expect(
      user.data.isLogin,
      'Real Firefox cookies are not logged in (expired or logged out). ' +
        'Log in to bilibili.com in Firefox, then rerun.',
    ).to.be.true
    expect(user.data.uname).to.a('string').and.to.have.lengthOf.at.least(1)
  })

  // -- Phase 1: real search API from the popular page's search box --

  it('returns real results for a keyword search', async () => {
    await gotoPopular()
    await submitKeywordSearch(SEARCH_KEYWORD)

    await browser.waitUntil(
      async () => (await browser.getUrl()).includes('/video-search?q='),
      {
        timeout: 15_000,
        timeoutMsg: 'expected navigation to /video-search?q=',
      },
    )
    const grid = await waitForDisplayedCards(1)
    const cards = await grid.$$('li')
    expect(cards.length, 'search result cards').to.be.at.least(1)
    // Real covers come from the CDN — a mock leak would serve the
    // fixture origin instead.
    const thumbSrc = await (await grid.$('li button img')).getAttribute('src')
    expect(thumbSrc ?? '', 'real CDN cover').to.include('hdslb.com')
    await saveScreenshot('local', 'vs-01-search-results')
  })

  // -- Phase 2: result card → download setup (usePendingDownload) --

  it('opens a search result card in download setup', async () => {
    const title = await openShortResultCard()
    expect(title, 'picked card title (aria-label)').to.have.lengthOf.at.least(1)

    // Note: a search card opens the SAME /search?url= download-setup route
    // as manual URL entry (url-download.local.e2e.ts asserts the same URL).
    expect(await browser.getUrl()).to.include('/search?url=')
    const list = await browser.$(S.DATA_PART_LIST)
    await list.waitForExist({ timeout: 30_000 })
    const cards = await browser.$$('[data-part-list] [data-part-index]')
    expect(cards.length, 'part cards for the searched video').to.be.at.least(1)
    await saveScreenshot('local', 'vs-02-opened')
  })

  // -- Phase 3: the search → download loop (playurl → CDN → ffmpeg) --

  it('downloads the searched video part end to end', async () => {
    await openPartOptions(0)
    await selectLowestVideoQuality(0)

    const before = listMp4s(downloadEnv?.outputDir as string)
    await selectOnlyFirstPart()
    await clickDownloadDock()
    await gotoDownloadsViaBar()
    await waitForQueueIdle()

    const fresh = listMp4s(downloadEnv?.outputDir as string).filter(
      (f) => !before.includes(f),
    )
    expect(fresh.length, 'new search-origin mp4').to.equal(1)
    expect(hasFtypHeader(fresh[0]), 'ftyp header').to.be.true
    expect(
      fs.statSync(fresh[0]).size,
      'real media size, mock leak if tiny',
    ).to.be.at.least(MIN_REAL_MP4_BYTES)
    await saveScreenshot('local', 'vs-03-download-done')
  })
})
