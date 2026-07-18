import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useCallback, useEffect, useRef, useState } from 'react'

import { sleep } from '@/shared/lib/utils'

import { MIN_DISPLAY_MS } from '../lib/constants'

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
 * Drives the standalone splash window lifecycle.
 *
 * The splash is its own borderless window (a separate webview from main), so
 * it cannot share Redux state with the main window. Instead it:
 * 1. locks its own native theme to light to match the splash background,
 * 2. invokes the backend `initialize` command (the real step sequence lands
 *    in Phase B-2; currently a skeleton that returns immediately),
 * 3. waits for the minimum display time (unless skip mode),
 * 4. fades out, then on fade completion invokes `finish_splash`, which closes
 *    the splash and creates the main window.
 *
 * When `skipSplashAnimation` is enabled in settings, the minimum display time
 * and fade animation are skipped for fastest possible startup.
 */
export function useSplashLifecycle(): SplashLifecycle {
  const [phase, setPhase] = useState<SplashPhase>('active')
  const [skipMode, setSkipMode] = useState<boolean | null>(null)
  const disposedRef = useRef(false)

  useEffect(() => {
    disposedRef.current = false

    const run = async () => {
      // Lock the splash window theme to light to match the splash background.
      getCurrentWindow()
        .setTheme('light')
        .catch(() => {})

      let skip = false
      try {
        const s = await invoke<{ skipSplashAnimation?: boolean }>(
          'get_settings',
        )
        skip = s.skipSplashAnimation ?? false
      } catch {
        // default to normal splash on error
      }
      if (disposedRef.current) return
      setSkipMode(skip)

      // Run backend initialization. Phase B-1: skeleton returns immediately.
      // Phase B-2 will port the ffmpeg/cookie/user steps here and emit
      // init_step / init_progress events that the splash UI renders.
      await invoke('initialize').catch(() => {})

      if (!skip) {
        await sleep(MIN_DISPLAY_MS)
      }
      if (disposedRef.current) return

      setPhase(skip ? 'done' : 'fading')
    }

    run()

    return () => {
      disposedRef.current = true
    }
  }, [])

  const onFadeComplete = useCallback(() => {
    setPhase('done')
  }, [])

  // Close the splash and create the main window once the splash is done.
  useEffect(() => {
    if (phase !== 'done') return
    invoke('finish_splash').catch(() => {})
  }, [phase])

  return { phase, onFadeComplete, skipMode }
}
