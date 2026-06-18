import { store } from '@/app/store'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useCallback, useEffect, useRef, useState } from 'react'

import { sleep } from '@/shared/lib/utils'

import { markTauriThemeReady } from '@/features/settings/hooks/useThemeEffect'

import { MIN_DISPLAY_MS } from '../lib/constants'
import {
  initCompletePromise,
  notifySplashDone,
  notifySplashFading,
} from '../lib/splash-state'

/** Represents the current visual state of the splash screen. */
type SplashPhase = 'active' | 'fading' | 'done'

/** Return value of {@link useSplashLifecycle}. */
interface SplashLifecycle {
  /** Current visual phase of the splash screen. */
  phase: SplashPhase
  /** Callback to invoke when the CSS fade-out transition finishes. */
  onFadeComplete: () => void
  /** Whether the minimal (skip-animation) mode is active. Null while loading. */
  skipMode: boolean | null
}

/**
 * Manages the full lifecycle of the splash screen.
 *
 * Orchestrates three phases:
 * 1. **active**  -- splash is visible; the native title bar is locked to the
 *    light theme to match the splash background; waits for both backend
 *    initialization and a minimum display duration before advancing (unless
 *    skip mode).
 * 2. **fading**  -- CSS opacity transition is running; the saved theme is
 *    applied just before the fade so the title bar switches in step with the
 *    fade-out (no post-splash theme lag). The caller is expected to call
 *    `onFadeComplete` when the transition ends.
 * 3. **done**    -- splash is removed from the DOM and resizing is enabled.
 *
 * When `skipSplashAnimation` is enabled in settings, the minimum display time
 * and fade animation are skipped for fastest possible startup.
 *
 * @returns The current phase, a fade-completion callback, and skip mode flag.
 */
export function useSplashLifecycle(): SplashLifecycle {
  const [phase, setPhase] = useState<SplashPhase>('active')
  const [skipMode, setSkipMode] = useState<boolean | null>(null)
  const disposedRef = useRef(false)

  // Lock the native title bar to the light theme while the splash is visible
  // so it matches the light splash background.
  useEffect(() => {
    getCurrentWindow()
      .setTheme('light')
      .catch(() => {})
  }, [])

  useEffect(() => {
    disposedRef.current = false

    const run = async () => {
      let skip = false
      try {
        const s = await invoke<{ skipSplashAnimation?: boolean }>(
          'get_settings',
        )
        skip = s.skipSplashAnimation ?? false
      } catch {
        // Default to normal splash on error
      }

      if (disposedRef.current) return
      setSkipMode(skip)

      // Skip mode bypasses the minimum display time and fade phase entirely
      if (skip) {
        await initCompletePromise
      } else {
        await Promise.all([initCompletePromise, sleep(MIN_DISPLAY_MS)])
      }

      if (disposedRef.current) return

      // Apply the saved theme as the splash begins to fade (or, in skip mode,
      // just before removal). Running this here rather than after the fade
      // lets the title bar switch in step with the fade-out, so there is no
      // visible theme lag once the splash is gone.
      const theme = store.getState().settings.theme ?? 'light'
      getCurrentWindow()
        .setTheme(theme)
        .catch(() => {})
      // Caution: This arms useThemeEffect (useThemeEffect.ts), which gates its own
      // setTheme behind the tauriThemeReady flag to avoid overriding the light lock
      // while the splash is visible. Must stay after the splash-visible phase or the
      // user's saved theme will clobber the intentional light lock prematurely.
      markTauriThemeReady()

      notifySplashFading()
      setPhase(skip ? 'done' : 'fading')
    }

    run()

    return () => {
      disposedRef.current = true
    }
  }, [])

  // Enable resize after the splash is fully gone
  useEffect(() => {
    if (phase !== 'done') return
    notifySplashDone()
    invoke('enable_window_resize').catch(() => {})
  }, [phase])

  const onFadeComplete = useCallback(() => {
    setPhase('done')
  }, [])

  return { phase, onFadeComplete, skipMode }
}
