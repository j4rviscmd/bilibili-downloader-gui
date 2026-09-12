/**
 * App-lifecycle helpers shared across E2E test files.
 *
 * Handles screenshot management, UI readiness detection,
 * Tauri invoke wrapping, and element state polling.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as S from './selectors'

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
 * init completes. Timeout: 90s (init may involve
 * ffmpeg download and network calls).
 *
 * Polls the DOM every 500 ms until a `[data-slot="sidebar"]`
 * element is found, or the 90-second timeout is reached.
 *
 * @throws {Error} When the sidebar does not appear within 90 seconds
 */
export async function waitForMainUI(): Promise<void> {
  await browser.waitUntil(
    async () => {
      const sidebar = await browser.$(S.SIDEBAR)
      return await sidebar.isExisting()
    },
    {
      timeout: 90_000,
      timeoutMsg: 'Main UI (sidebar) did not appear within 90s',
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
