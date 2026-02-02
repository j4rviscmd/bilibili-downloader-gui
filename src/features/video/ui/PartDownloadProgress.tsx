import { Button } from '@/shared/ui/button'
import { invoke } from '@tauri-apps/api/core'
import { CheckCircle2, Download, FolderOpen, RotateCcw } from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { PartDownloadStatus } from '../hooks/usePartDownloadStatus'

/**
 * Formats transfer rate for display.
 */
function formatTransferRate(kb: number): string {
  if (kb >= 1000) {
    return `${(kb / 1024).toFixed(1)}MB/s`
  }
  return `${kb.toFixed(0)}KB/s`
}

type StageProgressViewProps = {
  stage: 'audio' | 'video' | 'merge'
  progressEntries: PartDownloadStatus['progressEntries']
  t: (key: string) => string
}

function StageProgressView({
  stage,
  progressEntries,
  t,
}: StageProgressViewProps) {
  const progress = progressEntries.find((p) => p.stage === stage)

  if (stage === 'merge') {
    const audioProgress = progressEntries.find((p) => p.stage === 'audio')
    const videoProgress = progressEntries.find((p) => p.stage === 'video')
    const audioComplete = audioProgress && audioProgress.percentage >= 100
    const videoComplete = videoProgress && videoProgress.percentage >= 100

    if (progress) {
      return (
        <div className="flex min-h-[33px] items-center gap-1">
          <span className="font-medium">
            🔄 {t('video.stage_merge')}
          </span>
          <span>{progress.percentage.toFixed(0)}%</span>
        </div>
      )
    }

    if (audioComplete && videoComplete) {
      return (
        <div className="flex min-h-[33px] items-center gap-1">
          <span className="font-medium">
            🔄 {t('video.stage_merge')}
          </span>
          <span>{t('video.stage_merging')}</span>
        </div>
      )
    }

    if (audioProgress || videoProgress) {
      return (
        <div className="flex min-h-[33px] items-center">
          🔄 {t('video.stage_merge')}: {t('video.stage_waiting')}
        </div>
      )
    }
    return null
  }

  // Audio or Video stage
  const emoji = stage === 'audio' ? '🔊' : '🎬'

  if (progress) {
    return (
      <div className="flex min-h-[33px] items-center gap-1">
        <span className="font-medium">
          {emoji} {t(`video.stage_${stage}`)}
        </span>
        <span>{progress.percentage.toFixed(0)}%</span>
        <span>{formatTransferRate(progress.transferRate || 0)}</span>
        {progress.filesize != null && (
          <span>
            {progress.downloaded?.toFixed(1) ?? '0'}mb/
            {progress.filesize.toFixed(1)}mb
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="flex min-h-[33px] items-center">
      {emoji} {t(`video.stage_${stage}`)}: {t('video.stage_waiting')}
    </div>
  )
}

/**
 * Props for PartDownloadProgress component.
 */
type Props = {
  /** Download status for this part */
  status: PartDownloadStatus
  /** Whether this part is waiting for its turn in the queue */
  isWaitingForTurn?: boolean
  /** Callback for redownload */
  onRedownload: () => void
  /** Callback for retry on error */
  onRetry: () => void
}

/**
 * Component displaying download progress for a video part.
 *
 * Shows different states:
 * - Pending: Grayed progress bar with "Waiting..."
 * - Running: Progress bar with percentage, speed, and time remaining
 * - Done: Green checkmark with action buttons (open file/folder, redownload)
 * - Error: Error message with retry button
 */
export function PartDownloadProgress({
  status,
  isWaitingForTurn = false,
  onRedownload,
  onRetry,
}: Props) {
  const { t } = useTranslation()
  const {
    isPending,
    isDownloading,
    isComplete,
    hasError,
    errorMessage,
    outputPath,
    downloadId,
    progressEntries,
    filename,
  } = status

  const handleOpenFile = useCallback(async () => {
    if (!outputPath) return
    try {
      await invoke('open_file', { path: outputPath })
    } catch (e) {
      console.error('Failed to open file:', e)
    }
  }, [outputPath])

  const handleRevealInFolder = useCallback(async () => {
    if (!outputPath) return
    try {
      await invoke('reveal_in_folder', { path: outputPath })
    } catch (e) {
      console.error('Failed to reveal in folder:', e)
    }
  }, [outputPath])

  const handleRedownload = useCallback(() => {
    if (!downloadId || !filename) return

    // Trigger redownload via callback (parent will handle queue cleanup)
    onRedownload()
  }, [downloadId, filename, onRedownload])

  // No download in progress
  if (
    !isPending &&
    !isDownloading &&
    !isComplete &&
    !hasError &&
    !isWaitingForTurn
  ) {
    return null
  }

  return (
    <div className="bg-muted/50 mt-2 space-y-2 rounded-md p-2">
      {/* Complete View - highest priority */}
      {isComplete && (
        <div className="flex min-h-[33px] items-center justify-between">
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
              className="h-8 px-2 text-xs"
            >
              <FolderOpen className="mr-1 h-3 w-3" />
              {t('video.open_file')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRevealInFolder}
              className="h-8 px-2 text-xs"
            >
              <FolderOpen className="mr-1 h-3 w-3" />
              {t('video.open_folder')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRedownload}
              className="h-8 px-2 text-xs"
            >
              <Download className="mr-1 h-3 w-3" />
              {t('video.redownload')}
            </Button>
          </div>
        </div>
      )}

      {/* Error View - second priority */}
      {hasError && (
        <div className="flex min-h-[33px] items-center justify-between">
          <div className="text-destructive flex items-center gap-2 text-sm">
            <span>{errorMessage || t('video.download_failed_part')}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            className="h-8 px-2 text-xs"
          >
            <RotateCcw className="mr-1 h-3 w-3" />
            {t('video.retry')}
          </Button>
        </div>
      )}

      {/* Running View - third priority */}
      {isDownloading && (
        <div className="text-muted-foreground grid min-h-[33px] grid-cols-1 gap-x-2 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
          <StageProgressView
            stage="audio"
            progressEntries={progressEntries}
            t={t}
          />
          <StageProgressView
            stage="video"
            progressEntries={progressEntries}
            t={t}
          />
          <StageProgressView
            stage="merge"
            progressEntries={progressEntries}
            t={t}
          />
        </div>
      )}

      {/* Pending View - lowest priority */}
      {(isPending || isWaitingForTurn) && (
        <div className="text-muted-foreground flex min-h-[33px] items-center gap-2 text-sm">
          <div className="h-2 w-2 animate-pulse rounded-full bg-current" />
          <span>{t('video.download_pending')}</span>
        </div>
      )}
    </div>
  )
}
