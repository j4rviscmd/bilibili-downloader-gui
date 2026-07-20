import { useSelector } from '@/app/store'
import { selectOverallSummary } from '@/features/download-status/model/selectors'
import { logger } from '@/shared/lib/logger'
import { selectHasActiveDownloads } from '@/shared/queue/queueSlice'
import { getCurrentWindow, ProgressBarStatus } from '@tauri-apps/api/window'
import { useEffect } from 'react'

/**
 * Reflect download progress on the taskbar.
 *
 * Subscribes to the same `overallRatio` the download dialog's
 * `OverallProgressBar` renders, plus the active-downloads flag, and drives
 * `getCurrentWindow().setProgressBar`. Clears immediately
 * (`ProgressBarStatus.None`) when no downloads are active or the setting is
 * off, so a stale bar never lingers after completion.
 *
 * The percentage formula mirrors `OverallProgressBar.tsx` exactly
 * (`Math.min(100, Math.round(ratio * 100))`) so the taskbar and the dialog
 * always show the same value, including any future refinement to the ratio.
 *
 * Must be mounted exactly once at the app root (see App.tsx).
 */
export function useTaskbarProgress(): void {
  const hasActive = useSelector(selectHasActiveDownloads)
  const overallRatio = useSelector(
    (state) => selectOverallSummary(state).overallRatio,
  )
  const enabled = useSelector(
    (state) => state.settings.showTaskbarProgress ?? true,
  )

  useEffect(() => {
    const win = getCurrentWindow()
    if (enabled && hasActive) {
      const progress = Math.min(100, Math.round(overallRatio * 100))
      win
        .setProgressBar({ progress })
        .catch((e) => logger.error('setProgressBar failed', e))
    } else {
      win
        .setProgressBar({ status: ProgressBarStatus.None })
        .catch((e) => logger.error('setProgressBar(clear) failed', e))
    }
  }, [enabled, hasActive, overallRatio])
}
