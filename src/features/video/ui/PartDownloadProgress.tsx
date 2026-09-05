import { IconButton } from '@/components/animate-ui/components/buttons/icon'
import { CircleX } from '@/components/animate-ui/icons/circle-x'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/shared/animate-ui/radix/tooltip'
import { logger } from '@/shared/lib/logger'
import { mapBackendError } from '@/shared/lib/mapBackendError'
import type { Progress } from '@/shared/ui/Progress'
import { Button } from '@/shared/ui/button'
import { invoke } from '@tauri-apps/api/core'
import { CheckCircle2, FolderOpen } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Mosaic } from 'react-loading-indicators'
import type { PartDownloadStatus } from '../hooks/usePartDownloadStatus'

// @why: 28px matches the tallest in-row control (h-7 buttons / size-7 icon
//   buttons) so every state renders at the same height, keeping the block
//   from jumping when the stage moves between pending/downloading/complete.
const MIN_HEIGHT = 'min-h-[28px]'

/**
 * Formats transfer rate in human-readable units.
 * Converts kilobytes per second to KB/s or MB/s depending on size.
 */
function formatTransferRate(kb: number): string {
  if (kb < 1000) {
    return `${kb.toFixed(0)}KB/s`
  }
  return `${(kb / 1024).toFixed(1)}MB/s`
}

/**
 * Formats a megabyte value, trimming the decimal when it is .0.
 * Example: 123.0 → 123, 123.4 → 123.4
 *
 * NOTE: input is already rounded to 1 decimal place by the backend
 * (round_to(..., 1)); this only controls display of the trailing .0.
 */
function formatMb(mb: number): string {
  const formatted = mb.toFixed(1)
  return formatted.endsWith('.0') ? formatted.slice(0, -2) : formatted
}

type StageProgressProps = {
  icon: string
  labelKey: string
  progressEntries: Progress[]
  stageName: string
  t: (key: string) => string
  waitingLabel?: string
  /**
   * Show an indeterminate indicator next to the icon while the part is
   * downloading but THIS stage has not emitted its first progress event
   * yet. Covers the per-stage lag (stream fetch / speed-check window)
   * between the invoke-time 'running' flip (downloadVideo.ts) and each
   * stage's first event — otherwise the column shows only a bare emoji
   * and reads as stuck. The meaningful signal is per-stage entry absence.
   */
  startingIndicator?: boolean
}

/**
 * Tooltip wrapper for stage icons.
 * Displays an emoji icon with a hover tooltip showing the stage label.
 */
function StageIcon({
  icon,
  label,
  fontWeight,
}: {
  icon: string
  label: string
  fontWeight?: 'medium'
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`cursor-help ${fontWeight === 'medium' ? 'font-medium' : ''}`}
          aria-label={label}
        >
          {icon}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" arrow>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * Renders progress display for a single download stage.
 * Shows either waiting state (icon only) or active progress (icon + percentage + speed + file size).
 */
function StageProgress({
  icon,
  labelKey,
  progressEntries,
  stageName,
  t,
  waitingLabel,
  startingIndicator = false,
}: StageProgressProps) {
  const progress = progressEntries.find((p) => p.stage === stageName)
  const stageLabel = t(labelKey)

  if (!progress) {
    return (
      <div
        className={`flex ${MIN_HEIGHT} items-center gap-1`}
        aria-label={`${stageLabel}: ${waitingLabel ?? t('video.stage_waiting')}`}
      >
        <StageIcon icon={icon} label={stageLabel} />
        {/* Mosaic indicator (react-loading-indicators), centered in the
            column's remaining width so the "preparing" state reads as a
            whole-column state, not a left-aligned value.
            @constraint: the indicator is sized in em (5em grid), so the
            2.4px font-size yields a ~12px indicator — safely under the
            28px MIN_HEIGHT, so this state never grows the row/area height.
            color="currentColor" + the wrapper's text-primary theme the
            cubes (single-color mono, matching the app's progress bars)
            instead of the library's hard-coded limegreen. */}
        {startingIndicator && (
          <span
            className="text-primary flex flex-1 justify-center"
            aria-hidden="true"
          >
            <Mosaic color="currentColor" style={{ fontSize: '2.4px' }} />
          </span>
        )}
      </div>
    )
  }

  // Why: each numeric span is pinned to a min-width and rendered with
  // tabular-nums so digit transitions during a download (9% → 10% → 99%,
  // 1.2MB/s → 99.9MB/s, 9.9mb → 123.4mb) don't shift the surrounding text
  // column.
  return (
    <div className={`flex ${MIN_HEIGHT} items-center gap-1`}>
      <StageIcon icon={icon} label={stageLabel} fontWeight="medium" />
      <span className="tabular-nums">
        <span className="inline-block min-w-[3ch] text-right">
          {progress.percentage.toFixed(0)}
        </span>
        %
      </span>
      <span className="inline-block min-w-[7ch] text-right tabular-nums">
        {formatTransferRate(progress.transferRate || 0)}
      </span>
      {progress.filesize != null && (
        <span className="tabular-nums">
          <span className="inline-block min-w-[4.5ch] text-right">
            {formatMb(progress.downloaded ?? 0)}
          </span>
          mb/
          <span className="inline-block min-w-[4.5ch] text-right">
            {formatMb(progress.filesize)}
          </span>
          mb
        </span>
      )}
    </div>
  )
}

type MergeStageProgressProps = {
  progressEntries: Progress[]
  t: (key: string) => string
}

/**
 * Renders progress display for the merge stage.
 * Has special conditional logic based on audio/video completion.
 */
function MergeStageProgress({ progressEntries, t }: MergeStageProgressProps) {
  const mergeProgress = progressEntries.find((p) => p.stage === 'merge')
  const audioProgress = progressEntries.find((p) => p.stage === 'audio')
  const videoProgress = progressEntries.find((p) => p.stage === 'video')
  const mergeLabel = t('video.stage_merge')

  if (mergeProgress) {
    return (
      <div
        className={`flex ${MIN_HEIGHT} items-center gap-1`}
        aria-label={`${mergeLabel}: ${mergeProgress.percentage.toFixed(0)}%`}
      >
        <StageIcon icon="🔄" label={mergeLabel} fontWeight="medium" />
        <span className="font-medium"> {mergeLabel}</span>
        <span>{mergeProgress.percentage.toFixed(0)}%</span>
      </div>
    )
  }

  const audioComplete = (audioProgress?.percentage ?? 0) >= 100
  const videoComplete = (videoProgress?.percentage ?? 0) >= 100

  if (audioComplete && videoComplete) {
    return (
      <div
        className={`flex ${MIN_HEIGHT} items-center gap-1`}
        aria-label={`${mergeLabel}: ${t('video.stage_merging')}`}
      >
        <StageIcon icon="🔄" label={mergeLabel} fontWeight="medium" />
        <span className="font-medium"> {mergeLabel}</span>
        <span>{t('video.stage_merging')}</span>
      </div>
    )
  }

  if (audioProgress || videoProgress) {
    return (
      <div
        className={`flex ${MIN_HEIGHT} items-center`}
        aria-label={`${mergeLabel}: ${t('video.stage_waiting')}`}
      >
        <StageIcon icon="🔄" label={mergeLabel} />
        <span>
          {mergeLabel}: {t('video.stage_waiting')}
        </span>
      </div>
    )
  }

  return null
}

type SubtitleStageProgressProps = {
  t: (key: string) => string
}

/**
 * Renders the subtitle download stage in the merge column.
 *
 * Shown while subtitles are fetching (after audio/video reach 100%, before
 * merge starts) so the card doesn't appear frozen. Indeterminate — no
 * percentage — because subtitle payloads are small and fetched in parallel
 * per language, so there is no meaningful byte-level progress to show.
 */
function SubtitleStageProgress({ t }: SubtitleStageProgressProps) {
  const label = t('video.stage_subtitle')
  return (
    <div
      className={`flex ${MIN_HEIGHT} items-center gap-1`}
      aria-label={`${label}: ${t('video.stage_subtitle_downloading')}`}
    >
      <StageIcon icon="💬" label={label} fontWeight="medium" />
      <span className="font-medium">
        {' '}
        {t('video.stage_subtitle_downloading')}
      </span>
    </div>
  )
}

type Props = {
  status: PartDownloadStatus
  isWaitingForTurn?: boolean
  onCancel?: () => void
  /** True if audio is embedded (durl format), so only video stage is shown */
  hasEmbeddedAudio?: boolean
  /**
   * Render without the block's own surface (bg/rounded/padding/margin).
   * Used inside PartCompactCard, where the surrounding active-part
   * highlight already provides the surface — drawing a second
   * slightly-different background on top made the detail read as a
   * floating foreign box instead of part of the same area.
   */
  flat?: boolean
}

/**
 * Component displaying download progress for a video part.
 * Displays: Pending, Running, Complete, Error, Cancelling, or Cancelled states.
 */
export function PartDownloadProgress({
  status,
  isWaitingForTurn = false,
  onCancel,
  hasEmbeddedAudio = false,
  flat = false,
}: Props) {
  const { t } = useTranslation()
  const {
    isPending,
    isDownloading,
    isComplete,
    hasError,
    errorMessage,
    outputPath,
    progressEntries,
    isCancelling,
    isCancelled,
  } = status

  // Fade out audio/merge stages when hasEmbeddedAudio switches false → true.
  // isFadingOut: opacity-0 transition is running (300ms)
  // isAudioHidden: transition complete, element removed from layout
  const [isFadingOut, setIsFadingOut] = useState(false)
  const [isAudioHidden, setIsAudioHidden] = useState(hasEmbeddedAudio)
  const prevHasEmbeddedAudioRef = useRef(hasEmbeddedAudio)
  useEffect(() => {
    const prev = prevHasEmbeddedAudioRef.current
    prevHasEmbeddedAudioRef.current = hasEmbeddedAudio
    if (!prev && hasEmbeddedAudio) {
      setIsFadingOut(true)
      const timer = setTimeout(() => {
        setIsFadingOut(false)
        setIsAudioHidden(true)
      }, 300)
      return () => clearTimeout(timer)
    }
    if (prev && !hasEmbeddedAudio) {
      setIsAudioHidden(false)
    }
  }, [hasEmbeddedAudio])

  const isInMergeStage = progressEntries.some(
    (p) => p.stage === 'merge' && !p.isComplete,
  )

  // @why: Between download start and each stage's first progress event there
  //   is a fetch/speed-check window with no byte data for that column. Show
  //   the starting indicator on audio/video icons during the whole download
  //   phase whenever the individual stage has no entry — once its event
  //   arrives the column shows real numbers. (Merge keeps its waiting label:
  //   it is genuinely minutes away while audio/video run.)
  const startingIndicator = isDownloading

  // @why: subtitle stage runs after audio/video reach 100% and before merge.
  //   Detected separately so the merge column can swap to an indeterminate
  //   "subtitle downloading" state instead of freezing at 100%.
  const hasSubtitleStage = progressEntries.some((p) => p.stage === 'subtitle')

  // Why: merge-stage cancellation is disabled because killing ffmpeg mid-merge
  // races with the final write and produces a contradictory (cancelled-but-
  // complete) display. Sibling guards: PartCompactCard only offers row-level
  // cancel while pending; cancel-all is blocked by OverallSummary.isMerging.
  const canCancel = (isPending || isDownloading) && !isInMergeStage && onCancel

  const handleOpenFile = useCallback(async () => {
    if (!outputPath) return
    await invoke('open_file', { path: outputPath }).catch((e) => {
      logger.error('Failed to open file', e)
    })
  }, [outputPath])

  const handleRevealInFolder = useCallback(async () => {
    if (!outputPath) return
    await invoke('reveal_in_folder', { path: outputPath }).catch((e) => {
      logger.error('Failed to reveal in folder', e)
    })
  }, [outputPath])

  if (
    !isPending &&
    !isDownloading &&
    !isComplete &&
    !hasError &&
    !isWaitingForTurn
  ) {
    return null
  }

  // Why: prefer the translated message for known backend codes; otherwise show
  // the raw error string. When no error is recorded, use the generic label.
  const mappedErrorKey = errorMessage ? mapBackendError(errorMessage) : null
  const errorText = mappedErrorKey
    ? t(mappedErrorKey)
    : (errorMessage ?? t('video.download_failed_part'))

  return (
    <div
      className={
        flat ? 'space-y-2' : 'bg-muted/50 mt-2 space-y-2 rounded-md p-1.5'
      }
    >
      {isComplete && (
        <div className={`flex ${MIN_HEIGHT} items-center justify-between`}>
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="h-5 w-5 text-green-500" />
            <span className="text-muted-foreground">
              {t('video.download_complete')}
            </span>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenFile}
              className="h-7 px-2 text-xs"
            >
              <FolderOpen className="mr-1 h-3 w-3" />
              {t('video.open_file')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRevealInFolder}
              className="h-7 px-2 text-xs"
            >
              <FolderOpen className="mr-1 h-3 w-3" />
              {t('video.open_folder')}
            </Button>
          </div>
        </div>
      )}

      {hasError && (
        <div className={`flex ${MIN_HEIGHT} items-center`}>
          <div className="text-destructive flex items-center gap-2 text-sm">
            <span>{errorText}</span>
          </div>
        </div>
      )}

      {isDownloading && (
        <div
          className={`text-muted-foreground ${MIN_HEIGHT} flex items-center gap-x-3 text-xs`}
        >
          {/* Audio/merge stages: visible when !hasEmbeddedAudio, fade out on
              transition. isAudioHidden removes from layout after animation. */}
          <div
            className={`flex flex-1 gap-x-3 transition-opacity duration-300 ${
              isAudioHidden ? 'hidden' : ''
            } ${isFadingOut ? 'opacity-0' : 'opacity-100'}`}
          >
            <div className="flex-1">
              <StageProgress
                icon="🔊"
                labelKey="video.stage_audio"
                progressEntries={progressEntries}
                stageName="audio"
                t={t}
                startingIndicator={startingIndicator}
              />
            </div>
            <div className="flex-1">
              <StageProgress
                icon="🎬"
                labelKey="video.stage_video"
                progressEntries={progressEntries}
                stageName="video"
                t={t}
                startingIndicator={startingIndicator}
              />
            </div>
            <div className="flex-1">
              {hasSubtitleStage ? (
                <SubtitleStageProgress t={t} />
              ) : (
                <MergeStageProgress progressEntries={progressEntries} t={t} />
              )}
            </div>
          </div>
          {/* Video-only stage: visible when hasEmbeddedAudio and not fading */}
          {hasEmbeddedAudio && !isFadingOut && (
            <>
              <div className="flex-1">
                <StageProgress
                  icon="🎬"
                  labelKey="video.stage_video"
                  progressEntries={progressEntries}
                  stageName="video"
                  t={t}
                  startingIndicator={startingIndicator}
                />
              </div>
              <div className="flex-1" />
              <div className="flex-1">
                {hasSubtitleStage && <SubtitleStageProgress t={t} />}
              </div>
            </>
          )}

          {canCancel && (
            <Tooltip>
              <TooltipTrigger asChild>
                <IconButton
                  variant="ghost"
                  // Constraint: xs resolves to size-7 (28px), the max height any
                  //   in-row control may take so the row stays at MIN_HEIGHT.
                  //   Bumping to sm (size-8 = 32px) would grow the row and
                  //   reintroduce the state-change height jump (see MIN_HEIGHT
                  //   @why; variants in animate-ui/components/buttons/icon.tsx).
                  size="xs"
                  onClick={onCancel}
                  className="text-muted-foreground hover:text-destructive shrink-0"
                >
                  <CircleX animateOnHover />
                </IconButton>
              </TooltipTrigger>
              <TooltipContent side="top" arrow>
                {t('video.cancel_download')}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      )}

      {isCancelling && (
        <div
          className={`text-muted-foreground ${MIN_HEIGHT} flex items-center gap-2 text-sm`}
        >
          <div className="h-2 w-2 animate-pulse rounded-full bg-current" />
          <span>{t('video.download_cancelling')}</span>
        </div>
      )}

      {/* @why: Prefer isComplete. When cancel-all lands right after a merge
          finishes, status becomes 'cancelled' but the file is actually
          complete, so the "complete" view is accurate. Showing both is
          contradictory. */}
      {isCancelled && !isComplete && (
        <div
          className={`text-muted-foreground ${MIN_HEIGHT} flex items-center text-sm`}
        >
          <span>{t('video.download_cancelled')}</span>
        </div>
      )}

      {(isPending || isWaitingForTurn) && !isCancelling && (
        <div
          className={`text-muted-foreground ${MIN_HEIGHT} flex items-center gap-2 text-sm`}
        >
          <div className="h-2 w-2 animate-pulse rounded-full bg-current" />
          <span>{t('video.download_pending')}</span>
          {onCancel && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancel}
              className="text-muted-foreground hover:text-destructive ml-auto h-7 px-2 text-xs"
            >
              <CircleX animateOnHover className="size-4" />
              {t('actions.cancel')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
