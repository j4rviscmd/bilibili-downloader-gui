import { useSelector } from '@/app/store'
import { logger } from '@/shared/lib/logger'
import { getCurrentWindow, UserAttentionType } from '@tauri-apps/api/window'
import { useEffect, useRef } from 'react'

import { deriveDownloadPhase } from '../lib/downloadPhase'

/**
 * Flash the taskbar when all downloads settle.
 *
 * Listens to the queue, derives the phase, and on the single `active →
 * settled` edge fires one taskbar flash:
 *  - `Critical` when any part errored
 *  - `Informational` on pure success
 *
 * "All cancelled" (`hasSuccess=false && hasError=false`) is skipped, so
 * cancelling every part never triggers a flash.
 *
 * Stopping the flash is left to the OS: Tauri's `requestUserAttention`
 * auto-stops once the window regains focus on both Windows and macOS, so no
 * focus listener is needed here.
 *
 * Must be mounted exactly once at the app root (see App.tsx).
 */
export function useDownloadCompletionNotifications(): void {
  const queue = useSelector((state) => state.queue)
  const flashEnabled = useSelector(
    (state) => state.settings.flashTaskbarOnComplete ?? true,
  )

  const prevPhaseRef = useRef<'idle' | 'active' | 'settled'>('idle')

  useEffect(() => {
    const current = deriveDownloadPhase(queue)
    const prev = prevPhaseRef.current
    prevPhaseRef.current = current.phase

    if (prev !== 'active' || current.phase !== 'settled') return

    // Skip pure all-cancelled completion (no success and no error).
    if (!current.hasSuccess && !current.hasError) return

    if (!flashEnabled) return

    const attention = current.hasError
      ? UserAttentionType.Critical
      : UserAttentionType.Informational
    getCurrentWindow()
      .requestUserAttention(attention)
      .catch((e) => logger.error('requestUserAttention failed', e))
  }, [queue, flashEnabled])
}
