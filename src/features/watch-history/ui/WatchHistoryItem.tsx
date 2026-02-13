import { Button } from '@/shared/ui/button'
import { Check, Copy, Download } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  calculateProgress,
  formatDurationShort,
  formatRelativeTime,
} from '../lib/utils'
import type { WatchHistoryEntry } from '../types'

type Props = {
  /** Watch history entry to display */
  entry: WatchHistoryEntry
  /** Callback when user clicks download button */
  onDownload: (entry: WatchHistoryEntry) => void
}

/**
 * Displays a single watch history entry with thumbnail, progress,
 * metadata, and download button.
 *
 * Features:
 * - Thumbnail with duration badge and progress bar overlay
 * - Video title with relative time (e.g., "2 hours ago")
 * - URL display with copy-to-clipboard button
 * - Download button to navigate to download page
 *
 * @example
 * ```tsx
 * <WatchHistoryItem
 *   entry={historyEntry}
 *   onDownload={(entry) => {
 *     dispatch(setPendingDownload({ bvid: entry.bvid, cid: entry.cid }))
 *     navigate('/home')
 *   }}
 * />
 * ```
 */
export function WatchHistoryItem({ entry, onDownload }: Props) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const progressPercent = calculateProgress(entry.progress, entry.duration)

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
    <div className="border-border hover:bg-accent/50 flex items-center gap-3 rounded-lg border p-3">
      {/* Thumbnail with progress overlay */}
      <div className="relative size-20 shrink-0 overflow-hidden rounded select-none">
        <img
          src={entry.coverBase64 || entry.cover}
          alt={entry.title}
          className="size-full object-cover"
          draggable={false}
          onError={(e) => {
            e.currentTarget.src = '/placeholder.png'
          }}
        />
        {/* Duration badge */}
        <div className="absolute right-0.5 bottom-1 rounded bg-black/60 px-1 text-xs text-white">
          {formatDurationShort(entry.duration)}
        </div>
        {/* Progress bar overlay */}
        <div className="absolute right-0 bottom-0 left-0 h-1.5 bg-black/60">
          <div
            className="h-full bg-gradient-to-r from-pink-500 to-red-500"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h3 className="truncate font-semibold">{entry.title}</h3>

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

        <span className="text-muted-foreground text-xs">
          {formatRelativeTime(entry.viewAt)}
        </span>
      </div>

      {/* Download Button */}
      <Button size="sm" onClick={() => onDownload(entry)}>
        <Download className="mr-1 h-4 w-4" />
        {t('watchHistory.download')}
      </Button>
    </div>
  )
}
