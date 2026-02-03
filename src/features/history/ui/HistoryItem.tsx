'use client'

import { useThumbnailCache } from '@/features/history'
import type { HistoryEntry } from '@/features/history/model/historySlice'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { Check, Copy, Download, RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

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
  if (bytes < 1000) return `${bytes} B`
  if (bytes < 1000 * 1000) return `${(bytes / 1000).toFixed(1)} KB`
  return `${(bytes / (1000 * 1000)).toFixed(1)} MB`
}

const ThumbnailPlaceholder = () => (
  <div className="text-muted-foreground flex size-full items-center justify-center">
    <Download size={32} />
  </div>
)

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
  const { t, i18n } = useTranslation()
  const [copied, setCopied] = useState(false)

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
            {t(isSuccess ? 'history.filterSuccess' : 'history.filterFailed')}
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

        <div className="mt-1 flex items-center gap-2 text-xs">
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
