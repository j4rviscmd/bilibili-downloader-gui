import { type RootState, useAppDispatch, useSelector } from '@/app/store'
import { useVideoInfo } from '@/features/video/hooks/useVideoInfo'
import { resetInput } from '@/features/video/model/inputSlice'
import { resetVideo } from '@/features/video/model/videoSlice'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/animate-ui/radix/dialog'
import { clearError } from '@/shared/downloadStatus/downloadStatusSlice'
import { clearProgress } from '@/shared/progress/progressSlice'
import { Button } from '@/shared/ui/button'
import CircleIndicator from '@/shared/ui/CircleIndicator'
import ProgressStatusBar, { type Progress } from '@/shared/ui/Progress'
import { Download, Music, Play, Video } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * Determines the label and icon for a progress bar based on download stage.
 *
 * @param id - Download ID (for temp stage detection)
 * @param stage - Download stage ('audio', 'video', 'merge')
 * @param t - Translation function
 * @returns A tuple of [label, icon]
 */
const getBarInfo = (
  id: string | undefined,
  stage: string | undefined,
  t: (k: string) => string,
) => {
  const key = stage || id
  let label = ''
  let icon: React.ReactNode = null

  switch (key) {
    case 'audio':
    case 'temp_audio':
      label = t('video.bar_audio')
      icon = <Music size={13} />
      break
    case 'video':
    case 'temp_video':
      label = t('video.bar_video')
      icon = <Video size={13} />
      break
    case 'merge':
      label = t('video.bar_merge')
      icon = <Play size={13} />
      break
  }

  return [label, icon]
}

/**
 * Modal dialog displaying download progress.
 *
 * Shows real-time progress for all active downloads with:
 * - Grouped progress bars by parent ID (multi-part downloads)
 * - Separate bars for audio, video, and merge stages
 * - Queue waiting list for parts not yet started
 * - Error display with reload prompt
 * - Completion button to reload the page
 *
 * The dialog is modal and cannot be closed until downloads complete or error.
 *
 * @example
 * ```tsx
 * <DownloadingDialog />
 * ```
 */
function DownloadingDialog() {
  const { progress, input, video } = useVideoInfo()
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  /**
   * Derives the display title for a progress entry.
   * For multi-part downloads (pattern: -p{number}), returns the part title.
   * For single downloads, returns the video title.
   *
   * @param p - Progress entry to derive title from
   * @returns The derived title or undefined if not found
   */
  const deriveTitle = (p: Progress): string | undefined => {
    const m = p.downloadId.match(/-p(\d+)$/)
    if (m) {
      const idx = parseInt(m[1], 10) - 1
      return input.partInputs[idx]?.title
    }
    return video?.title
  }

  /**
   * Resets all download-related state when user closes the dialog.
   * Clears input, video info, progress, and error states.
   */
  const onClick = () => {
    dispatch(resetInput())
    dispatch(resetVideo())
    dispatch(clearProgress())
    dispatch(clearError())
  }

  const hasDlQue = progress.length > 0

  // Group progress entries by parentId for multi-part downloads
  // Entries without parentId use their downloadId as the group key
  const groups = progress.reduce<Record<string, Progress[]>>((acc, p) => {
    const parent = p.parentId || p.downloadId
    if (!acc[parent]) acc[parent] = []
    acc[parent].push(p)
    return acc
  }, {})

  // Extract active page numbers from progress entries (pattern: -p{number})
  const activePages = new Set(
    Object.values(groups)
      .flatMap((entries) => entries)
      .map((p) => p.downloadId.match(/-p(\d+)$/)?.[1])
      .filter((page): page is string => page !== undefined)
      .map(Number),
  )

  // Filter parts that are selected but not yet in progress (waiting in queue)
  const notInProgress = input.partInputs.filter(
    (part) => part.selected && !activePages.has(part.page),
  )

  const phaseOrder = ['audio', 'video', 'merge']

  // Filter to only active stages (exclude complete stage for downloading state)
  const activeStages = progress.filter((p) =>
    ['audio', 'video', 'merge'].includes(p.stage || ''),
  )

  const { hasError, errorMessage } = useSelector(
    (s: RootState) => s.downloadStatus,
  )

  // Determine if download is still in progress
  // Error state takes precedence to enable the reload button immediately
  const isDownloading =
    !hasError &&
    (activeStages.some((p) => !p.isComplete) || notInProgress.length > 0)

  return (
    <Dialog modal open={hasDlQue}>
      <DialogContent
        disableOutsideClick
        onEscapeKeyDown={(e) => e.preventDefault()}
        className="bg-card flex max-h-[80%] flex-col items-center justify-center rounded-xl border [&>button]:hidden"
      >
        <DialogHeader className="w-full">
          <DialogTitle className="text-primary flex w-full items-center font-display">
            <Download size={18} className="mr-2" />
            <span className="text-lg">{t('video.progress_title')}</span>
          </DialogTitle>
          <DialogDescription hidden />
        </DialogHeader>
        <div className="flex h-full w-full flex-col items-center overflow-auto">
          {hasDlQue &&
            Object.entries(groups).map(([parentId, entries]) => {
              const sorted = [...entries].sort((a: Progress, b: Progress) => {
                const ai = a.stage ? phaseOrder.indexOf(a.stage) : -1
                const bi = b.stage ? phaseOrder.indexOf(b.stage) : -1
                return ai - bi
              })
              const firstActive = sorted.find(
                (p: Progress) => p.stage && p.stage !== 'complete',
              )
              const groupTitle = firstActive
                ? deriveTitle(firstActive)
                : (video?.title ?? '')

              return (
                <div
                  key={parentId}
                  className="bg-card hover:border-border/80 mb-3 w-full rounded-lg border px-3 py-3 transition-colors duration-200"
                >
                  {groupTitle && (
                    <div
                      className="text-md mb-2 truncate px-2 leading-tight font-semibold"
                      title={groupTitle}
                    >
                      {groupTitle}
                    </div>
                  )}
                  {sorted.map((p: Progress) => {
                    const [barLabel, barIcon] = getBarInfo(
                      p.downloadId,
                      p.stage,
                      t,
                    )
                    const key = p.internalId || `${p.downloadId}:${p.stage}`
                    if (!p.stage || p.stage === 'complete') return null
                    return (
                      <div
                        key={key}
                        className="text-accent-foreground box-border w-full px-2"
                      >
                        <div className="flex items-center mb-2">
                          <span className="mr-2">{barIcon}</span>
                          <span className="font-medium">{barLabel}</span>
                        </div>
                        <div className="px-2">
                          {p.stage === 'merge' ? (
                            <div className="flex items-center justify-between text-sm py-1">
                              <span>{t('video.bar_merge')}</span>
                              {!p.isComplete && <CircleIndicator r={10} />}
                              {p.isComplete && (
                                <span className="text-green-500 font-medium">
                                  {t('video.completed')}
                                </span>
                              )}
                            </div>
                          ) : (
                            <ProgressStatusBar progress={p} />
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          {notInProgress.map((part) => (
            <div
              key={part.page}
              className="bg-card hover:border-border/80 mb-3 w-full rounded-lg border px-3 py-3 transition-colors duration-200"
            >
              <div
                className="text-md mb-1 truncate px-2 leading-tight font-semibold"
                title={part.title}
              >
                <span className="pr-1">{t('video.queue_waiting_prefix')}</span>
                <span>{part.title}</span>
              </div>
            </div>
          ))}
        </div>

        {hasError && (
          <div
            role="alert"
            aria-live="polite"
            className="border-destructive/50 bg-destructive/10 text-destructive mb-4 w-full rounded-lg border px-4 py-3 text-sm"
          >
            <div className="mb-1 font-semibold">
              {t('video.download_failed')}
            </div>
            <div className="truncate" title={errorMessage || ''}>
              {errorMessage}
            </div>
            <div className="text-muted-foreground mt-2 text-xs">
              {t('video.reload_after_error')}
            </div>
          </div>
        )}
        <div>
          <Button
            disabled={isDownloading}
            onClick={onClick}
            className="h-11 px-6"
          >
            {isDownloading ? (
              <CircleIndicator r={10} />
            ) : hasError ? (
              t('video.reload_after_error')
            ) : (
              t('video.download_completed')
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default DownloadingDialog
