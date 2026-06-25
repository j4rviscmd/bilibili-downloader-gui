import { store } from '@/app/store'
import {
  FONT_SIZE_DEFAULT,
  applyFontSize,
  parseFontSize,
} from '@/features/settings/lib/fontSize'
import { useSettings } from '@/features/settings/useSettings'
import { t } from 'i18next'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

// Shared toast id so rapid presses replace the previous toast instead of
// stacking, keeping the feedback unobtrusive while adjusting repeatedly.
const FONT_SIZE_TOAST_ID = 'font-size-shortcut'

/**
 * Global keyboard shortcuts for base font-size adjustment.
 *
 * - Ctrl/Cmd + `+` or `=` -> increase by one step
 * - Ctrl/Cmd + `-`        -> decrease by one step
 *
 * The listener is registered once (empty deps) and reads the latest
 * settings straight from the Redux store singleton, so it never goes
 * stale when settings change. Persistence runs through the canonical
 * `saveByForm(silent=true)` path (Redux dispatch + backend save, with
 * error logging handled there). A short toast shows the resulting size.
 *
 * Must be mounted exactly once at the app root (see `App.tsx`).
 */
export function useFontSizeShortcuts(): void {
  const { saveByForm } = useSettings()
  // saveByForm is recreated every render; keep the latest in a ref so the
  // stable keydown listener always calls the current closure without
  // re-subscribing on each settings change.
  const saveByFormRef = useRef(saveByForm)
  saveByFormRef.current = saveByForm

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return

      let direction: 1 | -1
      if (event.key === '+' || event.key === '=') {
        direction = 1
      } else if (event.key === '-') {
        direction = -1
      } else {
        return
      }

      // Suppress the webview's native page zoom for this accelerator.
      event.preventDefault()

      const currentSettings = store.getState().settings
      const current = currentSettings.fontSize ?? FONT_SIZE_DEFAULT
      const updated = parseFontSize(current + direction)

      // Apply + persist only when the value actually changes. At the
      // min/max boundary we still show the toast so the user knows the
      // keystroke was received and the limit was hit.
      if (updated !== current) {
        applyFontSize(updated)
        void saveByFormRef.current(
          { ...currentSettings, fontSize: updated },
          true,
        )
      }

      toast.info(t('settings.font_size_changed', { size: updated }), {
        id: FONT_SIZE_TOAST_ID,
        duration: 1500,
      })
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
}
