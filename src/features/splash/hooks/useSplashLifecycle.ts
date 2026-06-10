import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useCallback, useEffect, useRef, useState } from 'react'

import { sleep } from '@/shared/lib/utils'

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
}

/**
 * Resolves the user's preferred UI theme from localStorage or the system
 * preference.
 *
 * @returns `'dark'` or `'light'`
 */
function resolveTheme(): 'dark' | 'light' {
  const stored = localStorage.getItem('ui-theme') || 'system'
  if (stored === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
  }
  return stored === 'dark' ? 'dark' : 'light'
}

/**
 * Manages the full lifecycle of the splash screen.
 *
 * Orchestrates three phases:
 * 1. **active**  -- splash is visible; waits for both backend initialization
 *    and a minimum display duration before advancing.
 * 2. **fading**  -- CSS opacity transition is running; the caller is expected
 *    to call `onFadeComplete` when the transition ends.
 * 3. **done**    -- splash is removed from the DOM; the native window theme is
 *    restored and resizing is enabled.
 *
 * @returns The current phase and a fade-completion callback.
 */
export function useSplashLifecycle(): SplashLifecycle {
  const [phase, setPhase] = useState<SplashPhase>('active')
  const disposedRef = useRef(false)

  // Force light theme during splash
  useEffect(() => {
    getCurrentWindow()
      .setTheme('light')
      .catch(() => {})
  }, [])

  useEffect(() => {
    disposedRef.current = false

    Promise.all([initCompletePromise, sleep(MIN_DISPLAY_MS)]).then(() => {
      if (!disposedRef.current) {
        notifySplashFading()
        setPhase('fading')
      }
    })

    return () => {
      disposedRef.current = true
    }
  }, [])

  // Restore theme and enable resize after splash
  useEffect(() => {
    if (phase !== 'done') return
    notifySplashDone()
    invoke('enable_window_resize').catch(() => {})
    getCurrentWindow()
      .setTheme(resolveTheme())
      .catch(() => {})
  }, [phase])

  // Sync Tauri theme when user changes theme after splash
  useEffect(() => {
    if (phase !== 'done') return

    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      getCurrentWindow()
        .setTheme(resolveTheme())
        .catch(() => {})
    }
    mq.addEventListener('change', handler)

    return () => {
      mq.removeEventListener('change', handler)
    }
  }, [phase])

  const onFadeComplete = useCallback(() => {
    setPhase('done')
  }, [])

  return { phase, onFadeComplete }
}
