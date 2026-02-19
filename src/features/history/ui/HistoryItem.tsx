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
 * 2桁フォーマットを保証するために数値をゼロ埋めします。
 *
 * @param n - ゼロ埋めする数値（0-99）
 * @returns 必要に応じて先頭ゼロ付きの2桁文字列
 *
 * @example
 * ```ts
 * pad(5)  // "05"
 * pad(12) // "12"
 * ```
 */
const pad = (n: number): string => n.toString().padStart(2, '0')

/**
 * 秒単位の長さをMM:SSまたはHH:MM:SS形式にフォーマットします。
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
 * ISO 8601日付文字列を相対時間文字列にフォーマットします。
 *
 * @param dateString - ISO 8601日付文字列
 * @param t - 翻訳関数
 * @returns 相対時間文字列（例: "3分前", "Just now"）
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
 * ISO 8601日付文字列を短い絶対形式にフォーマットします。
 *
 * @param dateString - ISO 8601日付文字列
 * @returns 短い日付文字列（例: "2026/02/15 14:28"）
 */
function formatAbsoluteDate(dateString: string): string {
  const date = new Date(dateString)
  const month = date.getMonth() + 1
  const day = date.getDate()
  const hour = date.getHours()
  const minute = date.getMinutes()
  return `${date.getFullYear()}/${pad(month)}/${pad(day)} ${pad(hour)}:${pad(minute)}`
}

/** キロバイトあたりのバイト数 */
const KB = 1000
/** メガバイトあたりのバイト数 */
const MB = 1_000_000

/**
 * バイト数を人間が読めるファイルサイズ文字列にフォーマットします。
 *
 * @param bytes - バイト単位のファイルサイズ
 * @returns フォーマットされた文字列（例: "1.5 MB", "500 KB", "-"）
 */
function formatFileSize(bytes?: number): string {
  if (!bytes) return '-'
  if (bytes < KB) return `${bytes} B`
  if (bytes < MB) return `${(bytes / KB).toFixed(1)} KB`
  return `${(bytes / MB).toFixed(1)} MB`
}

/**
 * サムネイルプレースホルダーコンポーネント。
 *
 * サムネイルが利用できない、または読み込み中のときにダウンロードアイコンを表示します。
 */
const ThumbnailPlaceholder = () => (
  <div className="text-muted-foreground flex size-full items-center justify-center">
    <Download size={32} />
  </div>
)

/**
 * HistoryItemコンポーネントのプロパティ。
 *
 * @property entry - 表示する履歴エントリデータ
 * @property onDelete - 削除ボタンクリック時に呼び出されるコールバック関数
 * @property onDownload - ダウンロードボタンクリック時に呼び出されるコールバック関数
 * @property disabled - ダウンロードボタンを無効にするかどうか
 */
type Props = {
  entry: HistoryEntry
  onDelete: () => void
  onDownload?: () => void
  disabled?: boolean
}

/**
 * 単一の履歴エントリコンポーネント。
 *
 * @example
 * ```tsx
 * <HistoryItem
 *   entry={historyEntry}
 *   onDelete={() => handleDelete(historyEntry.id)}
 *   onDownload={() => handleDownload(historyEntry)}
 *   disabled={hasActiveDownloads}
 * />
 * ```
 */
function HistoryItem({ entry, onDelete, onDownload, disabled }: Props) {
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
   * 動画URLをクリップボードにコピーします。
   *
   * 成功トースト通知を表示し、コピーボタンのアイコンを2秒間一時的にチェックマークに変更します。
   * クリップボードアクセスが失敗した場合はエラートースト通知を表示します。
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
