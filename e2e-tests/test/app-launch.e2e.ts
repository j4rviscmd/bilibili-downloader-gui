/**
 * E2E tests for bilibili-downloader-gui.
 *
 * Covers the core user flow:
 * - App launch from uninitialized state
 * - Initialization sequence (settings, ffmpeg, cookies)
 * - Navigation to /home
 * - Sidebar verification
 * - Settings dialog open/close
 * - Video URL input and info fetch (real API)
 * - Video part cards display
 */

import { expect } from 'chai'

import {
  ensureScreenshotDir,
  saveScreenshot,
  waitForMainUI,
  waitForUrlInput,
} from '../helpers/app.helpers'
import * as S from '../helpers/selectors'

// A stable, well-known Bilibili official video for testing
const TEST_VIDEO_URL = 'https://www.bilibili.com/video/BV1i3411y7xB'

describe('bilibili-downloader-gui E2E', () => {
  before(() => {
    ensureScreenshotDir()
    browser.maximizeWindow()
  })

  // -- Phase 0: App Launch & Initialization --

  it('should show initialization page on launch', async () => {
    const container = await browser.$(S.INIT_CONTAINER)
    await container.waitForExist({ timeout: 15_000 })

    const spinner = await browser.$(S.INIT_SPINNER)
    expect(await spinner.isExisting()).to.be.true

    const statusText = await browser.$(S.INIT_STATUS_TEXT)
    expect(await statusText.isExisting()).to.be.true

    await saveScreenshot('launch', '00-init-page')
  })

  it('should complete initialization and navigate to home', async () => {
    await waitForMainUI()

    const currentUrl = await browser.getUrl()
    expect(currentUrl).to.include('/home')

    await saveScreenshot('launch', '01-home-loaded')
  })

  // -- Phase 1: Home Page UI Verification --

  it('should display the URL input form (Step 1)', async () => {
    await waitForUrlInput()

    const input = await browser.$(S.URL_INPUT)
    expect(await input.isExisting()).to.be.true
    expect(await input.isClickable()).to.be.true

    const step1Title = await browser.$(S.STEP1_CARD_TITLE)
    expect(await step1Title.isExisting()).to.be.true

    await saveScreenshot('launch', '02-step1-form')
  })

  it('should show login benefits alert when not logged in', async () => {
    const alert = await browser.$(S.LOGIN_ALERT)
    await alert.waitForExist({ timeout: 10_000 })

    expect(await alert.isExisting()).to.be.true

    const alertTitle = await browser.$(S.LOGIN_ALERT_TITLE)
    expect(await alertTitle.isExisting()).to.be.true

    await saveScreenshot('launch', '03-login-alert')
  })

  it('should display sidebar navigation items', async () => {
    // Sidebar footer exists (contains download history +
    // settings). Wait for it since sidebar renders async.
    const footer = await browser.$(S.SIDEBAR_FOOTER)
    await footer.waitForExist({ timeout: 10_000 })
    expect(await footer.isExisting()).to.be.true

    // Verify at least one menu button in footer
    const menuButtons = await footer.$$('[data-slot="sidebar-menu-button"]')
    expect(menuButtons.length).to.be.greaterThan(0)

    await saveScreenshot('launch', '04-sidebar')
  })

  // -- Phase 2: Settings Dialog --

  it('should open settings dialog from sidebar', async () => {
    // Sidebar is collapsed, so click the second menu button
    // in the footer (settings button)
    const footer = await browser.$(S.SIDEBAR_FOOTER)
    const menuButtons = await footer.$$('[data-slot="sidebar-menu-button"]')
    // Second button in footer is settings
    const settingsBtn = menuButtons[1]
    expect(settingsBtn).to.exist
    await settingsBtn.click()

    // Wait for dialog to appear
    const dialog = await browser.$(S.DIALOG_CONTENT)
    await dialog.waitForExist({ timeout: 10_000 })
    expect(await dialog.isExisting()).to.be.true

    const title = await browser.$(S.DIALOG_TITLE)
    expect(await title.isExisting()).to.be.true

    await saveScreenshot('settings', '00-dialog-open')
  })

  it('should close settings dialog', async () => {
    await browser.keys('Escape')

    const dialog = await browser.$(S.DIALOG_CONTENT)
    await dialog.waitForExist({
      timeout: 5_000,
      reverse: true,
    })
    expect(await dialog.isExisting()).to.be.false

    await saveScreenshot('settings', '01-dialog-closed')
  })

  // -- Phase 3: Video URL Input & Info Fetch (Real API) --

  it('should accept a video URL in the input field', async () => {
    const input = await browser.$(S.URL_INPUT)
    await input.click()
    await input.setValue(TEST_VIDEO_URL)

    const value = await input.getValue()
    expect(value).to.equal(TEST_VIDEO_URL)

    await saveScreenshot('video', '00-url-entered')
  })

  it('should fetch and display video info after form submission', async () => {
    // The form submits on blur (handleFormBlur in VideoForm1).
    // WKWebView's WebDriver doesn't propagate focus changes on
    // click, so we explicitly blur the active element via JS.
    await browser.execute(() => {
      const el = document.activeElement
      if (el instanceof HTMLElement) el.blur()
    })

    // Wait for part list to appear (indicates parts loaded)
    const partList = await browser.$(S.DATA_PART_LIST)
    await partList.waitForExist({ timeout: 30_000 })
    expect(await partList.isExisting()).to.be.true

    await saveScreenshot('video', '01-info-loaded')
  })

  it('should display video part cards', async () => {
    const firstPart = await browser.$(S.DATA_PART_INDEX(0))
    expect(await firstPart.isExisting()).to.be.true

    await saveScreenshot('video', '02-part-cards')
  })

  it('should show download button (enabled - all parts auto-selected)', async () => {
    const downloadBtn = await browser.$(S.DOWNLOAD_BUTTON)
    expect(await downloadBtn.isExisting()).to.be.true

    // Parts are auto-selected on video load, so button is enabled
    expect(await downloadBtn.isEnabled()).to.be.true

    await saveScreenshot('video', '03-download-enabled')
  })
})
