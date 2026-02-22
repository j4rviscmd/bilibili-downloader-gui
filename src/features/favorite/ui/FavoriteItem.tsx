import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/animate-ui/radix/tooltip'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { Check, Copy, Download, ImageOff, StarOff } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { formatDuration, formatPlayCount } from '../hooks/useFavorite'
import type { FavoriteVideo } from '../types'

/**
 * Builds a Bilibili web URL from a video ID and page number.
 *
 * @param bvid - Bilibili video ID (e.g., 'BV1xx411c7XD')
 * @param page - Part page number (1-indexed). Page 1 omits the query parameter.
 * @returns Full Bilibili video URL
 *
 * @example
 * ```typescript
 * buildVideoUrl('BV1xx411c7XD', 1) // 'https://www.bilibili.com/video/BV1xx411c7XD'
 * buildVideoUrl('BV1xx411c7XD', 2) // 'https://www.bilibili.com/video/BV1xx411c7XD?p=2'
 * ```
 */
const buildVideoUrl = (bvid: string, page: number): string =>
  `https://www.bilibili.com/video/${bvid}${page > 1 ? `?p=${page}` : ''}`

/**
 * Props for the FavoriteItem component.
 */
type Props = {
  /** Favorite video data to display */
  video: FavoriteVideo
  /** Callback invoked when the download button is clicked */
  onDownload: (video: FavoriteVideo) => void
  /** Whether the download button should be disabled */
  disabled?: boolean
}

/**
 * Displays a single favorite video item with thumbnail, metadata, and download button.
 *
 * Shows video information including title, uploader, play count, and collect count.
 * Handles deleted videos with visual indication and disables interactions accordingly.
 *
 * @example
 * ```tsx
 * <FavoriteItem
 *   video={favoriteVideo}
 *   onDownload={(v) => handleDownload(v)}
 *   disabled={isDownloading}
 * />
 * ```
 */
function FavoriteItem({ video, onDownload, disabled }: Props) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const isDeleted = video.attr !== 0
  const videoUrl = buildVideoUrl(video.bvid, video.page)

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(videoUrl)
      setCopied(true)
      toast.success(t('history.copySuccess'))
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error(t('history.copyFailed'))
    }
  }

  return (
    <div
      className={cn(
        'border-border hover:bg-accent/50 group flex items-center gap-3 rounded-lg border p-3 transition-colors',
        isDeleted && 'opacity-60',
      )}
    >
      <div className="bg-muted relative flex size-20 shrink-0 items-center justify-center overflow-hidden rounded">
        {video.cover ? (
          <img
            src={video.cover}
            alt={video.title}
            className="size-full object-cover select-none"
            draggable={false}
            referrerPolicy="no-referrer"
          />
        ) : (
          <ThumbnailPlaceholder />
        )}
        <div className="absolute right-0.5 bottom-1 rounded bg-black/60 px-1 text-xs text-white">
          {formatDuration(video.duration)}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1 overflow-hidden">
        <div className="flex items-center gap-2">
          <h3 className="min-w-0 flex-1 truncate font-semibold">
            {video.title}
          </h3>
          {isDeleted && (
            <span className="bg-destructive/10 text-destructive rounded-full px-2 py-0.5 text-xs font-medium">
              <StarOff size={12} className="mr-1 inline" />
              {t('favorite.videoDeleted')}
            </span>
          )}
        </div>

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
            href={videoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-primary truncate"
          >
            {videoUrl}
          </a>
        </div>

        <div className="text-muted-foreground flex items-center gap-1 text-xs">
          {video.upper.face ? (
            <img
              src={video.upper.face}
              alt={video.upper.name}
              className="mr-0.5 size-4 rounded-full"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="bg-muted mr-0.5 size-4 rounded-full" />
          )}
          <a
            href={`https://space.bilibili.com/${video.upper.mid}`}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-primary truncate"
          >
            {video.upper.name}
          </a>
          <span>·</span>
          <span>
            {formatPlayCount(video.playCount)} {t('favorite.plays')}
          </span>
          <span>·</span>
          <span>
            {formatPlayCount(video.collectCount)} {t('favorite.collects')}
          </span>
        </div>
      </div>

      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button
                variant="default"
                size="sm"
                onClick={() => onDownload(video)}
                disabled={disabled}
              >
                <Download size={16} />
                {t('favorite.download')}
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
    </div>
  )
}

/**
 * Placeholder component displayed when thumbnail is unavailable.
 */
const ThumbnailPlaceholder = () => (
  <div className="text-muted-foreground flex size-full items-center justify-center">
    <ImageOff size={24} />
  </div>
)

export default FavoriteItem
