import { useSelector } from '@/app/store'
import type { Theme } from '@/features/settings/type'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect } from 'react'

export function useThemeEffect() {
  const theme = useSelector((state) => state.settings.theme) as Theme | undefined

  useEffect(() => {
    const effective = theme ?? 'light'
    const root = window.document.documentElement

    root.classList.remove('light', 'dark')
    root.classList.add(effective)
    root.style.colorScheme = effective

    localStorage.setItem('ui-theme', effective)

    // The splash now lives in its own window with its own light theme lock,
    // so the main window can apply the saved theme immediately on mount.
    getCurrentWindow().setTheme(effective).catch(() => {})
  }, [theme])
}
