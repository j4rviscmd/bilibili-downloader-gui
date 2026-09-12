/**
 * E2E tests for bilibili-downloader-gui.
 *
 * Covers the core user flow:
 * - App launch from uninitialized state
 * - Initialization sequence (settings, ffmpeg, cookies)
 * - Navigation to /home
 * - Sidebar verification
 * - Settings dialog open/close
 * - Video URL input and info fetch (backend serves a bundled fixture
 *   under E2E_TESTING — CI runner IPs are blocked by Bilibili, issue
 *   #565; see e2e_mock_video_info in src-tauri/src/handlers/bilibili.rs)
 * - Video part cards display
 * - Phase 4: full download pipeline through a localhost fixture server
 *   (E2E_API_BASE) — playurl fetch, segment download, and a REAL ffmpeg
 *   merge of committed MP4 fixtures (see e2e-tests/helpers/fixture-server.ts)
 */

import { expect } from 'chai'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  ensureScreenshotDir,
  saveScreenshot,
  tauriInvoke,
  waitForMainUI,
  waitForUrlInput,
} from '../helpers/app.helpers'
import * as S from '../helpers/selectors'

/**
 * URL submitted through the URL input form.
 *
 * Under E2E_TESTING the backend answers fetch_video_info with a
 * bundled fixture regardless of the video ID, so any valid URL shape
 * works; this matches the fixture video — the official bilibili CM
 * "bilibili献给新一代的演讲《后浪》" (3 parts) — so what renders on
 * screen corresponds to the URL (issue #565).
 */
const TEST_VIDEO_URL = 'https://www.bilibili.com/video/BV1FV411d7u7'

/**
 * End-to-end test suite for the bilibili-downloader-gui application.
 *
 * Executes a sequential, phase-based happy path through the app:
 * Phase 0 - App launch and initialization sequence
 * Phase 1 - Home page UI verification (URL input, alerts, sidebar)
 * Phase 2 - Settings dialog interactions (currently skipped, see notes)
 * Phase 3 - Real video info fetch and part card rendering
 * Phase 4 - Full download pipeline: click through REAL ffmpeg merge to
 *           completed UI + merged files on disk (localhost fixture server
 *           via E2E_API_BASE; media fixtures are committed MP4s)
 *
 * Tests within this suite are order-dependent; each `it` builds on state
 * established by the previous one (e.g. video info loaded in Phase 3
 * is reused by subsequent assertions).
 */
describe('bilibili-downloader-gui E2E', () => {
  /**
   * Suite-level setup executed once before any test runs.
   *
   * Ensures the screenshot output directory exists and maximizes the
   * browser window so responsive layout assertions are stable.
   */
  before(() => {
    ensureScreenshotDir()
    browser.maximizeWindow()
  })

  // -- Phase 0: App Launch & Initialization --

  // NOTE: Skipped because in E2E mode (E2E_TESTING) the app launches directly
  // into the main window without a standalone splash window. This works around
  // tauri-plugin-webdriver v0.2 not switching the WebDriver session when the
  // splash window is closed. The splash UI itself is covered by manual
  // verification and component-level checks.
  it.skip('should show splash screen on launch', async () => {
    const container = await browser.$(S.INIT_CONTAINER)
    await container.waitForExist({ timeout: 15_000 })

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

    const alertTitle = await browser.$(S.LOGIN_ALERT_TITLE)
    expect(await alertTitle.isExisting()).to.be.true

    await saveScreenshot('launch', '03-login-alert')
  })

  it('should display sidebar navigation items', async () => {
    // Sidebar footer exists (contains download history +
    // settings). Wait for it since sidebar renders async.
    const footer = await browser.$(S.SIDEBAR_FOOTER)
    await footer.waitForExist({ timeout: 10_000 })

    // Verify at least one menu button in footer
    const menuButtons = await footer.$$('[data-slot="sidebar-menu-button"]')
    expect(menuButtons.length).to.be.greaterThan(0)

    await saveScreenshot('launch', '04-sidebar')
  })

  // -- Phase 2: Settings Dialog --

  // NOTE: Both dialog tests are skipped due to tauri-webdriver + WebKit
  // limitations in CI environment. The dialog open/close mechanism does not
  // propagate reliably to Radix UI's handlers in the GitHub Actions macOS runner.
  //
  // These tests work correctly in manual testing and local development.
  // See the "should close settings dialog" test for more details on attempted fixes.
  //
  // Related issue: https://github.com/j4rviscmd/bilibili-downloader-gui/pull/367
  it.skip('should open settings dialog from sidebar', async () => {
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

    const title = await browser.$(S.DIALOG_TITLE)
    expect(await title.isExisting()).to.be.true

    await saveScreenshot('settings', '00-dialog-open')
  })

  // NOTE: This test is consistently skipped due to tauri-webdriver + WebKit
  // limitations in CI environment. The dialog close mechanism (Escape key,
  // X button click, overlay click, JavaScript event dispatch) does not
  // propagate reliably to Radix UI's handlers in the GitHub Actions macOS runner.
  //
  // The following approaches have all been tried without success:
  // 1. browser.keys('Escape') - keyboard event not received by Radix
  // 2. dialog.$('button').click() - button click not registered
  // 3. overlay.click() - outside click not detected
  // 4. document.dispatchEvent(new KeyboardEvent(...)) - event ignored
  //
  // This appears to be a fundamental limitation of the tauri-webdriver +
  // WebKit combination in GitHub Actions. The dialog works correctly in
  // manual testing and local development environments.
  //
  // Related issue: https://github.com/j4rviscmd/bilibili-downloader-gui/pull/367
  it.skip('should close settings dialog', async () => {
    await browser.keys('Escape')

    const dialog = await browser.$(S.DIALOG_CONTENT)
    await dialog.waitForExist({
      timeout: 5_000,
      reverse: true,
    })

    await saveScreenshot('settings', '01-dialog-closed')
  })

  // -- Phase 3: Video URL Input & Info Fetch (E2E fixture response) --

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
    // Under E2E_TESTING the backend answers fetch_video_info with
    // a bundled fixture (Bilibili blocks CI runner IPs, issue #565).
    await browser.execute(() => {
      const el = document.activeElement
      if (el instanceof HTMLElement) el.blur()
    })

    // Wait for part list to appear (indicates parts loaded)
    const partList = await browser.$(S.DATA_PART_LIST)
    await partList.waitForExist({ timeout: 30_000 })

    await saveScreenshot('video', '01-info-loaded')
  })

  it('should display video part cards', async () => {
    const firstPart = await browser.$(S.DATA_PART_INDEX(0))
    expect(await firstPart.isExisting()).to.be.true

    // Fixture provides three parts; all should render
    const secondPart = await browser.$(S.DATA_PART_INDEX(1))
    expect(await secondPart.isExisting()).to.be.true
    const thirdPart = await browser.$(S.DATA_PART_INDEX(2))
    expect(await thirdPart.isExisting()).to.be.true

    await saveScreenshot('video', '02-part-cards')
  })

  it('should show download button (enabled - all parts auto-selected)', async () => {
    const downloadBtn = await browser.$(S.DOWNLOAD_BUTTON)
    expect(await downloadBtn.isExisting()).to.be.true

    // Parts are auto-selected on video load, so button is enabled
    expect(await downloadBtn.isEnabled()).to.be.true

    await saveScreenshot('video', '03-download-enabled')
  })

  // -- Phase 4: Download Pipeline (fixture server + real ffmpeg merge) --

  // Output directory patched via patch_settings; kept suite-scoped so the
  // final file assertions read the same path.
  let downloadOutputDir = ''

  // Pre-patch dlOutputPath and history ids, restored in the suite teardown:
  // dev and E2E share one app_data_dir (same bundle identifier), so without
  // restoration every post-E2E manual download lands in a temp dir and the
  // fixture entries stay in the developer's history.
  let originalDlOutputPath: string | null = null
  let originalHistoryIds: string[] = []

  after(async () => {
    if (!downloadOutputDir) return
    // Restore the developer's output path (null = back to the OS default).
    await tauriInvoke('patch_settings', {
      patch: { dlOutputPath: originalDlOutputPath },
    }).catch(() => {
      // Best-effort: a settings failure must not mask test failures.
    })
    // Remove only the history entries this run created.
    const history = await tauriInvoke<Array<{ id: string }>>(
      'get_history',
      {},
    ).catch(() => [] as Array<{ id: string }>)
    for (const entry of history) {
      if (!originalHistoryIds.includes(entry.id)) {
        await tauriInvoke('remove_history_entry', { id: entry.id }).catch(
          () => undefined,
        )
      }
    }
    fs.rmSync(downloadOutputDir, { recursive: true, force: true })
  })

  it('should patch the download output directory to a fresh temp dir', async () => {
    const settings = await tauriInvoke<{ dlOutputPath?: string | null }>(
      'get_settings',
    )
    originalDlOutputPath = settings.dlOutputPath ?? null
    const history = await tauriInvoke<Array<{ id: string }>>('get_history')
    originalHistoryIds = history.map((e) => e.id)

    downloadOutputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-e2e-dl-'))
    // patch_settings validates the path exists and is a directory, so a
    // resolve here proves the backend accepted it.
    await tauriInvoke('patch_settings', {
      patch: { dlOutputPath: downloadOutputDir },
    })
  })

  it('should start the download session when Download is clicked', async () => {
    // Header instance — two DownloadButtons render (header + footer) but run
    // the same download() handler; scoping avoids the ambiguous selector.
    const btn = await browser.$(S.HEADER_DOWNLOAD_BUTTON)
    await btn.waitForClickable({ timeout: 10_000 })
    await btn.click()

    // Session-active proof: the status bar exists exactly while downloads
    // are in flight (AnimatedSection unmounts it once settled).
    const bar = await browser.$(S.DOWNLOAD_STATUS_BAR)
    await bar.waitForExist({ timeout: 30_000 })

    await saveScreenshot('download', '00-session-started')
  })

  it('should complete all three parts (real ffmpeg merge) and dismiss the status bar', async () => {
    // Session settle: the status bar unmounts when everything is done.
    // NOTE: not asserting the mid-session compact "done" row — localhost
    // fixtures finish a part in well under a second, so that DOM window is
    // a race by design (see the session-start screenshot instead).
    const bar = await browser.$(S.DOWNLOAD_STATUS_BAR)
    await bar.waitForExist({ timeout: 90_000, reverse: true })

    // Durable terminal signal: the full-card complete blocks persist after
    // the compact rows revert (compact rows unmount on settle by design).
    await browser.waitUntil(
      async () => {
        const blocks = await browser.$$(S.PART_COMPLETE)
        // ElementArray.length is typed Promise<number> in wdio v9
        return (await blocks.length) === 3
      },
      {
        timeout: 30_000,
        interval: 500,
        timeoutMsg: 'expected 3 completed-part indicators',
      },
    )

    await saveScreenshot('download', '02-all-complete')
  })

  it('should write the three merged mp4 files to the output directory', async () => {
    const files = fs
      .readdirSync(downloadOutputDir)
      .filter((f) => f.endsWith('.mp4'))
    expect(files.length).to.equal(3)

    for (const f of files) {
      const filePath = path.join(downloadOutputDir, f)
      const fd = fs.openSync(filePath, 'r')
      const head = Buffer.alloc(8)
      fs.readSync(fd, head, 0, 8, 0)
      fs.closeSync(fd)
      // MP4 magic: bytes 4-8 are "ftyp" (both fixtures are +faststart).
      expect(
        head.subarray(4, 8).toString('ascii'),
        `${f} is not a valid MP4`,
      ).to.equal('ftyp')
      expect(fs.statSync(filePath).size).to.be.greaterThan(1024)
    }

    await saveScreenshot('download', '03-files-verified')
  })
})
