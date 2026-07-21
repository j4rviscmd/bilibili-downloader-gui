import { IconButton } from '@/components/animate-ui/components/buttons/icon'
import { CircleX } from '@/components/animate-ui/icons/circle-x'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/animate-ui/radix/tooltip'
import { mapBackendError } from '@/shared/lib/mapBackendError'
import { cn } from '@/shared/lib/utils'
import { GitMerge } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { formatTransferRate } from '../lib/format'
import type { PartStatusRowModel, StageProgress } from '../model/types'

const STATUS_DOT_CLASS: Record<string, string> = {
  done: 'bg-green-500',
  running: 'bg-blue-500',
  pending: 'bg-muted-foreground',
  cancelling: 'bg-yellow-500',
  cancelled: 'bg-muted-foreground',
  error: 'bg-destructive',
}

/** Compact inline stage: icon + bar + % + optional speed */
function StageMini({
  label,
  tooltipLabel,
  stage,
  showSpeed,
}: {
  label: string
  tooltipLabel: string
  stage: StageProgress
  showSpeed?: boolean
}) {
  if (!stage) return null
  const pct = Math.min(100, Math.round(stage.percentage))
  return (
    <div className="flex shrink-0 items-center gap-1">
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-default text-xs">{label}</span>
          </TooltipTrigger>
          <TooltipContent side="top">{tooltipLabel}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <div className="bg-primary/20 relative h-1.5 w-16 overflow-hidden rounded-full">
        <div
          className="bg-primary h-full transition-[width] duration-1000 ease-linear"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-7 text-end text-xs font-medium tabular-nums">
        {pct}%
      </span>
      {showSpeed && (
        <span className="text-muted-foreground w-14 text-end text-xs tabular-nums">
          {formatTransferRate(stage.transferRate)}
        </span>
      )}
    </div>
  )
}

/**
 * ダイアログ内の1パート分の行（1行、横並び）。
 *
 * 左から: ステータスドット / P番号 / パート名 / [DL中] audio bar+%+speed +
 * video bar+%+speed / [マージ中] merge bar+% / ステータスラベル。
 */
export function PartStatusRow({
  part,
  onCancel,
}: {
  part: PartStatusRowModel
  onCancel?: () => void
}) {
  const { t } = useTranslation()
  const isDownloading = part.status === 'running'
  const dotClass = STATUS_DOT_CLASS[part.status] ?? STATUS_DOT_CLASS.pending
  // Only pending/running parts are cancellable. Merge stage (stage=merge) and
  // completed (isComplete) are excluded — cancelling mid-merge races with the
  // ffmpeg kill and produces a contradictory display.
  const canCancel =
    (part.status === 'pending' || part.status === 'running') &&
    part.stage !== 'merge' &&
    !part.isComplete
  // Why: when an error has a known backend code, show the translated message
  // instead of the raw ERR:: string; otherwise fall back to the part title.
  const mappedErrorKey =
    part.status === 'error' && part.errorMessage
      ? mapBackendError(part.errorMessage)
      : null
  const rawName = mappedErrorKey ? t(mappedErrorKey) : part.title
  const MAX_TOOLTIP_CHARS = 100
  const tooltipName =
    rawName.length > MAX_TOOLTIP_CHARS
      ? rawName.slice(0, MAX_TOOLTIP_CHARS) + '…'
      : rawName

  const mergePct = part.merge
    ? Math.min(100, Math.round(part.merge.percentage))
    : 0

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
        isDownloading && 'bg-primary/5 ring-primary/20 ring-1',
      )}
    >
      <span
        className={cn(
          'size-2 shrink-0 rounded-full',
          dotClass,
          isDownloading && 'animate-pulse',
        )}
      />
      <span className="text-muted-foreground w-8 shrink-0 text-xs font-medium tabular-nums">
        P{part.partIndex}
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              'min-w-0 flex-1 cursor-default truncate',
              // Cancelled parts: greyed text (matches the waiting dot) +
              // strikethrough so they never read as a successful download.
              part.status === 'cancelled' &&
                'text-muted-foreground line-through',
            )}
          >
            {rawName}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-lg break-all">
          {tooltipName}
        </TooltipContent>
      </Tooltip>
      {/* DL中: audio + video inline */}
      {isDownloading && part.stage !== 'merge' && (
        <>
          <StageMini
            label="🔊"
            tooltipLabel={t('downloadStatus.stage_audio')}
            stage={part.audio}
            showSpeed
          />
          <StageMini
            label="🎬"
            tooltipLabel={t('downloadStatus.stage_video')}
            stage={part.video}
            showSpeed
          />
        </>
      )}
      {/* マージ中: merge bar only */}
      {isDownloading && part.stage === 'merge' && part.merge && (
        <div className="flex shrink-0 items-center gap-1">
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <GitMerge className="text-muted-foreground size-3" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">
                {t('downloadStatus.stage_merge')}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <div className="bg-primary/20 relative h-1.5 w-16 overflow-hidden rounded-full">
            <div
              className="bg-primary h-full transition-[width] duration-1000 ease-linear"
              style={{ width: `${mergePct}%` }}
            />
          </div>
          <span className="w-7 text-end text-xs font-medium tabular-nums">
            {mergePct}%
          </span>
        </div>
      )}
      {canCancel && onCancel && (
        <Tooltip>
          <TooltipTrigger asChild>
            <IconButton
              variant="ghost"
              size="sm"
              onClick={onCancel}
              className="text-muted-foreground hover:text-destructive size-5 shrink-0 p-0"
            >
              <CircleX animateOnHover className="size-3.5" />
            </IconButton>
          </TooltipTrigger>
          <TooltipContent side="top" arrow>
            {t('video.cancel_download')}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
