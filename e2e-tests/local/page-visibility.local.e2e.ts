/**
 * LOCAL-REAL E2E: page-visibility toggles end to end — sidebar filtering,
 * emptied-group hiding, and settings.json persistence via patch_settings.
 *
 * The disabled-path redirect (+toast) and unmount-on-disable memory
 * reclaim are covered by unit tests
 * (src/shared/layout/PersistentPageLayout.test.tsx): every in-app link
 * to a hideable page carries localized text, so no structural selector
 * can drive that path here.
 *
 * Structural selectors only — the run shares the developer's real
 * settings.json (any language), so asserts use testids, switch ids, and
 * get_settings, never localized text.
 */

import { expect } from 'chai'

import {
  saveScreenshot,
  tauriInvoke,
  waitForMainUI,
} from '../helpers/app.helpers'

/** i18n-proof sidebar testids (the registry entries that carry one). */
const NAV_POPULAR = '[data-testid="nav-popular"]'
const NAV_SEARCH = '[data-testid="nav-search"]'
const NAV_DOWNLOADS = '[data-testid="nav-downloads"]'
const NAV_HISTORY = '[data-testid="nav-history"]'

/** App-bar settings button (structural). */
const NAV_SETTINGS = '[data-testid="nav-settings"]'

/** Page-visibility switch ids (GeneralSection: page-visibility-<key>). */
const HISTORY_SWITCH = '#page-visibility-history[role="switch"]'

/** All six tool-page switches (the only sidebar group with no required
 * member — hiding all six proves the group label drops out too). */
const TOOL_SWITCHES = [
  '#page-visibility-trim[role="switch"]',
  '#page-visibility-concat[role="switch"]',
  '#page-visibility-audio[role="switch"]',
  '#page-visibility-resolution[role="switch"]',
  '#page-visibility-rotation[role="switch"]',
  '#page-visibility-gif[role="switch"]',
]

/** Reads the persisted disabledPages list. */
async function disabledPages(): Promise<string[]> {
  const settings = await tauriInvoke<{ disabledPages?: string[] }>(
    'get_settings',
  )
  return settings.disabledPages ?? []
}

/** Waits until the persisted list contains exactly `keys`. */
async function waitForDisabledPages(keys: string[]): Promise<void> {
  await browser.waitUntil(
    async () => {
      const current = await disabledPages()
      return (
        current.length === keys.length && keys.every((k) => current.includes(k))
      )
    },
    { timeout: 15_000, timeoutMsg: `disabledPages never became [${keys}]` },
  )
}

/** Opens Settings on the General category (structural). */
async function gotoGeneralSettings(): Promise<void> {
  const btn = await browser.$(NAV_SETTINGS)
  await btn.waitForExist({ timeout: 15_000 })
  await btn.click()
  const cat = await browser.$('[data-category="general"]')
  await cat.waitForExist({ timeout: 15_000 })
  await cat.click()
  await (await browser.$(HISTORY_SWITCH)).waitForExist({ timeout: 15_000 })
  // Let the visibility-triggered settings.json re-read (issue #560)
  // settle before any interaction: a slow read landing after a click
  // clobbers the just-saved value in the store.
  await browser.pause(1_500)
}

/** Clicks a switch until its aria-checked reaches `on`. */
async function setSwitch(selector: string, on: boolean): Promise<void> {
  const sw = await browser.$(selector)
  const isOn = async () => (await sw.getAttribute('aria-checked')) === 'true'
  if ((await isOn()) === on) return
  await sw.click()
  await browser.waitUntil(async () => (await isOn()) === on, {
    timeout: 10_000,
    timeoutMsg: `${selector} never became ${on ? 'on' : 'off'}`,
  })
}

describe('local real app: page-visibility toggles', () => {
  before(async function () {
    this.timeout(180_000)
    await waitForMainUI()
  })

  it('boots with every testid nav item and an empty disabledPages', async () => {
    for (const sel of [NAV_POPULAR, NAV_SEARCH, NAV_DOWNLOADS, NAV_HISTORY]) {
      await (await browser.$(sel)).waitForExist({ timeout: 15_000 })
    }
    expect(await disabledPages()).to.deep.equal([])
  })

  it('hiding download history drops its nav item and persists', async () => {
    await gotoGeneralSettings()
    await setSwitch(HISTORY_SWITCH, false)

    await waitForDisabledPages(['/history'])
    await (
      await browser.$(NAV_HISTORY)
    ).waitForExist({
      timeout: 10_000,
      reverse: true,
    })
    // Required pages never drop out of the sidebar.
    expect(await (await browser.$(NAV_SEARCH)).isExisting()).to.be.true
    expect(await (await browser.$(NAV_DOWNLOADS)).isExisting()).to.be.true
    await saveScreenshot('page-visibility', 'history-hidden')
  })

  it('re-enabling restores the nav item and persists', async () => {
    await setSwitch(HISTORY_SWITCH, true)
    await waitForDisabledPages([])
    await (await browser.$(NAV_HISTORY)).waitForExist({ timeout: 10_000 })
  })

  it('hiding every tool page drops the whole group and persists', async () => {
    for (const sel of TOOL_SWITCHES) await setSwitch(sel, false)
    await waitForDisabledPages([
      '/trim',
      '/concat',
      '/audio',
      '/resolution',
      '/rotation',
      '/gif',
    ])
    // Core groups stay reachable while the tool group is fully gone.
    expect(await (await browser.$(NAV_SEARCH)).isExisting()).to.be.true
    expect(await (await browser.$(NAV_DOWNLOADS)).isExisting()).to.be.true
    await saveScreenshot('page-visibility', 'tool-group-hidden')

    // Suite convention: leave the real settings.json as found.
    for (const sel of TOOL_SWITCHES) await setSwitch(sel, true)
    await waitForDisabledPages([])
  })
})
