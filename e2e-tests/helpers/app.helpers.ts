/**
 * App-lifecycle helpers shared across E2E test files.
 *
 * Handles screenshot management, UI readiness detection,
 * Tauri invoke wrapping, and element state polling.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as S from './selectors'

/**
 * Fixture video URL submitted through the URL input form.
 *
 * Under E2E_TESTING the backend answers fetch_video_info with a bundled
 * fixture regardless of the video ID, so any valid URL shape works; this
 * matches the fixture video — the official bilibili CM with 3 parts — so
 * what renders on screen corresponds to the URL (issue #565).
 */
export const FIXTURE_VIDEO_URL = 'https://www.bilibili.com/video/BV1FV411d7u7'

/** Resolved path to the base `screenshots/` directory. */
const baseScreenshotDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'screenshots',
)

/**
 * Ensure the screenshot directory exists.
 *
 * Creates the directory at `screenshots/{subdir}` (or the base
 * `screenshots/` directory when no subdirectory is specified) if it
 * does not already exist.
 *
 * @param subdir - Optional subdirectory name for categorizing screenshots
 * @returns The absolute path to the created (or existing) directory
 */
export function ensureScreenshotDir(subdir?: string): string {
  const dir = subdir ? path.join(baseScreenshotDir, subdir) : baseScreenshotDir
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Save a screenshot to `screenshots/{category}/{name}.png`.
 *
 * Captures the current browser viewport and writes the PNG file
 * to disk. The file is overwritten if it already exists.
 *
 * @param category - Subdirectory under `screenshots/` (e.g. `"launch"`, `"settings"`)
 * @param name     - Filename without extension (e.g. `"00-init-page"`)
 *
 * @example
 * ```typescript
 * await saveScreenshot('launch', '00-init-page')
 * // writes to screenshots/launch/00-init-page.png
 * ```
 */
export async function saveScreenshot(
  category: string,
  name: string,
): Promise<void> {
  const dir = ensureScreenshotDir(category)
  const filePath = path.join(dir, `${name}.png`)
  const data = await browser.takeScreenshot()
  fs.writeFileSync(filePath, Buffer.from(data, 'base64'))
  console.log(`Screenshot saved: ${filePath}`)
}

/**
 * Wait for the main UI (sidebar) to be visible after
 * init completes. Timeout: 180s (init downloads ffmpeg on
 * every CI run — runners are disposable — and the Windows
 * BtbN zip is ~100MB).
 *
 * Polls the DOM every 500 ms until a `[data-slot="sidebar"]`
 * element is found, or the 180-second timeout is reached.
 *
 * @throws {Error} When the sidebar does not appear within 180 seconds
 */
export async function waitForMainUI(): Promise<void> {
  await browser.waitUntil(
    async () => {
      const sidebar = await browser.$(S.SIDEBAR)
      return await sidebar.isExisting()
    },
    {
      timeout: 180_000,
      timeoutMsg: 'Main UI (sidebar) did not appear within 180s',
    },
  )
}

// Why: the webdriver session stays pinned to the window it was created on
// (splash), so switching means polling handles only — any command routed at
// the closing splash window fails with "no such window" (issue #977).
export async function switchToWindow(label: string): Promise<void> {
  await browser.waitUntil(
    async () => (await browser.getWindowHandles()).includes(label),
    {
      timeout: 180_000,
      timeoutMsg: `Window "${label}" did not appear within 180s`,
    },
  )
  await browser.switchToWindow(label)
}

export async function dismissThemeOnboardingIfPresent(): Promise<void> {
  const cta = await browser.$(S.THEME_ONBOARDING_CTA)
  if (!(await cta.isExisting())) return
  await browser.execute((selector: string) => {
    const btn = document.querySelector(selector)
    if (btn instanceof HTMLElement) btn.click()
  }, S.THEME_ONBOARDING_CTA)
  await browser.waitUntil(
    async () => !(await (await browser.$(S.THEME_ONBOARDING_CTA)).isExisting()),
    {
      timeout: 10_000,
      timeoutMsg: 'Theme onboarding dialog did not dismiss after confirm',
    },
  )
}

/**
 * Wait for the URL input field to be visible and
 * interactable.
 *
 * Waits up to 10 seconds for the element to exist and
 * an additional 5 seconds for it to become clickable.
 *
 * @throws {Error} When the URL input is not found within the timeout
 */
export async function waitForUrlInput(): Promise<void> {
  const input = await browser.$(S.URL_INPUT)
  await input.waitForExist({ timeout: 10_000 })
  await input.waitForClickable({ timeout: 5_000 })
}

/**
 * Navigate from the startup landing page to the URL-fetch page (/search)
 * via a JS-initiated click on the sidebar nav button.
 *
 * Why a JS click instead of a WebDriver click: the app's default startup
 * page is /popular (video search), so fresh sessions no longer boot with
 * the URL form on screen — and native WebDriver clicks on sidebar menu
 * buttons do not propagate to React on the macOS runner (see the skipped
 * settings-navigation spec in app-launch.e2e.ts). A DOM click() does.
 */
export async function navigateToUrlFetchPage(): Promise<void> {
  await browser.execute((selector: string) => {
    const btn = document.querySelector(selector)
    if (btn instanceof HTMLElement) btn.click()
  }, S.NAV_SEARCH)
  await waitForUrlInput()
}

/**
 * Fills the URL input (assumes the URL page is on screen) and
 * blur-submits (the form fetches on blur — WKWebView's WebDriver does
 * not propagate focus changes, hence the explicit blur via JS), then
 * waits for the part list to render. Shared by the CI fixture specs
 * and the local-real specs (different URLs).
 */
export async function submitVideoUrl(url: string): Promise<void> {
  const input = await browser.$(S.URL_INPUT)
  await input.click()
  await input.setValue(url)
  await browser.execute(() => {
    const el = document.activeElement
    if (el instanceof HTMLElement) el.blur()
  })
  const partList = await browser.$(S.DATA_PART_LIST)
  await partList.waitForExist({ timeout: 30_000 })
}

/**
 * Navigates to /search first (fresh sessions land on the /popular
 * default), then loads the fixture video. Each spec file runs in a
 * fresh app session: wdio creates a new WebDriver session per file and
 * tauri-webdriver relaunches the app with it, so any spec that needs
 * the video on screen must load it itself instead of relying on state
 * from a previously-run spec file.
 */
export async function loadFixtureVideo(): Promise<void> {
  await navigateToUrlFetchPage()
  await submitVideoUrl(FIXTURE_VIDEO_URL)
}

/** Fixed, visible E2E download dir; wiped per run (see setupDownloadEnv)
 * and shared with wdio.local.conf.ts's interrupted-run cleanup. */
export const E2E_DOWNLOAD_DIR = path.join(os.homedir(), 'Downloads', 'e2e_temp')

/**
 * Tauri app_data_dir() per platform — the dir holding the developer's
 * real settings.json and login_state.json (must track
 * src-tauri/src/utils/paths.rs; dev and release builds share it via the
 * same bundle identifier). Shared with wdio.local.conf.ts's
 * backup/restore so the two can never drift apart.
 */
export const APP_DATA_DIR = path.join(
  process.platform === 'win32'
    ? (process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'))
    : process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : (process.env.XDG_DATA_HOME ??
        path.join(os.homedir(), '.local', 'share')),
  'com.bilibili-downloader-gui.app',
)

export const SETTINGS_PATH = path.join(APP_DATA_DIR, 'settings.json')

/**
 * Parses settings.json straight from disk (Node side). Unlike the typed
 * get_settings response, this shows what is really persisted — unknown
 * keys included.
 */
export async function readPersistedSettings(): Promise<
  Record<string, unknown>
> {
  const raw = await fs.promises.readFile(SETTINGS_PATH, 'utf8')
  return JSON.parse(raw) as Record<string, unknown>
}
/** State captured by setupDownloadEnv for the matching teardown. */
export type DownloadEnv = {
  /** Fixed download dir the spec's downloads are patched into. */
  outputDir: string
  /** Developer's dlOutputPath before the patch (null = OS default). */
  originalDlOutputPath: string | null
  /** History entry ids present before the spec ran. */
  originalHistoryIds: string[]
}

/**
 * Points dlOutputPath at the fixed E2E download dir so a spec's downloads
 * never land in the developer's real output directory (dev and E2E share
 * one app_data_dir — same bundle identifier — and each spec file starts a
 * new app that reads the persisted settings). The dir is wiped first for
 * a pristine per-run state (interrupted-run leftovers must not leak into
 * file assertions) and is visible under ~/Downloads so it can never
 * silently accumulate in the OS temp dir. Pair with teardownDownloadEnv.
 */
export async function setupDownloadEnv(): Promise<DownloadEnv> {
  const settings = await tauriInvoke<{ dlOutputPath?: string | null }>(
    'get_settings',
  )
  const history = await tauriInvoke<Array<{ id: string }>>('get_history')
  const outputDir = E2E_DOWNLOAD_DIR
  fs.rmSync(outputDir, { recursive: true, force: true })
  fs.mkdirSync(outputDir, { recursive: true })
  // patch_settings validates the path exists and is a directory, so a
  // resolve here proves the backend accepted it.
  await tauriInvoke('patch_settings', { patch: { dlOutputPath: outputDir } })
  return {
    outputDir,
    originalDlOutputPath: settings.dlOutputPath ?? null,
    originalHistoryIds: history.map((e) => e.id),
  }
}

/**
 * Restores the developer's output path, removes only the history entries
 * the spec created, and deletes the temp dir. Best-effort per step: a
 * settings failure must not mask test failures.
 */
export async function teardownDownloadEnv(env: DownloadEnv): Promise<void> {
  await tauriInvoke('patch_settings', {
    patch: { dlOutputPath: env.originalDlOutputPath },
  }).catch(() => undefined)
  const history = await tauriInvoke<Array<{ id: string }>>('get_history').catch(
    () => [] as Array<{ id: string }>,
  )
  for (const entry of history) {
    if (!env.originalHistoryIds.includes(entry.id)) {
      await tauriInvoke('remove_history_entry', { id: entry.id }).catch(
        () => undefined,
      )
    }
  }
  fs.rmSync(env.outputDir, { recursive: true, force: true })
}

/** Window parking spot for the pending invoke result (see tauriInvoke). */
type InvokeResultWindow = {
  __tauriInvokeResult?: { ok?: unknown; err?: string }
}

/**
 * Invoke a Tauri backend command via window.__TAURI_INTERNALS__ and read
 * the result back.
 *
 * Works because withGlobalTauri: true is set in tauri.conf.json.
 *
 * Why the window-buffer round trip: WebKit's WebDriver does not resolve a
 * Promise returned from browser.execute — the call returns null long
 * before the invoke settles. The result is therefore parked on window and
 * polled until it appears.
 *
 * @typeParam T - The expected return type of the Tauri command
 * @param command - The Tauri command name (must match the Rust `#[tauri::command]` function name)
 * @param args    - Optional key-value arguments forwarded to the Tauri command
 * @returns A promise that resolves with the command result
 *
 * @example
 * ```typescript
 * const settings = await tauriInvoke<Settings>('get_settings')
 * ```
 */
export async function tauriInvoke<T = unknown>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  await browser.execute(
    (cmd: string, params: Record<string, unknown> | undefined) => {
      const w = window as unknown as InvokeResultWindow
      w.__tauriInvokeResult = undefined
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).__TAURI_INTERNALS__
        .invoke(cmd, params)
        .then((value: unknown) => {
          w.__tauriInvokeResult = { ok: value }
        })
        .catch((error: unknown) => {
          w.__tauriInvokeResult = { err: String(error) }
        })
    },
    command,
    args,
  )
  await browser.waitUntil(
    async () =>
      (await browser.execute(
        () =>
          (window as unknown as InvokeResultWindow).__tauriInvokeResult !==
          undefined,
      )) === true,
    { timeout: 15_000, timeoutMsg: `tauriInvoke(${command}) timed out` },
  )
  const result = (await browser.execute(
    () => (window as unknown as InvokeResultWindow).__tauriInvokeResult,
  )) as { ok?: T; err?: string }
  if (result.err) {
    throw new Error(`tauriInvoke(${command}) failed: ${result.err}`)
  }
  return result.ok as T
}
