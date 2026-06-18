import { useAppDispatch, useSelector } from '@/app/store'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/shared/animate-ui/radix/tooltip'
import { cancelAllDownloads } from '@/shared/queue'
import { Button } from '@/shared/ui/button'
import { useTranslation } from 'react-i18next'

import { formatElapsed } from '../lib/format'
import { selectOverallSummary } from '../model/selectors'

/**
 * ダイアログヘッダーの全体進捗バー。
 *
 * trim風の薄いバー + 完了数 + 経過時間 + すべてキャンセル。
 * 「すべてキャンセル」は既存の cancelAllDownloads thunk（バックエンドへ
 * キャンセルを通知）を dispatch する。
 */
export function OverallProgressBar() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const summary = useSelector(selectOverallSummary)
  const percent = Math.min(100, Math.round(summary.overallRatio * 100))

  const handleCancelAll = () => {
    dispatch(cancelAllDownloads())
  }

  return (
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
        {t('downloadStatus.elapsed')} {formatElapsed(summary.elapsedSeconds)}
      </span>
      {/*
        @why: Disabling on isMerging is because the merge stage spawns an ffmpeg
          CLI child process. Cancelling kills the child, but if the cancel hits
          the brief window right after ffmpeg reaches `progress=end`, it exits
          successfully and the output is already complete
          (src-tauri/src/handlers/ffmpeg.rs merge_avs "don't discard a finished
          file", commit d9202270). This actually caused a contradictory
          "cancelled yet complete progress emitted" display.
        @caution: Removing this disable lets the cancel slip through the race
          window and the UI shows a contradictory "complete" + "cancelled" state.
        @constraint: Fully closing the race window in the backend is hard, so
          refusing cancel-all while merging is the safest and simplest approach.
      */}
      <Tooltip>
        <TooltipTrigger asChild>
          {/*
            A span wrapper is required: a disabled button gets pointer-events:
            none and hover never reaches it. The wrapper receives the hover and
            shows the tooltip.
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
  )
}
