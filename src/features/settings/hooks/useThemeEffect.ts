import { useSelector } from '@/app/store'
import type { Theme, ThemePreset } from '@/features/settings/type'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect } from 'react'

export function useThemeEffect() {
  const theme = useSelector((state) => state.settings.theme) as
    | Theme
    | undefined
  const preset = useSelector((state) => state.settings.themePreset) as
    | ThemePreset
    | undefined

  useEffect(() => {
    const effective = theme ?? 'light'
    const root = window.document.documentElement

    root.classList.remove('light', 'dark')
    root.classList.add(effective)
    root.style.colorScheme = effective

    localStorage.setItem('ui-theme', effective)

    // Theme preset: the data attribute drives the CSS token swap;
    // localStorage lets index.html's inline script apply it before React
    // mounts (the same anti-flash pattern as ui-theme). Bilibili is the
    // CSS default, so every other preset carries the attribute.
    if (preset && preset !== 'bilibili') {
      root.dataset.themePreset = preset
    } else {
      delete root.dataset.themePreset
    }
    localStorage.setItem('ui-theme-preset', preset ?? 'bilibili')
    // Why: retire the pre-preset anti-flash key — index.html's inline
    // script reads ui-accent only while ui-theme-preset is absent, and
    // this hook now writes ui-theme-preset on every run, so the stale
    // legacy value would never be read again and no longer tracks the
    // persisted preset.
    localStorage.removeItem('ui-accent')

    // The splash now lives in its own window with its own light theme lock,
    // so the main window can apply the saved theme immediately on mount.
    getCurrentWindow()
      .setTheme(effective)
      .catch(() => {})
  }, [theme, preset])
}
