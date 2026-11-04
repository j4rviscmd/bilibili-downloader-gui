/**
 * LOCAL-REAL E2E: the batch bar's page-scoped select toggle end to end —
 * multi-page-only visibility, page-slice select/deselect, and
 * cross-page non-interference — against the LIVE Bilibili backend.
 *
 * Never runs in CI (same rationale as the other local/ specs, see
 * url-download.local.e2e.ts).
 *
 * Structural selectors only — the toggle is addressed by testid (its
 * label is the only difference from the whole-video toggle), page state
 * via [data-part-index] checkbox aria and pager digit links; never
 * localized text, because the run shares the developer's real
 * settings.json (any language).
 *
 * Tests are order-dependent by design (suite convention): the CM video
 * proves single-page absence first, then the 73-episode season drives
 * the multi-page flow.
 */

import { expect } from 'chai'

import {
  saveScreenshot,
  submitVideoUrl,
  waitForMainUI,
} from '../helpers/app.helpers'
import * as S from '../helpers/selectors'

/** Real 3-part official CM — single page, so no page toggle renders. */
const CM_VIDEO_URL = 'https://www.bilibili.com/video/BV1FV411d7u7'

/**
 * Real 41-part video (Crash Course CS bilingual; part count verified
 * via the public view API at fixture time) — 5 pages of
 * PARTS_PER_PAGE(10), the last page short (1 card); the page-scoped
 * toggle's live fixture. A bangumi season is NOT usable here: the app
 * maps only account-accessible episodes (observed: ss39947 → 3 parts
 * regardless of the season's 73 episodes).
 */
const MULTIPART_VIDEO_URL = 'https://www.bilibili.com/video/BV12XvyBtEDF'

/** PARTS_PER_PAGE — mirrors src/features/video (single source: the app
 * under test renders exactly this many cards per page). */
const PARTS_PER_PAGE = 10

/** Navigates to the URL page via the i18n-proof sidebar testid, then
 * loads the given real video (suite convention). */
async function loadRealVideo(url: string): Promise<void> {
  const btn = await browser.$('[data-testid="nav-search"]')
  await btn.waitForExist({ timeout: 15_000 })
  await btn.click()
  const input = await browser.$(S.URL_INPUT)
  await input.waitForExist({ timeout: 10_000 })
  await submitVideoUrl(url)
}

/** aria-checked state of the visible page's part checkboxes. */
async function pageCardStates(): Promise<boolean[]> {
  return browser.execute(() =>
    Array.from(
      document.querySelectorAll(
        '[data-part-list] [data-part-index] [data-slot="checkbox"]',
      ),
    ).map(
      (box) => (box as HTMLElement).getAttribute('aria-checked') === 'true',
    ),
  )
}

/** Waits until the visible page starts at part index `start` — the
 * card swap after a pager click is async (mount race, observed sibling
 * specs), so the first card's data-part-index is the page beacon. */
async function waitForPageStart(start: number): Promise<void> {
  await browser.waitUntil(
    async () => {
      const first = await browser.$('[data-part-list] [data-part-index]')
      return (await first.getAttribute('data-part-index')) === String(start)
    },
    {
      timeout: 15_000,
      timeoutMsg: `page starting at part ${start} never rendered`,
    },
  )
}

/** Clicks pager page `page` (digit link — locale-neutral numerals). */
async function clickPagerPage(page: number): Promise<void> {
  await browser.waitUntil(
    async () => {
      const links = await browser.$$(
        '[data-download-dock] [data-slot="pagination-link"]',
      )
      for (const link of links) {
        if ((await link.getText()).trim() === String(page)) {
          await link.click()
          return true
        }
      }
      return false
    },
    { timeout: 15_000, timeoutMsg: `pager link ${page} not found` },
  )
}

async function clickPageToggle(): Promise<void> {
  await (await browser.$(S.PAGE_SELECT_TOGGLE)).click()
}

function expectAll(states: boolean[], expected: boolean, what: string): void {
  expect(states, what).to.have.lengthOf(PARTS_PER_PAGE)
  expect(
    states.every((s) => s === expected),
    what,
  ).to.be.true
}

describe('local real app: batch bar page-scoped select toggle', () => {
  before(async () => {
    await waitForMainUI()
  })

  it('hides the page toggle on a single-page video', async () => {
    await loadRealVideo(CM_VIDEO_URL)
    // 3 parts < PARTS_PER_PAGE: one page, no pager, no page toggle
    await waitForPageStart(0)
    const toggle = await browser.$(S.PAGE_SELECT_TOGGLE)
    expect(await toggle.isExisting(), 'no page toggle on 3 parts').to.be.false
    await saveScreenshot('local', '10a-page-toggle-hidden')
  })

  it('selects/deselects only the visible page, leaving other pages intact', async () => {
    await loadRealVideo(MULTIPART_VIDEO_URL)
    // 41 parts: first page = exactly PARTS_PER_PAGE cards + pager
    await waitForPageStart(0)
    // Default selection is FIRST PAGE ONLY (partSelection.ts: a plain
    // URL never queues every part of a large multi-part video)
    expectAll(await pageCardStates(), true, 'page 1 selected by default')

    // Deselect page 1 only
    await clickPageToggle()
    expectAll(await pageCardStates(), false, 'page 1 deselected via toggle')

    // Page 2: deselected by default AND untouched by page 1's toggle
    await clickPagerPage(2)
    await waitForPageStart(PARTS_PER_PAGE)
    expectAll(
      await pageCardStates(),
      false,
      'page 2 deselected by default, unaffected by page 1 toggle',
    )

    // Select, then deselect, page 2 via the toggle
    await clickPageToggle()
    expectAll(await pageCardStates(), true, 'page 2 selected via toggle')
    await clickPageToggle()
    expectAll(await pageCardStates(), false, 'page 2 deselected via toggle')

    // Back on page 1: still deselected — page 2's toggles never leaked
    await clickPagerPage(1)
    await waitForPageStart(0)
    expectAll(
      await pageCardStates(),
      false,
      'page 1 unaffected by page 2 toggles',
    )
    await saveScreenshot('local', '10b-page-toggle-multipart')
  })
})
