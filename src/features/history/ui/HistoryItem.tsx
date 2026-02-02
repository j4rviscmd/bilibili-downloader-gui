'use client'
import { useThumbnailCache } from '@/features/history'
import type { HistoryEntry } from '@/features/history/model/historySlice'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { Download, RefreshCw, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

type Props = {
  entry: HistoryEntry
  onDelete: () => void
}

// Convert i18next language code to BCP 47 language tag
const I18N_LOCALE_MAP: Record<string, string> = {
  zh: 'zh-CN',
  ja: 'ja-JP',
  en: 'en-US',
  fr: 'fr-FR',
  es: 'es-ES',
  ko: 'ko-KR',
}

function formatDate(dateString: string, locale: string): string {
  const date = new Date(dateString)
  const mappedLocale = I18N_LOCALE_MAP[locale] || locale
  return date.toLocaleDateString(mappedLocale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatFileSize(bytes?: number): string {
  if (!bytes) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const ThumbnailPlaceholder = () => (
  <div className="text-muted-foreground flex size-full items-center justify-center">
    <Download size={32} />
  </div>
)

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
  const { t, i18n } = useTranslation()

  const {
    data: thumbnailSrc,
    loading: thumbnailLoading,
    error,
    retry,
  } = useThumbnailCache(
    entry.thumbnailUrl?.startsWith('data:') ? undefined : entry.thumbnailUrl,
  )

  const displayThumbnail = entry.thumbnailUrl?.startsWith('data:')
    ? entry.thumbnailUrl
    : thumbnailSrc

  const isSuccess = entry.status === 'completed'
  const statusKey = isSuccess ? 'history.filterSuccess' : 'history.filterFailed'

  return (
    <div className="border-border hover:bg-accent/50 group flex items-center gap-3 rounded-lg border p-3 transition-colors">
      <div className="bg-muted relative flex size-20 shrink-0 items-center justify-center overflow-hidden rounded">
        {thumbnailLoading ? (
          <ThumbnailPlaceholder />
        ) : displayThumbnail ? (
          <img
            src={displayThumbnail}
            alt={entry.title}
            className="size-full object-cover"
          />
        ) : (
          <ThumbnailPlaceholder />
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
          <h3 className="line-clamp-1 font-semibold">{entry.title}</h3>
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
          <span>{formatDate(entry.downloadedAt, i18n.language)}</span>
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

        <a
          href={entry.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-primary mt-1 block max-w-[200px] truncate text-xs"
        >
          {entry.url}
        </a>
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
