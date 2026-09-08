import { useSelector } from '@/app/store'
import { logger } from '@/shared/lib/logger'
import { getVersion } from '@tauri-apps/api/app'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, useState } from 'react'

// CAUTION: keep in sync with WINDOW_TITLE in src-tauri/src/window.rs, which
// composes the creation-time title before this hook can run.
const BASE_TITLE = 'Bilibili Downloader'

// Why hardcoded English (a deliberate exception to the react-i18next rule):
// native window chrome is already hardcoded English (WINDOW_TITLE in
// window.rs, macOS menu names in menu.rs). A localized suffix on an English
// base would produce mixed-language chrome.
const UPDATE_SUFFIX = ' (update available)'

/**
 * Reflect the update-available state in the native window title.
 *
 * The backend composes "Bilibili Downloader v{version}" at window creation
 * (window.rs), so the version is visible from the first frame. When an
 * update is available, this hook appends the suffix via
 * getCurrentWindow().setTitle. Otherwise (latest, dev mode, check failure,
 * or version fetch failure) the backend-composed base title stands untouched.
 *
 * Must be mounted exactly once at the app root (see App.tsx). The splash
 * webview never runs this hook (main.tsx renders SplashScreen, not App, on
 * /splashscreen), so only the main window's title is ever written.
 */
export function useWindowTitle(): void {
  const updateAvailable = useSelector((state) => state.updater.updateAvailable)
  const [version, setVersion] = useState<string | null>(null)

  // Why: fetched from the Tauri API instead of reading state.updater.currentVersion —
  // that store field defaults to null and can be the literal "unknown" when the
  // plugin-updater omits it (see UpdaterProvider.tsx), so it is not a reliable
  // version source for composing the title.
  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch((e) => logger.error('useWindowTitle: getVersion failed', e))
  }, [])

  // Note: issue #598 also floated a "(latest)" marker when up to date; that
  // half is not implemented — when no update is available the title stays at
  // the backend-composed base and no IPC call is made.
  useEffect(() => {
    if (!version || !updateAvailable) return

    getCurrentWindow()
      .setTitle(`${BASE_TITLE} v${version}${UPDATE_SUFFIX}`)
      .catch((e) => logger.error('useWindowTitle: setTitle failed', e))
  }, [version, updateAvailable])
}
