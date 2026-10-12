import { invoke } from '@tauri-apps/api/core'
import { useEffect } from 'react'

/**
 * Reveals the main window after mount. The window is created hidden
 * (`visible(false)` in `create_main_window`) so WebView2's default white
 * background never flashes between the splash closing and the first paint —
 * content-gated reveal, mirroring the splash's `show_splash`.
 */
export function useRevealMainWindow(): void {
  useEffect(() => {
    // Why: fire-and-forget — a rejection must not surface as an unhandled
    // promise rejection; same swallow as the splash's finish_splash call
    // (src/features/splash/hooks/useSplashLifecycle.ts).
    invoke('show_main').catch(() => {})
  }, [])
}
