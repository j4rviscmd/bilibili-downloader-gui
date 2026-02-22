'use client'

import type { HistoryEntry } from '@/features/history/model/historySlice'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/animate-ui/radix/tooltip'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { Check, Copy, Download, ImageOff, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

/**
 * Pads a number with leading zeros to ensure 2-digit format.
 *
 * @param n - Number to pad
 * @returns Zero-padded string (e.g., 5 -> "05")
 */
const pad = (n: number): string => n.toString().padStart(2, '0')

/**
 * Formats a duration in seconds to MM:SS or HH:MM:SS format.
 *
 * @param seconds - Duration in seconds
 * @returns Formatted time string
 *
 * @example
 * ```typescript
 * formatDuration(125) // '2:05'
 * formatDuration(3661) // '1:01:01'
 * ```
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
 * @param t - Translation function from react-i18next
 * @returns Localized relative time string (e.g., "2 days ago")
 */
function formatRelativeTime(
  dateString: string,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const diffMs = Date.now() - new Date(dateString).getTime()
  const minutes = Math.floor(diffMs / 60_000)
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
 * @returns Formatted date string (e.g., "2026/02/15 14:28")
 */
function formatAbsoluteDate(dateString: string): string {
  const date = new Date(dateString)
  const month = date.getMonth() + 1
  const day = date.getDate()
  const hour = date.getHours()
  const minute = date.getMinutes()
  return `${date.getFullYear()}/${pad(month)}/${pad(day)} ${pad(hour)}:${pad(minute)}`
}

/**
 * Formats a byte count to a human-readable file size string.
 *
 * @param bytes - File size in bytes (optional)
 * @returns Formatted size string (e.g., "1.5 MB") or "-" if undefined
 */
function formatFileSize(bytes?: number): string {
  const KB = 1000
  const MB = 1_000_000
  if (!bytes) return '-'
  if (bytes < KB) return `${bytes} B`
  if (bytes < MB) return `${(bytes / KB).toFixed(1)} KB`
  return `${(bytes / MB).toFixed(1)} MB`
}

/**
 * Placeholder component displayed when thumbnail is unavailable.
 */
const ThumbnailPlaceholder = () => (
  <div className="text-muted-foreground flex size-full items-center justify-center">
    <ImageOff size={24} />
  </div>
)

/**
 * Props for the HistoryItem component.
 */
type Props = {
  /** History entry data to display */
  entry: HistoryEntry
  /** Callback invoked when the delete button is clicked */
  onDelete: () => void
  /** Callback invoked when the download button is clicked (optional) */
  onDownload?: () => void
  /** Whether the download button should be disabled */
  disabled?: boolean
}

/**
 * Displays a single download history entry with thumbnail, metadata, and actions.
 *
 * Shows video information including title, URL, download date, file size,
 * quality, and status. Supports re-downloading videos and deleting entries.
 *
 * @example
 * ```tsx
 * <HistoryItem
 *   entry={historyEntry}
 *   onDelete={() => handleDelete(entry.id)}
 *   onDownload={() => handleRedownload(entry)}
 *   disabled={isDownloading}
 * />
 * ```
 */
function HistoryItem({ entry, onDelete, onDownload, disabled }: Props) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const isSuccess = entry.status === 'completed'

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

  return (
    <div className="border-border hover:bg-accent/50 group flex items-center gap-3 rounded-lg border p-3 transition-colors">
      <div className="bg-muted relative flex size-20 shrink-0 items-center justify-center overflow-hidden rounded select-none">
        {entry.thumbnailUrl ? (
          <img
            src={entry.thumbnailUrl}
            alt={entry.title}
            className="size-full object-cover"
            draggable={false}
            referrerPolicy="no-referrer"
          />
        ) : (
          <ThumbnailPlaceholder />
        )}
        {entry.duration && (
          <div className="absolute right-0.5 bottom-1 rounded bg-black/60 px-1 text-xs text-white">
            {formatDuration(entry.duration)}
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1 overflow-hidden">
        <div className="flex items-center gap-2">
          <h3 className="min-w-0 flex-1 truncate font-semibold">
            {entry.title}
          </h3>
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

        {/* Metadata row: filename | date | size | quality | status | delete */}
        <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs">
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-1">
            {entry.filename && (
              <>
                <span className="max-w-[200px] truncate">{entry.filename}</span>
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
          <div className="flex items-center gap-1">
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
            <Button
              variant="ghost"
              size="icon"
              onClick={onDelete}
              title={t('history.deleteConfirm')}
              className="text-destructive hover:bg-destructive/10 size-6"
            >
              <Trash2 size={14} />
            </Button>
          </div>
        </div>

        {entry.status === 'failed' && entry.errorMessage && (
          <p className="text-destructive mt-1 text-xs">{entry.errorMessage}</p>
        )}
      </div>

      {/* Download button - only show if bvid exists */}
      {entry.bvid && onDownload && (
        <TooltipProvider delayDuration={0}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button
                  variant="default"
                  size="sm"
                  onClick={onDownload}
                  disabled={disabled}
                >
                  <Download size={16} />
                  {t('watchHistory.download')}
                </Button>
              </span>
            </TooltipTrigger>
            {disabled && (
              <TooltipContent side="top" arrow>
                {t('video.download_in_progress')}
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  )
}

export default HistoryItem
