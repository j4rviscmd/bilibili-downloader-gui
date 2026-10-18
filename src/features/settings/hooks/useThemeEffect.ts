import { useSelector } from '@/app/store'
import type { AccentColor, Theme } from '@/features/settings/type'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect } from 'react'

export function useThemeEffect() {
  const theme = useSelector((state) => state.settings.theme) as
    | Theme
    | undefined
  const accent = useSelector((state) => state.settings.accentColor) as
    | AccentColor
    | undefined

  useEffect(() => {
    const effective = theme ?? 'light'
    const root = window.document.documentElement

    root.classList.remove('light', 'dark')
    root.classList.add(effective)
    root.style.colorScheme = effective

    localStorage.setItem('ui-theme', effective)

    // Accent: the data attribute drives the CSS token swap; localStorage
    // lets index.html's inline script apply it before React mounts (the
    // same anti-flash pattern as ui-theme). Pink is the CSS default, so
    // only blue carries the attribute.
    if (accent === 'blue') {
      root.dataset.accent = 'blue'
    } else {
      delete root.dataset.accent
    }
    localStorage.setItem('ui-accent', accent ?? 'pink')

    // The splash now lives in its own window with its own light theme lock,
    // so the main window can apply the saved theme immediately on mount.
    getCurrentWindow()
      .setTheme(effective)
      .catch(() => {})
  }, [theme, accent])
}
