import type { RootState } from '@/app/store'
import {
  Progress,
  ProgressLabel,
  ProgressTrack,
} from '@/shared/animate-ui/base/progress'
import type { Progress as ProgressType } from '@/shared/progress'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'

/**
 * Props for ProgressStatusBar component.
 */
type Props = {
  /** Progress data object */
  progress: ProgressType
}

/**
 * Progress bar component for download status.
 *
 * Displays:
 * - Elapsed time
 * - Transfer speed (KB/s or MB/s)
 * - Downloaded/total size (if available)
 * - Progress percentage
 * - "Queued" label if the download is pending
 *
 * @param props - Component props
 *
 * @example
 * ```tsx
 * <ProgressStatusBar progress={progressData} />
 * ```
 */
function ProgressStatusBar({ progress }: Props) {
  const { t } = useTranslation()

  /**
   * Formats elapsed time in hours, minutes, and seconds.
   *
   * @param sec - Elapsed time in seconds
   * @returns Formatted time string (e.g., '1h23m45s', '5m30s')
   */
  const formatElapsed = (sec?: number) => {
    let total = Math.max(0, Math.floor(sec ?? 0))
    const h = Math.floor(total / 3600)
    total %= 3600
    const m = Math.floor(total / 60)
    const s = total % 60
    const parts: string[] = []
    if (h > 0) parts.push(`${h}h`)
    if (h > 0 || m > 0) parts.push(`${m}m`)
    parts.push(`${s}s`)
    return parts.join('')
  }
  const queued = useSelector((s: RootState) =>
    s.queue.find((q) => q.downloadId === progress.downloadId),
  )

  return (
    <Progress
      value={queued ? 0 : progress.percentage}
      className="text-muted-foreground w-full"
    >
      {progress.filesize != null ? (
        <>
          <div className="flex items-center justify-between">
            <ProgressLabel className="flex w-full items-center text-sm">
              <div className="w-1/3">
                {queued ? (
                  <span className="text-muted-foreground text-sm font-medium">
                    {t('progress.queued')}
                  </span>
                ) : (
                  <>
                    {t('progress.elapsed')}:{' '}
                    {formatElapsed(progress.elapsedTime)}
                  </>
                )}
              </div>
              <div className="w-1/3">
                {t('progress.speed')}:{' '}
                {(() => {
                  const kb = progress.transferRate || 0
                  if (kb >= 1000) {
                    return `${(kb / 1024).toFixed(1)}MB/s`
                  }
                  return `${kb.toFixed(0)}KB/s`
                })()}
              </div>
              <div className="w-1/3">
                {(progress.downloaded ?? 0).toFixed(1)}mb/
                {(progress.filesize ?? 0).toFixed(1)}mb
              </div>
            </ProgressLabel>
          </div>
          <div className="flex items-center">
            <ProgressTrack
              className={progress.isComplete ? 'bg-chart-2' : ''}
            />
            <div className="mx-0.5" />
            <div className="min-w-[2.5rem] text-end text-sm font-semibold">
              {progress.percentage}%
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <ProgressLabel className="flex w-full items-center justify-between text-sm">
              <div>
                {t('progress.elapsed')}: {formatElapsed(progress.elapsedTime)}
              </div>
              <div />
            </ProgressLabel>
          </div>
          <div className="flex items-center">
            <ProgressTrack
              className={progress.isComplete ? 'bg-chart-2' : ''}
            />
            <div className="mx-0.5" />
            <div className="min-w-[2.5rem] text-end text-sm font-semibold">
              {progress.percentage}%
            </div>
          </div>
        </>
      )}
    </Progress>
  )
}

export default ProgressStatusBar
