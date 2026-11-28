/**
 * LOCAL-REAL E2E: the login dialog opens on the tab of the persisted login
 * method.
 *
 * wdio.local.conf.ts pins login_method=manual for this spec's session only
 * (beforeSession → afterSession). E2E_TESTING skips the encrypted session
 * read, so the instance boots logged out and both entry points — the AppBar
 * login button and the search page's login notice link — are on screen.
 * Manual is the observable method: before the fix the dialog always opened
 * on the QR tab, so a wrong tab fails here.
 *
 * Structural selectors only — the run shares the developer's real
 * settings.json (any language).
 */

import { expect } from 'chai'

import {
  navigateToUrlFetchPage,
  saveScreenshot,
  tauriInvoke,
  waitForMainUI,
} from '../helpers/app.helpers'
import * as S from '../helpers/selectors'

/** aria-selected state of one login dialog tab. */
async function isSelected(selector: string): Promise<boolean> {
  const tab = await browser.$(selector)
  return (await tab.getAttribute('aria-selected')) === 'true'
}

/** Opens the dialog through `trigger`, asserts the tab states and closes it. */
async function expectManualTab(trigger: string, shot: string): Promise<void> {
  await (await browser.$(trigger)).waitForExist({ timeout: 15_000 })
  await (await browser.$(trigger)).click()
  await (await browser.$(S.DIALOG_CONTENT)).waitForExist({ timeout: 10_000 })

  expect(await isSelected(S.LOGIN_TAB_MANUAL)).to.be.true
  expect(await isSelected(S.LOGIN_TAB_QR)).to.be.false
  expect(await isSelected(S.LOGIN_TAB_FIREFOX)).to.be.false
  await browser.pause(800)
  await saveScreenshot('login-dialog', shot)

  // shortcut: animate-ui DialogContent's close button carries no
  // data-slot, Escape stands in; label it once a spec must click it
  await browser.keys('Escape')
  await (
    await browser.$(S.DIALOG_CONTENT)
  ).waitForExist({
    timeout: 10_000,
    reverse: true,
  })
}

describe('local real app: login dialog opens on the login method', () => {
  before(async function () {
    this.timeout(180_000)
    await waitForMainUI()
  })

  it('boots logged out with the seeded manual method', async () => {
    const state = await tauriInvoke<{
      method: string
      session: unknown
    }>('get_login_state')
    expect(state.method).to.equal('manual')
    expect(state.session).to.equal(null)
  })

  it('opens on the Manual tab from the AppBar login button', async () => {
    await expectManualTab(S.APPBAR_LOGIN_BUTTON, 'appbar-login-manual-tab')
  })

  it('opens on the Manual tab from the login notice link', async () => {
    await navigateToUrlFetchPage()
    await expectManualTab(S.LOGIN_NOTICE_LINK, 'login-notice-manual-tab')
  })
})
