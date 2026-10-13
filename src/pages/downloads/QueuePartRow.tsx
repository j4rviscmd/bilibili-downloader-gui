import { useAppDispatch } from '@/app/store'
import { IconButton } from '@/components/animate-ui/components/buttons/icon'
import {
  AUDIO_QUALITIES_MAP,
  VIDEO_QUALITIES_MAP,
} from '@/features/video/lib/constants'
import { getStatusVisual } from '@/features/video/lib/statusVisual'
import {
  PartDownloadProgress,
  type PartDownloadStatus,
} from '@/features/video/ui/PartDownloadProgress'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/shared/animate-ui/radix/tooltip'
import { logger } from '@/shared/lib/logger'
import type { QueuePartRow } from '@/shared/queue'
import { cancelDownload } from '@/shared/queue'
import { Button } from '@/shared/ui/button'
import { invoke } from '@tauri-apps/api/core'
import { FilePlay, FolderOpen, ImageOff } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/** Status badge carried by each part row (E2E anchor via data-status). */
export function QueueStatusBadge({
  status,
}: {
  status: QueuePartRow['status']
}) {
  const { t } = useTranslation()
  const visual = getStatusVisual(status)
  return (
    <span
      data-status={status}
      className="bg-muted inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium"
    >
      <span
        className={`size-1.5 rounded-full ${visual.dotClass}`}
        aria-hidden
      />
      {t(visual.labelKey)}
    </span>
  )
}

/**
 * Part-row title: truncates with an ellipsis by default; on hover, ONLY
 * when actually truncated, ping-pong scrolls the hidden overflow
 * (marquee) — replaces the former full-title tooltip (verification
 * decision: the tooltip duplicated what a marquee reveals in place).
 */
function MarqueeTitle({ title }: { title: string }) {
  const innerRef = useRef<HTMLSpanElement>(null)
  const [running, setRunning] = useState(false)
  const [dist, setDist] = useState(0)

  const startIfTruncated = () => {
    const el = innerRef.current
    if (!el) return
    const hidden = el.scrollWidth - el.clientWidth
    if (hidden > 1) {
      setDist(hidden)
      setRunning(true)
    }
  }

  // ~45px/s, min 0.8s per direction so short overflows stay readable.
  const duration = Math.max(0.8, dist / 45)

  return (
    <span
      className="block min-w-0 flex-1 overflow-hidden"
      onMouseEnter={startIfTruncated}
      onMouseLeave={() => setRunning(false)}
    >
      <span
        ref={innerRef}
        // No ellipsis: the hover marquee reveals the hidden overflow, so a
        // "..." would only duplicate what scrolling shows (parent clips).
        className="block whitespace-nowrap"
        style={
          running
            ? {
                animation: `queue-title-marquee ${duration}s linear infinite alternate`,
                ['--queue-marquee-dist' as string]: `${dist}px`,
              }
            : undefined
        }
      >
        {title}
      </span>
    </span>
  )
}

type Props = {
  row: QueuePartRow
  /** 1-based position of this row within its section (drain order). */
  position: number
}

/**
 * One part row of the flat `/downloads` list (drain order).
 *
 * No P-number: it is session-relative, so a flat cross-session list would
 * show several "P1"s — the thumbnail and title identify the part.
 *
 * `data-status` keeps the E2E anchor name the abolished compact row used
 * (the row carries the status attribute itself here).
 */
export function QueuePartRow({ row, position }: Props) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const { item, status } = row

  const isComplete = row.progressEntries.some((p) => p.stage === 'complete')
  // Finished rows show the file name the backend actually wrote —
  // duplicate avoidance may append " (1)" and the title was sanitized,
  // so only this value matches what the user sees in Explorer. The final
  // ".mp4" extension is stripped for readability (every row is an mp4).
  // Falls back to the enqueue-time title until the invoke resolves
  // outputPath.
  // Note: split on both separators — Windows "\" and macOS "/" paths both
  // occur (pinned by the POSIX-separator case in index.test.tsx).
  const savedFileStem = item.outputPath
    ?.split(/[\\/]/)
    .pop()
    ?.replace(/\.[^.]+$/, '')
  const displayTitle =
    status === 'done' && savedFileStem ? savedFileStem : item.title

  // PartDownloadProgress consumes the hook's status shape; /downloads
  // resolves items by downloadId (not videoId+cid), so assemble the same
  // shape from the row model.
  const partStatus: PartDownloadStatus = {
    downloadId: item.downloadId,
    status,
    errorMessage: item.errorMessage,
    outputPath: item.outputPath,
    filename: item.title,
    progressEntries: row.progressEntries,
    isComplete,
    isDownloading: status === 'running' && !isComplete,
    isPending: status === 'pending',
    hasError: status === 'error',
    isCancelling: status === 'cancelling',
    isCancelled: status === 'cancelled',
  }

  const canCancel = ['pending', 'running'].includes(status)

  const handleCancel = () => {
    if (item.downloadId) dispatch(cancelDownload(item.downloadId))
  }

  // Finished rows inline their actions on the header line (verification
  // decision): the complete marker + open/reveal icon buttons ride next to
  // the badge instead of a second detail line, keeping finished rows
  // single-line.
  const handleOpenFile = useCallback(async () => {
    if (!item.outputPath) return
    await invoke('open_file', { path: item.outputPath }).catch((e) => {
      logger.error('Failed to open file', e)
    })
  }, [item.outputPath])

  const handleRevealInFolder = useCallback(async () => {
    if (!item.outputPath) return
    await invoke('reveal_in_folder', { path: item.outputPath }).catch((e) => {
      logger.error('Failed to reveal in folder', e)
    })
  }, [item.outputPath])

  // Actually-used quality (resolved by the backend; may differ from the
  // request via fallback): a muted pill left of the status badge.
  const qualityBadge = (() => {
    const vq = item.resolvedVideoQuality
    if (vq == null) return null
    const parts = [
      VIDEO_QUALITIES_MAP[vq] ?? String(vq),
      ...(item.resolvedAudioQuality != null
        ? [
            AUDIO_QUALITIES_MAP[item.resolvedAudioQuality] ??
              String(item.resolvedAudioQuality),
          ]
        : []),
    ]
    return (
      <span className="bg-muted text-muted-foreground inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums">
        {parts.join(' / ')}
      </span>
    )
  })()

  const finishedExtras =
    status === 'done' && item.outputPath ? (
      <span
        data-testid="part-download-complete"
        className="flex shrink-0 items-center gap-0.5"
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <IconButton
              variant="ghost"
              size="xs"
              onClick={handleOpenFile}
              aria-label={t('video.open_file')}
              className="text-muted-foreground hover:text-foreground"
            >
              <FilePlay className="size-3.5" />
            </IconButton>
          </TooltipTrigger>
          <TooltipContent side="top" arrow>
            {t('video.open_file')}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <IconButton
              variant="ghost"
              size="xs"
              onClick={handleRevealInFolder}
              aria-label={t('video.open_folder')}
              className="text-muted-foreground hover:text-foreground"
            >
              <FolderOpen className="size-3.5" />
            </IconButton>
          </TooltipTrigger>
          <TooltipContent side="top" arrow>
            {t('video.open_folder')}
          </TooltipContent>
        </Tooltip>
      </span>
    ) : null

  // Rounded hover surface: the row is the click/hover target (cancel,
  // open-file), so it gets its own affordance instead of relying on the
  // section card's plain background.
  return (
    <div className="hover:bg-accent/50 space-y-1 rounded-lg px-2 py-1.5 transition-colors">
      <div className="flex items-center gap-2 text-sm">
        {item.thumbnailUrl ? (
          <img
            src={item.thumbnailUrl}
            alt=""
            className="h-9 w-16 shrink-0 rounded-md object-cover"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="bg-muted flex h-9 w-16 shrink-0 items-center justify-center rounded-md">
            <ImageOff className="text-muted-foreground/50 h-4 w-4" />
          </div>
        )}
        {status === 'pending' && (
          /* Drain-order chip: the queue runs one item at a time, so this
             is the actual start order for waiting rows. */
          <span className="bg-muted text-muted-foreground inline-flex min-w-[26px] shrink-0 items-center justify-center rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums">
            #{position}
          </span>
        )}
        <MarqueeTitle title={displayTitle} />
        {qualityBadge}
        <QueueStatusBadge status={status} />
        {finishedExtras}
        {canCancel && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCancel}
            className="text-muted-foreground hover:text-destructive h-7 px-2 text-xs"
          >
            {t('actions.cancel')}
          </Button>
        )}
      </div>
      {/* Detail line only where it carries content: running stages and
          error messages. Finished rows inline their actions above; pending
          and cancelled rows are badge-only — a second empty-looking line
          wasted vertical space. suppressStatusLabels: the badge already
          states the status. */}
      {(status === 'running' || status === 'error') && (
        <PartDownloadProgress
          status={partStatus}
          hasEmbeddedAudio={
            item.expectedStages ? !item.expectedStages.audioStage : false
          }
          flat
          suppressStatusLabels
        />
      )}
      {/* Overall transfer bar for running rows: the row model's weighted
          percentage (audio+video+merge shares, computed by
          selectQueuePartRows) at a glance — the stage line above carries
          the exact per-stage numbers. */}
      {status === 'running' && (
        <div
          // Note: raw blue-500 (not a theme token) mirrors the downloading
          // section's accent in QueueSection.tsx TONES — running rows only
          // render inside that section; keep the two in sync.
          className="mx-2 h-0.5 overflow-hidden rounded-full bg-blue-500/15"
          aria-hidden
        >
          <div
            className="h-full rounded-full bg-blue-500"
            style={{ width: `${row.percentage}%` }}
          />
        </div>
      )}
    </div>
  )
}
