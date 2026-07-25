import { logger } from '@/shared/lib/logger'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useEffect, useState } from 'react'
import { AboutDialogContent } from './AboutDialogContent'

// Event name emitted by the Rust backend (src-tauri/src/lib.rs) when the
// macOS "About <App>" menu item is clicked. Kept in sync with the
// `app.emit("menu:about", ())` call on the Rust side.
const MENU_ABOUT_EVENT = 'menu:about'

/**
 * Opens the About dialog from the macOS menu-bar "About" entry.
 *
 * The menu bar cannot render React, so the Rust backend emits
 * {@link MENU_ABOUT_EVENT} on click and this component listens for it and
 * opens the shared {@link AboutDialogContent}. Mounted once at the app
 * root; the listener is a no-op on Windows/Linux where the event is never
 * emitted.
 *
 * @example
 * ```tsx
 * <MenuAboutDialog />
 * ```
 */
export function MenuAboutDialog() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let unlisten: UnlistenFn | undefined
    listen(MENU_ABOUT_EVENT, () => setOpen(true))
      .then((fn) => {
        unlisten = fn
      })
      .catch((e) =>
        logger.error('MenuAboutDialog: failed to register menu:about listener', e),
      )
    return () => unlisten?.()
  }, [])

  return <AboutDialogContent open={open} onOpenChange={setOpen} />
}
