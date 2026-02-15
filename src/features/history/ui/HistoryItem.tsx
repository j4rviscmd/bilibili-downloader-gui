'use client'

import { useThumbnailCache } from '@/features/history'
import type { HistoryEntry } from '@/features/history/model/historySlice'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/animate-ui/radix/tooltip'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { Check, Copy, Download, RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

/**
 * Pads a number with leading zeros to ensure 2-digit formatting.
 *
 * @param n - The number to pad (0-99)
 * @returns Two-digit string with leading zero if needed
 *
 * @example
 * ```ts
 * pad(5)  // "05"
 * pad(12) // "12"
 * ```
 */
const pad = (n: number): string => n.toString().padStart(2, '0')

/**
 * Formats duration in seconds to MM:SS or HH:MM:SS format.
 */
function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60

  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(secs)}`
  }
  return `${minutes}:${pad(secs)}`
}

/**
 * Formats an ISO 8601 date string to a relative time string.
 *
 * @param dateString - ISO 8601 date string
 * @param t - Translation function
 * @returns Relative time string (e.g., "3分前", "Just now")
 */
function formatRelativeTime(
  dateString: string,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const now = Date.now()
  const date = new Date(dateString)
  const diff = now - date.getTime()

  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return t('watchHistory.time.daysAgo', { count: days })
  if (hours > 0) return t('watchHistory.time.hoursAgo', { count: hours })
  if (minutes > 0) return t('watchHistory.time.minutesAgo', { count: minutes })
  return t('watchHistory.time.justNow')
}

/**
 * Formats an ISO 8601 date string to a short absolute format.
 *
 * @param dateString - ISO 8601 date string
 * @returns Short date string (e.g., "2026/02/15 14:28")
 */
function formatAbsoluteDate(dateString: string): string {
  const date = new Date(dateString)
  const month = date.getMonth() + 1
  const day = date.getDate()
  const hour = date.getHours()
  const minute = date.getMinutes()
  return `${date.getFullYear()}/${pad(month)}/${pad(day)} ${pad(hour)}:${pad(minute)}`
}

/** Bytes per kilobyte */
const KB = 1000
/** Bytes per megabyte */
const MB = 1_000_000

/**
 * Formats a byte count to a human-readable file size string.
 *
 * @param bytes - File size in bytes
 * @returns Formatted string (e.g., "1.5 MB", "500 KB", "-")
 */
function formatFileSize(bytes?: number): string {
  if (!bytes) return '-'
  if (bytes < KB) return `${bytes} B`
  if (bytes < MB) return `${(bytes / KB).toFixed(1)} KB`
  return `${(bytes / MB).toFixed(1)} MB`
}

/**
 * Thumbnail placeholder component.
 *
 * Displays a download icon when no thumbnail is available or loading.
 */
const ThumbnailPlaceholder = () => (
  <div className="text-muted-foreground flex size-full items-center justify-center">
    <Download size={32} />
  </div>
)

/**
 * Props for the HistoryItem component.
 *
 * @property entry - The history entry data to display
 * @property onDelete - Callback function invoked when the delete button is clicked
 */
type Props = {
  entry: HistoryEntry
  onDelete: () => void
}

/**
 * Single history entry component.
 *
 * @example
 * ```tsx
 * <HistoryItem
 *   entry={historyEntry}
 *   onDelete={() => handleDelete(historyEntry.id)}
 * />
 * ```
 */
function HistoryItem({ entry, onDelete }: Props) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  // Data URLs can be used directly; fetch remote thumbnails via cache
  const thumbnailUrl = entry.thumbnailUrl
  const isDataUrl = thumbnailUrl?.startsWith('data:')

  const {
    data: cachedThumbnail,
    loading: thumbnailLoading,
    error,
    retry,
  } = useThumbnailCache(isDataUrl ? undefined : thumbnailUrl)

  const displayThumbnail = isDataUrl ? thumbnailUrl : cachedThumbnail

  /**
   * Copies the video URL to the clipboard.
   *
   * Shows a success toast notification and temporarily changes the copy button
   * icon to a checkmark for 2 seconds. If clipboard access fails, shows an
   * error toast notification.
   *
   * @async
   */
  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(entry.url)
      setCopied(true)
      toast.success(t('history.copySuccess'))
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error(t('history.copyFailed'))
    }
  }

  const isSuccess = entry.status === 'completed'

  return (
    <div className="border-border hover:bg-accent/50 group flex items-center gap-3 rounded-lg border p-3 transition-colors">
      <div className="bg-muted relative flex size-20 shrink-0 items-center justify-center overflow-hidden rounded select-none">
        {thumbnailLoading ? (
          <ThumbnailPlaceholder />
        ) : displayThumbnail ? (
          <img
            src={displayThumbnail}
            alt={entry.title}
            className="size-full object-cover"
            draggable={false}
          />
        ) : (
          <ThumbnailPlaceholder />
        )}
        {entry.duration && (
          <div className="absolute right-0.5 bottom-1 rounded bg-black/60 px-1 text-xs text-white">
            {formatDuration(entry.duration)}
          </div>
        )}
        {error && (
          <button
            onClick={retry}
            className="bg-background/80 hover:bg-background absolute rounded p-1 opacity-0 transition-opacity group-hover:opacity-100"
            title={t('history.retryThumbnail')}
          >
            <RefreshCw size={16} />
          </button>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1 overflow-hidden">
        <div className="flex items-center gap-2">
          <h3 className="min-w-0 flex-1 truncate font-semibold">
            {entry.title}
          </h3>
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-xs font-medium',
              isSuccess
                ? 'bg-chart-2/10 text-chart-2'
                : 'bg-destructive/10 text-destructive',
            )}
          >
            {t(isSuccess ? 'history.filterSuccess' : 'history.filterFailed')}
          </span>
        </div>

        {/* URL with copy button */}
        <div className="flex items-center gap-2 text-xs">
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:bg-muted size-6 shrink-0"
            onClick={handleCopyUrl}
            title={t('history.copyUrl')}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </Button>
          <a
            href={entry.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-primary truncate"
          >
            {entry.url}
          </a>
        </div>

        {/* Metadata row: filename | date | size | quality */}
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs">
          {entry.filename && (
            <>
              <span className="truncate max-w-[200px]">{entry.filename}</span>
              <span aria-hidden="true">•</span>
            </>
          )}
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-default">
                  {formatRelativeTime(entry.downloadedAt, t)}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" arrow>
                {formatAbsoluteDate(entry.downloadedAt)}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {entry.fileSize && (
            <>
              <span aria-hidden="true">•</span>
              <span>{formatFileSize(entry.fileSize)}</span>
            </>
          )}
          {entry.quality && (
            <>
              <span aria-hidden="true">•</span>
              <span>{entry.quality}</span>
            </>
          )}
        </div>

        {entry.status === 'failed' && entry.errorMessage && (
          <p className="text-destructive mt-1 text-xs">{entry.errorMessage}</p>
        )}
      </div>

      <Button
        variant="ghost"
        size="icon"
        onClick={onDelete}
        title={t('history.deleteConfirm')}
        className="text-destructive hover:bg-destructive/10"
      >
        <Trash2 size={18} />
      </Button>
    </div>
  )
}

export default HistoryItem
