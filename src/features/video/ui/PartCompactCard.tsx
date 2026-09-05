import { IconButton } from '@/components/animate-ui/components/buttons/icon'
import { CircleX } from '@/components/animate-ui/icons/circle-x'
import { getStatusVisual } from '@/features/video/lib/statusVisual'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/shared/animate-ui/radix/tooltip'
import { logger } from '@/shared/lib/logger'
import { mapBackendError } from '@/shared/lib/mapBackendError'
import { cn } from '@/shared/lib/utils'
import { invoke } from '@tauri-apps/api/core'
import { FolderOpen, ImageOff } from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import type { PartDownloadStatus } from '../hooks/usePartDownloadStatus'
import { pickStageData } from '../model/downloadProgress'
import { AnimatedSection } from './AnimatedSection'
import { PartDownloadProgress } from './PartDownloadProgress'

type Props = {
  /** 1-based part number shown as P{n} */
  page: number
  /** Part title (filename input value, falls back to the part name) */
  title: string
  /** Thumbnail URL of the part ('' when unavailable) */
  thumbnailUrl: string
  /** Per-part download status from usePartDownloadStatus */
  status: PartDownloadStatus
  /** Whether this part belongs to the in-flight download session */
  isQueued: boolean
  /** True when this is the part the expander auto-follows (the active part) */
  isActive: boolean
  /** True if audio is embedded (durl format), forwarded to the detail view */
  hasEmbeddedAudio: boolean
  /** Opens the part in the browser — same behavior as the full card */
  onThumbnailClick: () => void
  /** cancelDownload + deselect wiring from VideoPartCard */
  onCancel: () => void
}

/**
 * Compact single-line row replacing the full VideoPartCard body while a
 * download session is active (issue #569).
 *
 * - All parts collapse to this row; the active part additionally expands
 *   the existing PartDownloadProgress detail below it.
 * - State is never carried by motion alone: dot color + status label +
 *   percentage text remain when animations are disabled.
 * - Rows are non-interactive by design — open/close is locked during a
 *   download session (auto-follow); the only interactive controls are the
 *   pending-row cancel and the detail view's own cancel button.
 */
export function PartCompactCard({
  page,
  title,
  thumbnailUrl,
  status,
  isQueued,
  isActive,
  hasEmbeddedAudio,
  onThumbnailClick,
  onCancel,
}: Props) {
  const { t } = useTranslation()

  // Mirror selectPartStatusRows' isComplete→done override so a cancel that
  // lands right after a finished merge reads as "done", not "cancelled".
  const effectiveStatus = status.isComplete
    ? 'done'
    : (status.status ?? 'pending')
  const visual = getStatusVisual(effectiveStatus)
  const isDownloading = effectiveStatus === 'running'
  const isPending = effectiveStatus === 'pending'
  const isError = effectiveStatus === 'error'
  const isCancelled = effectiveStatus === 'cancelled'
  const isDone = effectiveStatus === 'done'

  // Completed-row quick actions — same invokes as the full card's
  // PartDownloadProgress complete block, so both surfaces stay in parity.
  const handleOpenFile = useCallback(async () => {
    if (!status.outputPath) return
    await invoke('open_file', { path: status.outputPath }).catch((e) => {
      logger.error('Failed to open file', e)
    })
  }, [status.outputPath])

  const handleRevealInFolder = useCallback(async () => {
    if (!status.outputPath) return
    await invoke('reveal_in_folder', { path: status.outputPath }).catch((e) => {
      logger.error('Failed to reveal in folder', e)
    })
  }, [status.outputPath])
  // Pending parts are cancellable before their turn; the running part's
  // cancel lives in the expanded PartDownloadProgress (merge-stage guard
  // included there). Cancelling/cancelled/done rows are not.
  const canCancel = isPending && isQueued

  const rep = pickStageData(status.progressEntries)
  const pct = Math.min(100, Math.round(rep.percentage))

  // Only queued parts show a known backend error message; fall back to the
  // generic label otherwise.
  const mappedErrorKey =
    isError && status.errorMessage ? mapBackendError(status.errorMessage) : null

  return (
    <div
      className={cn(
        // Uniform horizontal padding on EVERY row (active or not) so all
        // rows' content shares one x-position — the active box then sits
        // flush with the content column edges with no overhang and no
        // per-row offset.
        'flex flex-col gap-1 px-2 text-sm',
        // One unified area for the active part: the highlight wraps the
        // header row AND the expanded detail, with pb-1.5 so the detail
        // breathes above the box's bottom edge.
        isActive && 'bg-primary/5 ring-primary/5 rounded-lg pb-1.5 ring-1',
      )}
    >
      <div className="flex items-center gap-2 py-0.5">
        {/* Thumbnail: shown for session parts so each row stays visually
            identifiable at a glance. Small (same 3:2 crop as the full card's
            h-16 w-24); placeholder keeps non-target rows aligned. */}
        {thumbnailUrl ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <img
                src={thumbnailUrl}
                alt={t('video.thumbnail_alt', { part: title })}
                loading="lazy"
                referrerPolicy="no-referrer"
                onClick={onThumbnailClick}
                className="h-8 w-12 shrink-0 cursor-pointer rounded-md object-cover"
              />
            </TooltipTrigger>
            <TooltipContent side="top">
              <p className="text-sm">{t('video.open_in_browser')}</p>
            </TooltipContent>
          </Tooltip>
        ) : (
          <div className="bg-muted flex h-8 w-12 shrink-0 items-center justify-center rounded-md">
            <ImageOff className="text-muted-foreground/50 size-3.5" />
          </div>
        )}
        {isQueued ? (
          <span
            className={cn(
              'size-2 shrink-0 rounded-full',
              visual.dotClass,
              isDownloading && 'animate-pulse',
            )}
          />
        ) : (
          // Non-target parts: keep the dot column empty so queued and
          // non-queued rows stay vertically aligned.
          <span className="size-2 shrink-0" aria-hidden="true" />
        )}
        <span className="text-muted-foreground w-8 shrink-0 text-xs font-medium tabular-nums">
          P{page}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={cn(
                'min-w-0 flex-1 cursor-default truncate',
                isCancelled && 'text-muted-foreground line-through',
                !isQueued && 'text-muted-foreground',
              )}
            >
              {title}
            </span>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            align="start"
            // CAUTION: align="start" moves the tooltip to the trigger's left
            // edge, but Radix keeps the arrow pointing at the trigger center.
            // Pin the arrow to the content's left edge so it points at the
            // title's start (same trick as the former dialog rows).
            className="max-w-lg break-all [&>span]:!left-3"
          >
            {title}
          </TooltipContent>
        </Tooltip>
        {/* Right slot: percentage while running, status label otherwise.
            Non-target parts show nothing here — they are not part of the
            session. */}
        {isQueued && (
          <span className="flex shrink-0 items-center gap-2">
            {/* Completed rows: open-file / reveal-folder quick actions to
                the left of the done label (mirrors the full card's complete
                block, available while the session is still running and the
                cards stay compact). */}
            {isDone && status.outputPath && (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <IconButton
                      variant="ghost"
                      size="sm"
                      onClick={handleOpenFile}
                      className="text-muted-foreground hover:text-foreground size-5 shrink-0 p-0"
                    >
                      <FolderOpen className="size-3.5" />
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
                      size="sm"
                      onClick={handleRevealInFolder}
                      className="text-muted-foreground hover:text-foreground size-5 shrink-0 p-0"
                    >
                      <FolderOpen className="size-3.5" />
                    </IconButton>
                  </TooltipTrigger>
                  <TooltipContent side="top" arrow>
                    {t('video.open_folder')}
                  </TooltipContent>
                </Tooltip>
              </>
            )}
            {isDownloading ? (
              <span className="text-xs font-medium tabular-nums">{pct}%</span>
            ) : isError ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-destructive cursor-default text-xs">
                    {t(visual.labelKey)}
                  </span>
                </TooltipTrigger>
                {mappedErrorKey && (
                  <TooltipContent side="top" className="max-w-sm break-all">
                    {t(mappedErrorKey)}
                  </TooltipContent>
                )}
              </Tooltip>
            ) : (
              <span className="text-muted-foreground text-xs">
                {t(visual.labelKey)}
              </span>
            )}
            {canCancel && (
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
          </span>
        )}
        {/* Screen-reader status text: the dot carries state visually, so
            mirror it as text for assistive tech (state must not rely on
            color alone). */}
        {isQueued && <span className="sr-only">{t(visual.labelKey)}</span>}
      </div>
      {/* Active-part expander: the existing per-part progress detail.
          App-driven (no user toggle) — the shared height-collapse section
          is the whole mechanism. */}
      <AnimatedSection show={isActive}>
        <PartDownloadProgress
          status={status}
          onCancel={onCancel}
          hasEmbeddedAudio={hasEmbeddedAudio}
          flat
        />
      </AnimatedSection>
    </div>
  )
}
