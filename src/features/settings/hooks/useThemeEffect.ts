import { useSelector } from '@/app/store'
import type { Theme } from '@/features/settings/type'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect } from 'react'

let tauriThemeReady = false

export function markTauriThemeReady() {
  tauriThemeReady = true
}

export function useThemeEffect() {
  const theme = useSelector((state) => state.settings.theme) as
    | Theme
    | undefined

  useEffect(() => {
    const effective = theme ?? 'light'
    const root = window.document.documentElement

    root.classList.remove('light', 'dark')
    root.classList.add(effective)
    root.style.colorScheme = effective

    localStorage.setItem('ui-theme', effective)

    if (tauriThemeReady) {
      getCurrentWindow()
        .setTheme(effective)
        .catch(() => {})
    }
  }, [theme])
}
