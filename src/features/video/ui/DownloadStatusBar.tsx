import { useAppDispatch, useSelector } from '@/app/store'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/animate-ui/radix/tooltip'
import { cancelAllDownloads, selectHasActiveDownloads } from '@/shared/queue'
import { Button } from '@/shared/ui/button'
import { useTranslation } from 'react-i18next'

import { selectOverallSummary } from '../model/downloadProgress'
import { AnimatedSection } from './AnimatedSection'

/**
 * Formats seconds as M:SS or H:MM:SS.
 */
function formatElapsed(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => n.toString().padStart(2, '0')
  if (h > 0) return `${h}:${pad(m)}:${pad(sec)}`
  return `${m}:${pad(sec)}`
}

/**
 * Inline overall progress bar for the home page (successor of the abolished
 * download-status dialog's OverallProgressBar, issue #569).
 *
 * Mounted between the Step 2 CardHeader and the part list. The part list
 * scrolls in its own [data-part-list] container, so this bar is structurally
 * sticky — no CSS sticky needed.
 *
 * Visibility: driven by selectHasActiveDownloads (the same signal that
 * freezes URL input, pagination, and collapses the part cards), so the bar
 * appears exactly while a download session is in flight — including the
 * cancelling window — and collapses once everything settles.
 *
 * Motion: enters/exits with a critically-damped height spring (damping 1.0,
 * response 0.3) so the bar reads as a physical part arriving/leaving, not a
 * plain fade. Springs start from the current on-screen value, so a rapid
 * session start/end never jumps. Reduced motion collapses to an instant
 * opacity crossfade.
 */
export function DownloadStatusBar() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const busy = useSelector(selectHasActiveDownloads)
  const summary = useSelector(selectOverallSummary)

  const percent = Math.min(100, Math.round(summary.overallRatio * 100))

  const handleCancelAll = () => {
    dispatch(cancelAllDownloads())
  }

  return (
    <AnimatedSection show={busy}>
      <div className="border-b px-6 py-2.5">
        <TooltipProvider delayDuration={300}>
          <div className="flex items-center gap-3">
            <div className="bg-primary/20 relative h-2 flex-1 overflow-hidden rounded-full">
              <div
                className="bg-primary h-full transition-[width] duration-1000 ease-linear"
                style={{ width: `${percent}%` }}
              />
            </div>
            <span className="text-sm font-medium whitespace-nowrap tabular-nums">
              {summary.completedCount}/{summary.totalParts}
            </span>
            <span className="text-muted-foreground text-sm whitespace-nowrap tabular-nums">
              {t('downloadStatus.elapsed')}{' '}
              {formatElapsed(summary.elapsedSeconds)}
            </span>
            {/*
              @why: Disabling on isMerging is because the merge stage spawns an
                ffmpeg CLI child process — cancelling in the brief window right
                after ffmpeg finishes can produce a contradictory "cancelled
                yet complete" display. Full rationale: the isMerging doc in
                ../model/downloadProgress.ts (OverallSummary.isMerging).
              @caution: Removing this disable lets the cancel slip through the
                race window.
            */}
            <Tooltip>
              <TooltipTrigger asChild>
                {/*
                  A span wrapper is required: a disabled button gets
                  pointer-events: none and hover never reaches it. The
                  wrapper receives the hover and shows the tooltip.
                */}
                <span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCancelAll}
                    disabled={!summary.hasActive || summary.isMerging}
                  >
                    {t('downloadStatus.cancel_all')}
                  </Button>
                </span>
              </TooltipTrigger>
              {summary.isMerging && (
                <TooltipContent side="top">
                  {t('downloadStatus.cancel_all_disabled_merging')}
                </TooltipContent>
              )}
            </Tooltip>
          </div>
        </TooltipProvider>
      </div>
    </AnimatedSection>
  )
}
