'use client'

import { getThumbnailBase64 } from '@/features/history/api/thumbnailApi'
import type { HistoryEntry } from '@/features/history/model/historySlice'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { Check, Copy, Download, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

const LOCALE_MAP: Record<string, string> = {
  zh: 'zh-CN',
  ja: 'ja-JP',
  en: 'en-US',
  fr: 'fr-FR',
  es: 'es-ES',
  ko: 'ko-KR',
}

const FILE_SIZE_UNITS = ['B', 'KB', 'MB'] as const
const BYTES_PER_KB = 1024
const BYTES_PER_MB = 1024 * 1024
const COPY_RESET_DELAY = 2000

type Props = {
  entry: HistoryEntry
  onDelete: () => void
}

function HistoryItem({ entry, onDelete }: Props) {
  const { t, i18n } = useTranslation()
  const [thumbnailSrc, setThumbnailSrc] = useState<string | null>(null)
  const [thumbnailLoading, setThumbnailLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!entry.thumbnailUrl) return

    if (entry.thumbnailUrl.startsWith('data:')) {
      setThumbnailSrc(entry.thumbnailUrl)
      return
    }

    setThumbnailLoading(true)
    getThumbnailBase64(entry.thumbnailUrl)
      .then(setThumbnailSrc)
      .catch((err) => {
        console.error('Failed to load thumbnail:', err)
        setThumbnailSrc(null)
      })
      .finally(() => setThumbnailLoading(false))
  }, [entry.thumbnailUrl])

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString)
    const locale = LOCALE_MAP[i18n.language] || i18n.language
    return date.toLocaleDateString(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const formatFileSize = (bytes?: number): string => {
    if (!bytes) return '-'

    let unitIndex = 0
    let value = bytes

    if (bytes >= BYTES_PER_MB) {
      value = bytes / BYTES_PER_MB
      unitIndex = 2
    } else if (bytes >= BYTES_PER_KB) {
      value = bytes / BYTES_PER_KB
      unitIndex = 1
    }

    return `${value.toFixed(unitIndex > 0 ? 1 : 0)} ${FILE_SIZE_UNITS[unitIndex]}`
  }

  const handleCopyUrl = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(entry.url)
      setCopied(true)
      toast.success(t('history.copySuccess'))
      setTimeout(() => setCopied(false), COPY_RESET_DELAY)
    } catch {
      toast.error(t('history.copyFailed'))
    }
  }

  const isSuccess = entry.status === 'completed'

  const showThumbnailPlaceholder = thumbnailLoading || !thumbnailSrc

  return (
    <div className="border-border hover:bg-accent/50 flex items-center gap-3 rounded-lg border p-3 transition-colors">
      <div className="bg-muted flex size-20 shrink-0 items-center justify-center overflow-hidden rounded">
        {showThumbnailPlaceholder ? (
          <div className="text-muted-foreground flex size-full items-center justify-center">
            <Download size={32} />
          </div>
        ) : (
          <img
            src={thumbnailSrc}
            alt={entry.title}
            className="size-full object-cover"
          />
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
