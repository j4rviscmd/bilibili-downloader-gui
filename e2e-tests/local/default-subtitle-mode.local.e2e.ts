/**
 * LOCAL-REAL E2E: the settings-level default subtitle mode end to end.
 *
 * Covers (against the LIVE Bilibili API + real ffmpeg, same as
 * url-download.local.e2e.ts):
 * - the settings UI toggle (off/soft/hard) and the conditional hard
 *   priority picker, persisted via patch_settings
 * - the seeded per-part subtitle config (no manual subtitle clicks) for
 *   soft and hard, each driving a real download
 * - the batch bar's mode-switch semantics (soft→hard seeds the settings
 *   priority list, hard→soft resets to all languages, a new language
 *   inserts before the wildcard fallback)
 * - the backend-side selection resolution: downloading WITHOUT opening
 *   the options accordion leaves the part's subtitles unfetched, so
 *   normalize_lan + the wildcard resolution run inside
 *   prepare_subtitle_mode against the part's own fetch
 * - restoring subtitle-free downloads after switching the default off
 *
 * Preconditions and selector conventions match url-download.local.e2e.ts:
 * real Firefox cookies (logged in), no other app instance. Every
 * selector is structural (data-testid / data-category / roles) or a
 * NATIVE language label (中文(简体), 日本語, English) — the app language
 * can be anything; no localized UI strings are matched.
 */

import { expect } from 'chai'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { ChainablePromiseElement } from 'webdriverio'
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

/** Real video with CC subtitles (same source as the soft/hard tests). */
const SUBTITLE_VIDEO_URL = 'https://www.bilibili.com/video/BV1Ng4D6XE1Q'

/** Real media floor — doubles as a mock-leak detector (suite convention). */
const MIN_REAL_MP4_BYTES = 100_000

/**
 * Loads the given real video with parts freshly seeded from the
 * CURRENT settings.
 *
 * Freshness contract (why not the plain fill+blur of url-download's
 * helper): this spec reloads the SAME video after changing the
 * settings default, and a part-list existence check passes on the
 * STALE list before the refetch reseeds — the download then enqueued
 * the PREVIOUS test's subtitle config (observed on Windows
 * 2026-10-21: hard + 8 matched lans where soft was set, T6/T7). Two
 * cooperating tricks:
 * - `variant` alternates plain ↔ `?p=1` across calls, so every refill
 *   is a genuine input VALUE change (a same-value refill fires no
 *   change event and never fetches) and the same video still loads;
 * - the wait keys on the browser URL: the page pushes a
 *   `?url=<encoded>` entry only AFTER a fetch lands and the parts are
 *   re-seeded, so matching the filled variant proves the fresh load —
 *   not the stale list — produced the visible state.
 * The video is never closed between loads: the download dock stays
 * mounted (a close→reload remount left the dock CTA at a 0×0 rect in
 * one diagnostic run, unclickable for the whole 10s wait).
 *
 * Self-healing: a sporadic API failure leaves the hero empty — the
 * whole type→blur cycle retries until the entry lands.
 */
async function loadRealVideo(url: string, variant: '' | '?p=1' = '') {
  const target = `${url}${variant}`
  const btn = await browser.$('[data-testid="nav-search"]')
  await btn.waitForExist({ timeout: 15_000 })
  await btn.click()
  const input = await browser.$(S.URL_INPUT)
  await input.waitForExist({ timeout: 10_000 })
  await browser.waitUntil(
    async () => {
      // Why: re-resolve per attempt — when the previous test already sat on
      // /search, the nav re-render replaces the input and the cached
      // element id goes stale (observed as a stale-element storm).
      const field = await browser.$(S.URL_INPUT)
      await field.click()
      await field.setValue('')
      await field.setValue(target)
      await browser.execute(() => {
        const el = document.activeElement
        if (el instanceof HTMLElement) el.blur()
      })
      await browser.pause(1_000)
      return (
        (await browser.getUrl()).includes(encodeURIComponent(target)) &&
        (await (await browser.$(S.DATA_PART_LIST)).isExisting())
      )
    },
    {
      timeout: 60_000,
      interval: 1_500,
      timeoutMsg: `video ${target} never loaded`,
    },
  )
}

/** Leaves only part 0 selected (suite convention, mirrored). */
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

/** Opens part i's options accordion, polling until verifiably open. */
async function openPartOptions(index: number): Promise<void> {
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
    { timeout: 30_000, timeoutMsg: `part ${index} options never expanded` },
  )
}

/** Subtitle mode radio inside part i's options (off/soft/hard). */
function subtitleModeRadio(index: number, mode: 'off' | 'soft' | 'hard') {
  return browser.$(
    `[data-part-index="${index}"] [id^="sub-mode-"][id$="-${mode}"]`,
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

/** Waits until the bottom bar shows no active parts (queue settled). */
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
  // Why: the unfocused E2E window freezes WKWebView timers, so react-toastify
  // auto-close never fires and stacked toasts cover the bottom-right dock
  // (the app-side autoClose default bounds them for real users). The
  // container mounts lazily with the first toast, so hide it here.
  await browser.execute(() => {
    document
      .querySelectorAll<HTMLElement>('.Toastify__toast-container')
      .forEach((c) => (c.style.display = 'none'))
  })
  const button = await browser.$(S.DOWNLOAD_DOCK_BUTTON)
  await button.waitForClickable({ timeout: 10_000 })
  await button.click()
}

/** All .mp4 files under dir, recursively. */
function listMp4s(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listMp4s(full))
    else if (entry.name.endsWith('.mp4')) out.push(full)
  }
  return out
}

/** Resolves the app-managed ffmpeg binary (mirrors ffmpeg_path_in_lib). */
async function resolveFfmpeg(): Promise<string> {
  const lib = await tauriInvoke<string>('get_current_lib_path')
  if (process.platform === 'win32') {
    return path.join(
      lib,
      'ffmpeg-master-latest-win64-gpl',
      'ffmpeg-master-latest-win64-gpl',
      'bin',
      'ffmpeg.exe',
    )
  }
  if (process.platform === 'linux') {
    return path.join(
      lib,
      'ffmpeg-master-latest-linux64-gpl',
      'ffmpeg-master-latest-linux64-gpl',
      'bin',
      'ffmpeg',
    )
  }
  return path.join(lib, 'ffmpeg', 'ffmpeg')
}

/** ffmpeg -i stream listing (exit 1 without an output is expected). */
async function probeStreams(ffmpeg: string, file: string): Promise<string> {
  const { promise, resolve } = Promise.withResolvers<string>()
  execFile(ffmpeg, ['-i', file], (_err, _stdout, stderr) =>
    resolve(stderr?.toString() ?? ''),
  )
  return promise
}

/** Reads the two settings under test from the persisted store. */
async function subtitleSettings(): Promise<{
  mode: string | undefined
  lans: string[] | undefined
}> {
  const s = await tauriInvoke<{
    defaultSubtitleMode?: string
    defaultSubtitleHardLans?: string[]
  }>('get_settings')
  return { mode: s.defaultSubtitleMode, lans: s.defaultSubtitleHardLans }
}

/** Waits until the PERSISTED default subtitle mode equals `mode`. */
async function waitForSubtitleMode(
  mode: 'off' | 'soft' | 'hard',
): Promise<void> {
  await browser.waitUntil(
    async () => (await subtitleSettings()).mode === mode,
    { timeout: 10_000, timeoutMsg: `expected persisted mode ${mode}` },
  )
}

/** Opens the settings page at the Download category (structural). */
async function openSettingsDownloadCategory(): Promise<void> {
  const btn = await browser.$('[data-testid="nav-settings"]')
  await btn.waitForExist({ timeout: 10_000 })
  await btn.click()
  const cat = await browser.$('[data-category="download"]')
  await cat.waitForExist({ timeout: 10_000 })
  await cat.click()
  await (
    await browser.$('[data-testid="setting-default-subtitle-mode"]')
  ).waitForExist({ timeout: 10_000 })
  // Let the visibility-triggered settings.json re-read (issue #560)
  // settle before any interaction: a slow read landing after a click
  // clobbers the just-saved value in the store.
  await browser.pause(1_500)
}

/**
 * Clicks segment i of the default subtitle mode (0=off 1=soft 2=hard)
 * and verifies it stuck.
 *
 * Self-healing: the settings page re-reads settings.json when it becomes
 * visible (issue #560) and a slow read can clobber a just-clicked
 * segment, so poll the segment's data-state and re-click until it holds.
 */
async function clickModeSegment(i: 0 | 1 | 2): Promise<void> {
  const segs = await browser.$$(
    '[data-testid="setting-default-subtitle-mode"] button',
  )
  expect(segs.length, 'mode toggle segments').to.equal(3)
  await browser.waitUntil(
    async () => {
      if ((await segs[i].getAttribute('data-state')) !== 'on') {
        await segs[i].click()
        await browser.pause(300)
      }
      return (await segs[i].getAttribute('data-state')) === 'on'
    },
    { timeout: 10_000, timeoutMsg: `mode segment ${i} never activated` },
  )
}

/** Waits until the hard priority picker is gone from the settings DOM. */
async function waitForPickerGone(msg: string): Promise<void> {
  await browser.waitUntil(
    async () =>
      !(await (
        await browser.$('[data-testid="setting-subtitle-hard-lans"]')
      ).isExisting()),
    { timeout: 5_000, timeoutMsg: msg },
  )
}

/**
 * Native language labels shown in the batch summary — locale-independent
 * by design (they name the content, not the UI).
 */
const NATIVE_LANGUAGE_LABELS = [
  '中文(简体)',
  '中文(繁體)',
  '日本語',
  'English',
  '한국어',
  'ไทย',
  'Tiếng Việt',
  'Bahasa Indonesia',
  'Español',
  'Русский',
]

/** True when the summary carries no explicit language pick. */
function noNativeLabel(text: string): boolean {
  return !NATIVE_LANGUAGE_LABELS.some((label) => text.includes(label))
}

/** Opens the batch subtitle dropdown (structural testid on the trigger). */
// Why: webdriverio v9 types `await browser.$()` as ChainablePromiseElement,
// which is not assignable to WebdriverIO.Element (element props like `parent`
// are Promises in v9), so the former explicit Element annotations stopped
// compiling — the return type is inferred and the helper params below use
// ChainablePromiseElement (webdriverio 9.27.0, e2e-tests/package-lock.json).
async function openBatchSubtitleMenu() {
  const trigger = await browser.$('[data-testid="batch-subtitle-trigger"]')
  await trigger.waitForExist({ timeout: 10_000 })
  const menu = await browser.$('[role="menu"]')
  // Why: self-heal — a click absorbed by a re-render leaves the menu closed,
  // and the WebDriver click never carries the pointerdown that Radix
  // DropdownMenuTrigger opens on (radix-ui/primitives#3424), so follow
  // it with the trusted keyboard-open path (ArrowDown on the trigger,
  // which the click just focused).
  await browser.waitUntil(
    async () => {
      if (!(await menu.isExisting())) {
        await trigger.click()
        await browser.keys('ArrowDown')
        await browser.pause(400)
      }
      return await menu.isExisting()
    },
    { timeout: 10_000, timeoutMsg: 'batch subtitle menu never opened' },
  )
  return { trigger, menu }
}

/** Clicks a batch mode item (off/soft/hard) inside the open menu. */
async function clickBatchMode(
  menu: ChainablePromiseElement,
  mode: 'off' | 'soft' | 'hard',
): Promise<void> {
  await (await menu.$(`[data-testid="batch-submode-${mode}"]`)).click()
}

/** Waits until the batch subtitle trigger summary matches `pred`. */
async function waitForBatchSummary(
  trigger: ChainablePromiseElement,
  pred: (text: string) => boolean,
  msg: string,
): Promise<void> {
  await browser.waitUntil(async () => pred(await trigger.getText()), {
    timeout: 10_000,
    timeoutMsg: msg,
  })
}

describe('local real API: default subtitle mode setting', () => {
  let downloadEnv: DownloadEnv | null = null
  let originalMode: string | undefined
  let originalLans: string[] | undefined

  before(async () => {
    ensureScreenshotDir()
    await browser.maximizeWindow()
    await waitForMainUI()
    const s = await subtitleSettings()
    originalMode = s.mode
    originalLans = s.lans
    downloadEnv = await setupDownloadEnv()
  })

  after(async () => {
    // Best-effort restore of the developer's real settings.json; a
    // restore failure must not mask test failures (teardown convention).
    try {
      await tauriInvoke('patch_settings', {
        patch: {
          defaultSubtitleMode: originalMode ?? null,
          defaultSubtitleHardLans: originalLans ?? null,
        },
      })
    } catch {
      /* best-effort */
    }
    if (downloadEnv) await teardownDownloadEnv(downloadEnv)
  })

  // -- Settings UI: the toggle and the conditional priority picker --

  it('switches the default subtitle mode through the settings UI', async () => {
    await openSettingsDownloadCategory()

    // off/initial → soft: persisted, picker stays hidden.
    await clickModeSegment(1)
    await waitForSubtitleMode('soft')
    await waitForPickerGone('picker should be hidden in soft mode')

    // soft → hard: the priority picker appears.
    await clickModeSegment(2)
    await waitForSubtitleMode('hard')
    await (
      await browser.$('[data-testid="setting-subtitle-hard-lans"]')
    ).waitForExist({ timeout: 5_000 })

    // hard → soft: hidden again.
    await clickModeSegment(1)
    await waitForSubtitleMode('soft')
    await waitForPickerGone(
      'picker should be hidden after switching back to soft',
    )
    await saveScreenshot('local', '20-settings-mode-toggle')
  })

  // -- Seeded soft default → real download with an embedded track --

  it('seeds the soft default and embeds tracks without manual clicks', async () => {
    await loadRealVideo(SUBTITLE_VIDEO_URL)
    await openPartOptions(0)
    const softRadio = await subtitleModeRadio(0, 'soft')
    await softRadio.waitForExist({ timeout: 30_000 })
    await browser.waitUntil(
      async () => (await softRadio.getAttribute('aria-checked')) === 'true',
      { timeout: 10_000, timeoutMsg: 'soft radio should be seeded' },
    )
    await saveScreenshot('local', '21-soft-seeded')

    const before = listMp4s(downloadEnv?.outputDir as string)
    await selectOnlyFirstPart()
    await clickDownloadDock()
    await gotoDownloadsViaBar()
    await waitForQueueIdle()

    const fresh = listMp4s(downloadEnv?.outputDir as string).filter(
      (f) => !before.includes(f),
    )
    expect(fresh.length, 'new default-soft mp4').to.equal(1)
    const ffmpeg = await resolveFfmpeg()
    const streams = await probeStreams(ffmpeg, fresh[0])
    expect(
      streams,
      'embedded subtitle stream from the default alone',
    ).to.include('Subtitle:')
    await saveScreenshot('local', '22-soft-default-done')
  })

  // -- Batch bar mode-switch semantics --

  it('switches batch modes: soft→hard seeds, hard→soft resets', async () => {
    // T2 ended on /downloads; history.back() restores the loaded
    // /search?url= entry without an API refetch (suite convention — a
    // sidebar arrival would reset the video instead).
    await browser.execute(() => window.history.back())
    await (
      await browser.$(S.DATA_PART_LIST)
    ).waitForExist({
      timeout: 15_000,
    })
    const { trigger, menu } = await openBatchSubtitleMenu()
    // Before any batch pick the trigger mirrors the settings default
    // (T1 left it on soft): the ✓ sits on the soft mode item, not off.
    await browser.waitUntil(
      async () =>
        (
          await (await menu.$('[data-testid="batch-submode-soft"]')).getText()
        ).includes('✓'),
      {
        timeout: 5_000,
        timeoutMsg: 'batch trigger should default to the settings soft mode',
      },
    )

    // Soft resets the selection to the all-languages sentinel (summary
    // carries no explicit language pick).
    await clickBatchMode(menu, 'soft')
    await waitForBatchSummary(
      trigger,
      noNativeLabel,
      'soft summary should carry no explicit language pick',
    )

    // Hard seeds the settings priority list (default: zh-Hans first).
    await clickBatchMode(menu, 'hard')
    await waitForBatchSummary(
      trigger,
      (text) => text.includes('中文(简体)'),
      'hard summary should show the seeded priority list',
    )

    // A new language is added as the next explicit priority (English
    // after Chinese; before-wildcard is pinned by the unit tests).
    await (await menu.$('span=English')).click()
    await waitForBatchSummary(
      trigger,
      (text) =>
        text.includes('English') &&
        text.indexOf('English') > text.indexOf('中文(简体)'),
      'English should become the next explicit priority',
    )

    // Back to soft: the explicit picks are dropped (reset).
    await clickBatchMode(menu, 'soft')
    await waitForBatchSummary(
      trigger,
      noNativeLabel,
      'soft summary should drop the priority list',
    )
    await browser.keys('Escape')
    await saveScreenshot('local', '23-batch-mode-switch')
  })

  // -- Custom priority list: picker insert + batch seed --

  it('renders a custom priority list and seeds the batch bar', async () => {
    // The custom list is persisted DIRECTLY (patch_settings) instead of
    // through picker clicks: the settings page re-reads settings.json on
    // visibility (issue #560) and the slow read races rapid UI-driven
    // saves, making click-driven persistence nondeterministic in E2E.
    // The insert-before-wildcard click behavior is covered by the picker
    // unit tests; here the persisted list only needs to RENDER right.
    await tauriInvoke('patch_settings', {
      patch: {
        defaultSubtitleMode: 'hard',
        defaultSubtitleHardLans: ['zh-Hans', 'ja', '*'],
      },
    })
    await browser.keys('Escape')
    await openSettingsDownloadCategory()
    // Navigating away and back made the page re-read settings.json; the
    // picker must show the custom order: zh-Hans #1, 日本語 #2, wildcard.
    const jaBox = await browser.$('#hard-lan-ja')
    await jaBox.waitForExist({ timeout: 5_000 })
    expect(
      await (await browser.$('#hard-lan-zh-Hans')).getAttribute('aria-checked'),
      'zh-Hans checked',
    ).to.equal('true')
    expect(await jaBox.getAttribute('aria-checked'), 'ja checked').to.equal(
      'true',
    )
    expect(
      await (await browser.$('#hard-lan-all')).getAttribute('aria-checked'),
      'wildcard checked',
    ).to.equal('true')
    await saveScreenshot('local', '24-custom-list-rendered')

    // The batch hard pick now seeds the custom order.
    await loadRealVideo(SUBTITLE_VIDEO_URL, '?p=1')
    const { trigger, menu } = await openBatchSubtitleMenu()
    // No batch pick yet: the trigger already shows the settings-level
    // hard default with the custom priority order (display fallback).
    await waitForBatchSummary(
      trigger,
      (text) =>
        text.includes('中文(简体)') &&
        text.indexOf('日本語') > text.indexOf('中文(简体)'),
      'batch trigger should default to the settings hard priority order',
    )
    await clickBatchMode(menu, 'hard')
    await waitForBatchSummary(
      trigger,
      (text) =>
        text.includes('中文(简体)') &&
        text.indexOf('日本語') > text.indexOf('中文(简体)'),
      'batch hard should seed the custom priority order',
    )
    await browser.keys('Escape')
  })

  // -- Seeded hard default → real burned download --

  it('downloads with the seeded hard default (custom priority)', async () => {
    // T4 leaves this very video loaded with the custom hard default
    // already seeded (its loadRealVideo ran after the patch).
    await openPartOptions(0)
    const hardRadio = await subtitleModeRadio(0, 'hard')
    await hardRadio.waitForExist({ timeout: 30_000 })
    await browser.waitUntil(
      async () => (await hardRadio.getAttribute('aria-checked')) === 'true',
      { timeout: 10_000, timeoutMsg: 'hard radio should be seeded' },
    )

    const before = listMp4s(downloadEnv?.outputDir as string)
    await selectOnlyFirstPart()
    await clickDownloadDock()
    await gotoDownloadsViaBar()
    await waitForQueueIdle()

    const fresh = listMp4s(downloadEnv?.outputDir as string).filter(
      (f) => !before.includes(f),
    )
    expect(fresh.length, 'new default-hard mp4').to.equal(1)
    expect(hasFtypHeader(fresh[0]), 'ftyp header').to.be.true
    expect(
      fs.statSync(fresh[0]).size,
      'real media size, mock leak if tiny',
    ).to.be.at.least(MIN_REAL_MP4_BYTES)
    await saveScreenshot('local', '25-hard-default-done')
  })

  // -- Backend-side resolution: accordion never opened --

  it('resolves subtitles backend-side when options stay closed', async () => {
    await openSettingsDownloadCategory()
    await clickModeSegment(1)
    await waitForSubtitleMode('soft')

    await loadRealVideo(SUBTITLE_VIDEO_URL)
    // Deliberately NOT opening the options accordion: the part's
    // subtitles are never prefetched, so the seeded selection travels to
    // the backend where normalize_lan + the wildcard resolution run
    // against the part's own fetch (the Rust reorder path).
    const before = listMp4s(downloadEnv?.outputDir as string)
    await selectOnlyFirstPart()
    await clickDownloadDock()
    await gotoDownloadsViaBar()
    await waitForQueueIdle()

    const fresh = listMp4s(downloadEnv?.outputDir as string).filter(
      (f) => !before.includes(f),
    )
    expect(fresh.length, 'new backend-resolved mp4').to.equal(1)
    const ffmpeg = await resolveFfmpeg()
    const streams = await probeStreams(ffmpeg, fresh[0])
    expect(streams, 'backend-resolved embedded subtitle stream').to.include(
      'Subtitle:',
    )
    await saveScreenshot('local', '26-backend-resolved-soft')
  })

  // -- Reversibility: off restores subtitle-free downloads --

  it('restores subtitle-free downloads after switching the default off', async () => {
    await openSettingsDownloadCategory()
    await clickModeSegment(0)
    await waitForSubtitleMode('off')

    await loadRealVideo(SUBTITLE_VIDEO_URL, '?p=1')
    const before = listMp4s(downloadEnv?.outputDir as string)
    await selectOnlyFirstPart()
    await clickDownloadDock()
    await gotoDownloadsViaBar()
    await waitForQueueIdle()

    const fresh = listMp4s(downloadEnv?.outputDir as string).filter(
      (f) => !before.includes(f),
    )
    expect(fresh.length, 'new default-off mp4').to.equal(1)
    const ffmpeg = await resolveFfmpeg()
    const streams = await probeStreams(ffmpeg, fresh[0])
    expect(streams, 'no subtitle stream with the default off').to.not.include(
      'Subtitle:',
    )
    await saveScreenshot('local', '27-off-default')
  })
})

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
