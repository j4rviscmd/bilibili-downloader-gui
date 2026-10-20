/**
 * LOCAL-REAL E2E: the URL-fetch → download route against the LIVE
 * Bilibili backend (real cookies from the Firefox profile, real WBI
 * signing, real playurl/CDN segments, real ffmpeg merge).
 *
 * Never runs in CI: bilibili risk-controls CI runner IPs (issue #565),
 * and these specs require a logged-in Firefox profile. wdio.local.conf
 * runs them via `npm run test:local`; the CI workflow runs wdio.conf.ts
 * whose test-directory spec glob never matches local/.
 *
 * Structural selectors only — never match on localized aria-labels or
 * visible text, because this run shares the developer's real
 * settings.json (any language).
 *
 * Tests are order-dependent by design (same convention as
 * test/app-launch.e2e.ts): each it() builds on the state the previous
 * one established.
 */

import { expect } from 'chai'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import {
  ensureScreenshotDir,
  saveScreenshot,
  setupDownloadEnv,
  submitVideoUrl,
  tauriInvoke,
  teardownDownloadEnv,
  waitForMainUI,
  type DownloadEnv,
} from '../helpers/app.helpers'
import * as S from '../helpers/selectors'

/** Real 3-part official CM (the fixture snapshot's source video). */
const CM_VIDEO_URL = 'https://www.bilibili.com/video/BV1FV411d7u7'

/** Real video with CC subtitles (soft/hard subtitle tests). */
const SUBTITLE_VIDEO_URL = 'https://www.bilibili.com/video/BV1Ng4D6XE1Q'

/** Real b23.tv short link (resolves to the subtitle video above). */
const SHORT_VIDEO_URL = 'https://b23.tv/D6XE1Q'

/** Real bangumi episode URL (dispatches to the bangumi info API). */
const BANGUMI_URL = 'https://www.bilibili.com/bangumi/play/ep742222'

/** Season (ss) form of the same bangumi — exercises the season→episode
 * resolution path. */
const BANGUMI_SEASON_URL = 'https://www.bilibili.com/bangumi/play/ss39947'

/**
 * Real CDN segments are far larger than the committed fixture media
 * (a few KB), so this threshold doubles as a mock-leak detector: if the
 * E2E fixture pipeline ever serves this spec, the size assert fails.
 */
const MIN_REAL_MP4_BYTES = 100_000

/**
 * Navigates to the URL page via the i18n-proof sidebar testid, then
 * loads the given real video.
 */
async function loadRealVideo(url: string): Promise<void> {
  const btn = await browser.$('[data-testid="nav-search"]')
  await btn.waitForExist({ timeout: 15_000 })
  await btn.click()
  const input = await browser.$(S.URL_INPUT)
  await input.waitForExist({ timeout: 10_000 })
  await submitVideoUrl(url)
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
  // accordion then stays closed and its subtitle/quality fetches never
  // fire — observed 2026-10-19). Poll aria-expanded and re-click until
  // the accordion is verifiably open.
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

/** Subtitle mode radio inside part i's options (off/soft/hard).
 * Lockstep selector for the three mode tests. */
function subtitleModeRadio(index: number, mode: 'off' | 'soft' | 'hard') {
  return browser.$(
    `[data-part-index="${index}"] [id^="sub-mode-"][id$="-${mode}"]`,
  )
}

/** Waits until /downloads shows at least n rows in the given status. */
async function waitForRows(
  status: string,
  n: number,
  timeout = 300_000,
): Promise<void> {
  await browser.waitUntil(
    async () => {
      const rows = await browser.$$(S.QUEUE_ROW_BY_STATUS(status))
      return (await rows.length) >= n
    },
    { timeout, interval: 1_000, timeoutMsg: `expected ${n} ${status} rows` },
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

/** Resolves the app-managed ffmpeg binary (mirrors ffmpeg_path_in_lib
 * in src-tauri/src/utils/paths.rs). */
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

/** ffmpeg -i stream listing (exit code 1 without an output file is
 * expected — only the stderr text matters). */
async function probeStreams(ffmpeg: string, file: string): Promise<string> {
  const { promise, resolve } = Promise.withResolvers<string>()
  execFile(ffmpeg, ['-i', file], (_err, _stdout, stderr) =>
    resolve(stderr?.toString() ?? ''),
  )
  return promise
}

/** Bilibili video-quality id → maximum expected stream height. The
 * quality test picks the lowest AVAILABLE id at runtime and asserts the
 * merged file's height stays within its cap — proving the selection
 * reached the real playurl download. */
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

/** Width/height of the first video stream in ffmpeg -i output. */
async function videoDimensions(
  ffmpeg: string,
  file: string,
): Promise<{ width: number; height: number }> {
  const stderr = await probeStreams(ffmpeg, file)
  const line = stderr.split('\n').find((l) => l.includes('Video:'))
  const dims = line?.match(/(\d{2,5})x(\d{2,5})/)
  if (!line || !dims) {
    throw new Error(
      `no video dimensions in ffmpeg output:\n${line ?? '(none)'}`,
    )
  }
  return { width: Number(dims[1]), height: Number(dims[2]) }
}

/** Picks and clicks the lowest AVAILABLE video-quality radio of a part
 * (unavailable qualities render disabled) and returns its id. */
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
  await (await browser.$(`${scope} #vq-${index + 1}-${lowest}`)).click()
  return lowest
}

describe('local real API: URL fetch to download', () => {
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
    expect(user.data.uname).to.be.a('string').and.to.have.lengthOf.at.least(1)
    await saveScreenshot('local', '00-boot-loggedin')
  })

  // -- Phase 1: URL fetch via the real view API --

  it('rejects an invalid URL without fetching', async () => {
    const btn = await browser.$('[data-testid="nav-search"]')
    await btn.waitForExist({ timeout: 15_000 })
    await btn.click()
    const input = await browser.$(S.URL_INPUT)
    await input.waitForExist({ timeout: 10_000 })
    await input.click()
    await input.setValue('definitely-not-a-bilibili-url')
    await browser.execute(() => {
      const el = document.activeElement
      if (el instanceof HTMLElement) el.blur()
    })
    // Give a real fetch ample time to have started, then require that
    // validation gated it: no part list, form still in place.
    await browser.pause(3_000)
    expect(await (await browser.$(S.DATA_PART_LIST)).isExisting()).to.be.false
    expect(await input.isExisting()).to.be.true
    await saveScreenshot('local', '00b-invalid-url')
  })

  it('loads real video info for the CM URL', async () => {
    await loadRealVideo(CM_VIDEO_URL)
    const cards = await browser.$$('[data-part-list] [data-part-index]')
    expect(cards.length, 'part card count').to.equal(3)
    const firstCardText = await cards[0].getText()
    expect(
      firstCardText.trim(),
      'part card text (title)',
    ).to.have.lengthOf.at.least(1)
    const thumbSrc = await cards[0].$('img').getAttribute('src')
    expect(thumbSrc ?? '', 'real CDN thumbnail').to.include('hdslb.com')
    await saveScreenshot('local', '01-cm-parts')
  })

  it('toggles per-part selection', async () => {
    const card3box = browser.$(`${S.DATA_PART_INDEX(2)} [data-slot="checkbox"]`)
    await browser.execute(() => {
      const card = document.querySelector<HTMLElement>(
        '[data-part-list] [data-part-index="2"]',
      )
      const box = card?.querySelector<HTMLElement>('[data-slot="checkbox"]')
      if (box?.getAttribute('aria-checked') === 'true') box.click()
    })
    await browser.waitUntil(
      async () => (await card3box.getAttribute('aria-checked')) === 'false',
      { timeout: 5_000, timeoutMsg: 'expected part 3 deselected' },
    )
    await browser.execute(() => {
      const card = document.querySelector<HTMLElement>(
        '[data-part-list] [data-part-index="2"]',
      )
      const box = card?.querySelector<HTMLElement>('[data-slot="checkbox"]')
      if (box?.getAttribute('aria-checked') === 'false') box.click()
    })
    await browser.waitUntil(
      async () => (await card3box.getAttribute('aria-checked')) === 'true',
      { timeout: 5_000, timeoutMsg: 'expected part 3 reselected' },
    )
  })

  // -- Phase 2: real download pipeline (playurl → CDN → ffmpeg merge) --

  it('enqueues all three parts and navigates to the queue', async () => {
    await clickDownloadDock()

    const bar = await browser.$(S.QUEUE_BOTTOM_BAR)
    await bar.waitForExist({ timeout: 15_000 })
    await browser.waitUntil(
      async () => {
        const avatars = await browser.$$(
          `${S.QUEUE_BOTTOM_BAR} [data-slot="avatar"]`,
        )
        return (await avatars.length) === 3
      },
      { timeout: 15_000, timeoutMsg: 'expected 3 bottom-bar avatars' },
    )
    await bar.click()
    await waitForRows('pending', 1, 15_000).catch(() => undefined)
    await saveScreenshot('local', '02-enqueued')
  })

  it('drains the real download queue to done', async () => {
    await waitForRows('done', 3)
    await saveScreenshot('local', '03-drained')
  })

  it('writes three real merged mp4 files', async () => {
    const files = listMp4s(downloadEnv?.outputDir as string)
    expect(files.length, 'merged mp4 count').to.equal(3)
    for (const file of files) {
      expect(hasFtypHeader(file), `ftyp header (${file})`).to.be.true
      expect(
        fs.statSync(file).size,
        `real media size, mock leak if tiny (${file})`,
      ).to.be.at.least(MIN_REAL_MP4_BYTES)
    }
    // All parts of one video land together in a single folder under the
    // output dir (video-title directory convention).
    const folders = new Set(files.map((f) => path.dirname(f)))
    expect(folders.size, 'one output folder per video').to.equal(1)
    expect(
      path.relative(downloadEnv?.outputDir as string, files[0]).split(path.sep)
        .length,
      'output depth (folder/file)',
    ).to.be.at.most(2)
  })

  it('settles the queue bottom bar to idle', async () => {
    // The bar is persistent by design: it unmounts only on a fully empty
    // queue (see QueueBottomBar). Idle signal = still mounted (settled
    // summary) with no active-part avatars left.
    const bar = await browser.$(S.QUEUE_BOTTOM_BAR)
    await bar.waitForExist({ timeout: 10_000 })
    await browser.waitUntil(
      async () => {
        const avatars = await browser.$$(
          `${S.QUEUE_BOTTOM_BAR} [data-slot="avatar"]`,
        )
        return (await avatars.length) === 0
      },
      {
        timeout: 30_000,
        timeoutMsg: 'expected no active-part avatars after the drain',
      },
    )
    await saveScreenshot('local', '03b-bar-settled')
  })

  it('records real download history entries', async () => {
    const history = await tauriInvoke<Array<{ id: string }>>('get_history')
    const fresh = history.filter(
      (e) => !downloadEnv?.originalHistoryIds.includes(e.id),
    )
    expect(fresh.length, 'new history entries').to.be.at.least(3)
  })

  // -- Phase 2b: quality selection + URL variants --

  it('downloads at the selected video quality (real playurl param)', async () => {
    // history.back() restores the CM's loaded entry (queue-replace's
    // pattern) so the options can be set without retyping the URL.
    await browser.execute(() => window.history.back())
    const list = await browser.$(S.DATA_PART_LIST)
    await list.waitForExist({ timeout: 15_000 })

    await openPartOptions(0)
    const qualityId = await selectLowestVideoQuality(0)
    const maxHeight = VQ_MAX_HEIGHT[qualityId]

    const before = listMp4s(downloadEnv?.outputDir as string)
    await selectOnlyFirstPart()
    await clickDownloadDock()
    await gotoDownloadsViaBar()
    // Cumulative: 3 (CM) + 1 (this quality-selected part)
    await waitForQueueIdle()

    const fresh = listMp4s(downloadEnv?.outputDir as string).filter(
      (f) => !before.includes(f),
    )
    expect(fresh.length, 'new quality-selected mp4').to.equal(1)
    const ffmpeg = await resolveFfmpeg()
    const dims = await videoDimensions(ffmpeg, fresh[0])
    expect(
      dims.height,
      `stream height for quality id ${qualityId}`,
    ).to.be.at.most(maxHeight)
    await saveScreenshot('local', '07-quality-done')
  })

  it('loads a video through a ?p= URL variant', async () => {
    await loadRealVideo(`${CM_VIDEO_URL}?p=2`)
    const cards = await browser.$$('[data-part-list] [data-part-index]')
    expect(cards.length, 'part card count via ?p= URL').to.equal(3)
    await saveScreenshot('local', '08-p-param-url')
  })

  it('expands a b23.tv short URL and loads the video', async () => {
    await loadRealVideo(SHORT_VIDEO_URL)
    const cards = await browser.$$('[data-part-list] [data-part-index]')
    expect(cards.length, 'part cards via short URL').to.be.at.least(1)
    const thumbSrc = await cards[0].$('img').getAttribute('src')
    expect(thumbSrc ?? '', 'real CDN thumbnail').to.include('hdslb.com')
    await saveScreenshot('local', '09-short-url')
  })

  it('loads bangumi episode info via an ep URL', async () => {
    await loadRealVideo(BANGUMI_URL)
    const cards = await browser.$$('[data-part-list] [data-part-index]')
    expect(cards.length, 'episode cards via ep URL').to.be.at.least(1)
    const text = await cards[0].getText()
    expect(text.trim(), 'episode card text').to.have.lengthOf.at.least(1)
    await saveScreenshot('local', '09b-bangumi')
  })

  it('loads the season list via an ss URL', async () => {
    await loadRealVideo(BANGUMI_SEASON_URL)
    const cards = await browser.$$('[data-part-list] [data-part-index]')
    expect(cards.length, 'episode cards via ss URL').to.be.at.least(1)
    const text = await cards[0].getText()
    expect(text.trim(), 'episode card text').to.have.lengthOf.at.least(1)
    await saveScreenshot('local', '09c-season-url')
  })

  // -- Phase 3: real subtitle list + soft/hard embedding --

  it('exposes the real subtitle list for a subtitled video', async () => {
    await loadRealVideo(SUBTITLE_VIDEO_URL)
    await openPartOptions(0)
    // SubtitleSection renders mode radios only when the real subtitle
    // list (player/wbi/v2 via fetch_subtitles_for_part) is non-empty.
    await (await subtitleModeRadio(0, 'off')).waitForExist({ timeout: 30_000 })
    await saveScreenshot('local', '04-subtitle-list')
  })

  it('embeds a soft subtitle track (real ffmpeg mux)', async () => {
    const softRadio = await subtitleModeRadio(0, 'soft')
    await softRadio.waitForExist({ timeout: 10_000 })
    await softRadio.click()
    // Soft mode defaults to every available language selected.

    const before = listMp4s(downloadEnv?.outputDir as string)
    await selectOnlyFirstPart()
    await clickDownloadDock()
    await gotoDownloadsViaBar()
    // Cumulative: 4 (CM + quality part) + 1 (this soft-sub part)
    await waitForQueueIdle()

    const fresh = listMp4s(downloadEnv?.outputDir as string).filter(
      (f) => !before.includes(f),
    )
    expect(fresh.length, 'new soft-sub mp4').to.equal(1)
    const ffmpeg = await resolveFfmpeg()
    const streams = await probeStreams(ffmpeg, fresh[0])
    expect(streams, 'embedded subtitle stream in ffmpeg -i output').to.include(
      'Subtitle:',
    )
    await saveScreenshot('local', '05-soft-done')
  })

  it('burns a hard subtitle into the output (real ffmpeg filter)', async () => {
    // history.back() restores the ?url= entry and the loaded video
    // snapshot (sidebar arrival would reset it — issue #691).
    await browser.execute(() => window.history.back())
    const list = await browser.$(S.DATA_PART_LIST)
    await list.waitForExist({ timeout: 15_000 })

    await openPartOptions(0)
    const hardRadio = await subtitleModeRadio(0, 'hard')
    await hardRadio.waitForExist({ timeout: 10_000 })
    await hardRadio.click()
    // Pick the first language radio of the hard group.
    const firstHardLang = await browser.$(
      '[data-part-index="0"] [id^="sub-hard-"]',
    )
    await firstHardLang.waitForExist({ timeout: 10_000 })
    await firstHardLang.click()

    const before = listMp4s(downloadEnv?.outputDir as string)
    await selectOnlyFirstPart()
    await clickDownloadDock()
    await gotoDownloadsViaBar()
    // Cumulative: 5 + 1 (this hard-sub part)
    await waitForQueueIdle()

    const fresh = listMp4s(downloadEnv?.outputDir as string).filter(
      (f) => !before.includes(f),
    )
    expect(fresh.length, 'new hard-sub mp4').to.equal(1)
    expect(hasFtypHeader(fresh[0]), 'ftyp header').to.be.true
    expect(fs.statSync(fresh[0]).size).to.be.at.least(MIN_REAL_MP4_BYTES)
    await saveScreenshot('local', '06-hard-done')
  })

  it('downloads a bangumi episode end to end', async () => {
    // Exercises the bangumi branch of the real pipeline: playurl with
    // area/session cookies, segment download and merge. The episode is
    // chosen by the run (first card) — the suite is local-only for this
    // account, so availability is a stable precondition like login.
    await loadRealVideo(BANGUMI_URL)
    const before = listMp4s(downloadEnv?.outputDir as string)
    await selectOnlyFirstPart()
    await clickDownloadDock()
    await gotoDownloadsViaBar()
    await waitForQueueIdle()

    const fresh = listMp4s(downloadEnv?.outputDir as string).filter(
      (f) => !before.includes(f),
    )
    expect(fresh.length, 'new bangumi episode mp4').to.equal(1)
    expect(hasFtypHeader(fresh[0]), 'ftyp header').to.be.true
    expect(fs.statSync(fresh[0]).size).to.be.at.least(MIN_REAL_MP4_BYTES)
    await saveScreenshot('local', '11-bangumi-dl')
  })

  it('refetches a recent URL from the hero list', async () => {
    // The URL page's recent list derives from real download history
    // (grouped per video); one click must reload the video without
    // retyping the URL.
    const btn = await browser.$('[data-testid="nav-search"]')
    await btn.waitForExist({ timeout: 15_000 })
    await btn.click()
    // Since #862 the sidebar returns to the last active /search?url=
    // entry, so the loaded video reappears instead of the hero. Close
    // it via the compact bar's x (pushes the bare entry) to reach the
    // video-free hero whose recent list this test exercises.
    const close = await browser.$('[data-testid="clear-url"]')
    await close.waitForExist({ timeout: 10_000 })
    await close.click()
    const recent = await browser.$('[data-recent-urls]')
    await recent.waitForExist({ timeout: 15_000 })
    const rows = await recent.$$('button[data-url]')
    expect(rows.length, 'recent URL rows (CM + subtitle video)').to.be.at.least(
      2,
    )
    const cmRow = await browser.$(
      '[data-recent-urls] button[data-url*="BV1FV411d7u7"]',
    )
    await cmRow.waitForExist({ timeout: 10_000 })
    await cmRow.click()
    const list = await browser.$(S.DATA_PART_LIST)
    await list.waitForExist({ timeout: 30_000 })
    await saveScreenshot('local', '10-refetch')
  })

  it('returns to popular via back after selecting a recommended video', async () => {
    // The pending-download navigation must push exactly ONE history
    // entry: /popular → /search?url=… . The old two-push flow (empty
    // hero first, ?url= on landing) made back land on the empty URL
    // page instead of the feed (reported 2026-10-19).
    const popular = await browser.$('[data-testid="nav-popular"]')
    await popular.waitForExist({ timeout: 15_000 })
    await popular.click()
    const grid = await browser.$('[data-testid="video-card-grid"]')
    await grid.waitForExist({ timeout: 30_000 })

    const firstCard = await browser.$(
      '[data-testid="video-card-grid"] li button',
    )
    await firstCard.waitForExist({ timeout: 10_000 })
    await firstCard.click()
    const list = await browser.$(S.DATA_PART_LIST)
    await list.waitForExist({ timeout: 30_000 })
    expect(await browser.getUrl()).to.include('/search?url=')

    const back = await browser.$('[data-testid="history-back"]')
    await back.waitForExist({ timeout: 10_000 })
    await back.click()
    await browser.waitUntil(
      async () => (await browser.getUrl()).includes('/popular'),
      { timeout: 10_000, timeoutMsg: 'expected back to return to /popular' },
    )
    await saveScreenshot('local', '12-popular-back')
  })
})
