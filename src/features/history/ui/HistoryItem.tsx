'use client'
import { getThumbnailBase64 } from '@/features/history/api/thumbnailApi'
import type { HistoryEntry } from '@/features/history/model/historySlice'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { Download, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Props for HistoryItem component.
 */
type Props = {
  /** History entry data to display */
  entry: HistoryEntry
  /** Callback when delete button is clicked */
  onDelete: () => void
}

/**
 * Single history entry component.
 *
 * Displays a history entry with:
 * - Thumbnail or placeholder icon
 * - Video title with status badge
 * - Filename (if available)
 * - Download date, file size, and quality metadata
 * - Error message (if failed)
 * - Delete button
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
  const [thumbnailSrc, setThumbnailSrc] = useState<string | null>(null)
  const [thumbnailLoading, setThumbnailLoading] = useState(false)

  // Load thumbnail from backend when entry has a URL
  useEffect(() => {
    if (entry.thumbnailUrl && !entry.thumbnailUrl.startsWith('data:')) {
      setThumbnailLoading(true)
      getThumbnailBase64(entry.thumbnailUrl)
        .then(setThumbnailSrc)
        .catch((err) => {
          console.error('Failed to load thumbnail:', err)
          setThumbnailSrc(null)
        })
        .finally(() => setThumbnailLoading(false))
    } else if (entry.thumbnailUrl?.startsWith('data:')) {
      // Already base64 encoded
      setThumbnailSrc(entry.thumbnailUrl)
    }
  }, [entry.thumbnailUrl])

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString)
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const formatFileSize = (bytes?: number): string => {
    if (!bytes) return '-'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const isSuccess = entry.status === 'completed'
  const statusKey = isSuccess ? 'history.filterSuccess' : 'history.filterFailed'

  return (
    <div className="border-border hover:bg-accent/50 flex items-center gap-3 rounded-lg border p-3 transition-colors">
      <div className="bg-muted flex size-20 shrink-0 items-center justify-center overflow-hidden rounded">
        {thumbnailLoading ? (
          <div className="text-muted-foreground flex size-full items-center justify-center">
            <Download size={32} />
          </div>
        ) : thumbnailSrc ? (
          <img
            src={thumbnailSrc}
            alt={entry.title}
            className="size-full object-cover"
          />
        ) : (
          <div className="text-muted-foreground flex size-full items-center justify-center">
            <Download size={32} />
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1 overflow-hidden">
        <div className="flex items-center gap-2">
          <h3 className="truncate font-semibold">{entry.title}</h3>
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-xs font-medium',
              isSuccess
                ? 'bg-chart-2/10 text-chart-2'
                : 'bg-destructive/10 text-destructive',
            )}
          >
            {t(statusKey)}
          </span>
        </div>

        {entry.filename && (
          <p className="text-muted-foreground truncate text-sm">
            {entry.filename}
          </p>
        )}

        <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
          <span>{formatDate(entry.downloadedAt)}</span>
          {entry.fileSize && (
            <>
              <span>•</span>
              <span>{formatFileSize(entry.fileSize)}</span>
            </>
          )}
          {entry.quality && (
            <>
              <span>•</span>
              <span>{entry.quality}</span>
            </>
          )}
        </div>

        {entry.status === 'failed' && entry.errorMessage && (
          <p className="text-destructive mt-1 text-xs">{entry.errorMessage}</p>
        )}

        <div className="mt-1 text-xs">
          <a
            href={entry.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-primary block max-w-[200px] truncate"
          >
            {entry.url}
          </a>
        </div>
      </div>

      <div className="flex shrink-0 flex-col gap-1">
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
    </div>
  )
}

export default HistoryItem
