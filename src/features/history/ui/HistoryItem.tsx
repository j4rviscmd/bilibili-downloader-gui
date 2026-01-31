'use client'
import type { HistoryEntry } from '@/features/history/model/historySlice'
import { redownloadFromHistory } from '@/features/history/api/redownload'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/lib/utils'
import { Download, Loader2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

type Props = {
  entry: HistoryEntry
  onDelete: () => void
}

function HistoryItem({ entry, onDelete }: Props) {
  const { t } = useTranslation()
  const [isRedownloading, setIsRedownloading] = useState(false)

  const handleRedownload = async () => {
    setIsRedownloading(true)
    try {
      await redownloadFromHistory(entry)
      toast.success(t('video.download_completed'))
    } catch (error) {
      toast.error(t('video.download_failed'), {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setIsRedownloading(false)
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '-'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const statusColor =
    entry.status === 'completed'
      ? 'text-chart-2'
      : 'text-destructive'

  const statusBg =
    entry.status === 'completed'
      ? 'bg-chart-2/10'
      : 'bg-destructive/10'

  return (
    <div className="border-border hover:bg-accent/50 flex items-center gap-3 rounded-lg border p-3 transition-colors">
      <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
        {entry.thumbnailUrl ? (
          <img
            src={entry.thumbnailUrl}
            alt={entry.title}
            className="size-full object-cover"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground">
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
              statusBg,
              statusColor,
            )}
          >
            {entry.status === 'completed'
              ? t('history.filterSuccess')
              : t('history.filterFailed')}
          </span>
        </div>

        {entry.filename && (
          <p className="text-muted-foreground truncate text-sm">
            {entry.filename}
          </p>
        )}

        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
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
          <p className="text-destructive mt-1 text-xs">
            {entry.errorMessage}
          </p>
        )}

        <div className="mt-1 text-xs">
          <a
            href={entry.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-primary truncate block max-w-[200px]"
          >
            {entry.url}
          </a>
        </div>
      </div>

      <div className="flex shrink-0 flex-col gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={handleRedownload}
          title={t('history.redownload')}
          disabled={isRedownloading}
        >
          {isRedownloading ? (
            <Loader2 size={18} className="animate-spin" />
          ) : (
            <Download size={18} />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onDelete}
          title={t('video.delete_confirm')}
          className="text-destructive hover:bg-destructive/10"
        >
          <Trash2 size={18} />
        </Button>
      </div>
    </div>
  )
}

export default HistoryItem
