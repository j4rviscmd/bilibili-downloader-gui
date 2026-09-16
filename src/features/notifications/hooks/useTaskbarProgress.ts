import { useSelector } from '@/app/store'
import { logger } from '@/shared/lib/logger'
import { selectQueueSummary } from '@/shared/queue'
import { getCurrentWindow, ProgressBarStatus } from '@tauri-apps/api/window'
import { useEffect } from 'react'

/**
 * Reflect download progress on the taskbar.
 *
 * Subscribes to the queue-domain summary (`selectQueueSummary` — the same
 * model the bottom bar renders, spanning every queued session, issue #691)
 * and drives `getCurrentWindow().setProgressBar`. Clears immediately
 * (`ProgressBarStatus.None`) when no downloads are active or the setting is
 * off, so a stale bar never lingers after completion.
 *
 * The percentage formula (`Math.min(100, Math.round(ratio * 100))`) mirrors
 * QueueBottomBar so the taskbar and the bar always show the same value.
 *
 * Must be mounted exactly once at the app root (see App.tsx).
 */
export function useTaskbarProgress(): void {
  const summary = useSelector(selectQueueSummary)
  const enabled = useSelector(
    (state) => state.settings.showTaskbarProgress ?? true,
  )

  useEffect(() => {
    const win = getCurrentWindow()
    if (enabled && summary.hasActive) {
      const progress = Math.min(100, Math.round(summary.overallRatio * 100))
      win
        .setProgressBar({ progress })
        .catch((e) => logger.error('setProgressBar failed', e))
    } else {
      win
        .setProgressBar({ status: ProgressBarStatus.None })
        .catch((e) => logger.error('setProgressBar(clear) failed', e))
    }
  }, [enabled, summary])
}
