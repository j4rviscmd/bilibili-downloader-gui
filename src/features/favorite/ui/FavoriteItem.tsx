import { useThumbnailCache } from '@/features/history'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/animate-ui/radix/tooltip'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { Check, Copy, Download, RefreshCw, StarOff } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { formatDuration, formatPlayCount } from '../hooks/useFavorite'
import type { FavoriteVideo } from '../types'

/** Build web URL from bvid and page number. */
const buildVideoUrl = (bvid: string, page: number): string =>
  `https://www.bilibili.com/video/${bvid}${page > 1 ? `?p=${page}` : ''}`

type Props = {
  video: FavoriteVideo
  onDownload: (video: FavoriteVideo) => void
  disabled?: boolean
}

/**
 * Single favorite video item component.
 */
function FavoriteItem({ video, onDownload, disabled }: Props) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const {
    data: thumbnailSrc,
    loading: thumbnailLoading,
    error,
    retry,
  } = useThumbnailCache(video.cover)

  const { data: avatarSrc } = useThumbnailCache(video.upper.face)

  const isDeleted = video.attr !== 0

  const handleDownload = () => {
    onDownload(video)
  }

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(buildVideoUrl(video.bvid, video.page))
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
        {thumbnailSrc && !thumbnailLoading ? (
          <img
            src={thumbnailSrc}
            alt={video.title}
            className="size-full object-cover select-none"
            draggable={false}
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
            href={buildVideoUrl(video.bvid, video.page)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-primary truncate"
          >
            {buildVideoUrl(video.bvid, video.page)}
          </a>
        </div>

        <div className="text-muted-foreground flex items-center gap-1 text-xs">
          {avatarSrc ? (
            <img
              src={avatarSrc}
              alt={video.upper.name}
              className="mr-0.5 size-4 rounded-full"
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
                onClick={handleDownload}
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
 * Thumbnail placeholder component.
 */
const ThumbnailPlaceholder = () => (
  <div className="text-muted-foreground flex size-full items-center justify-center">
    <Download size={32} />
  </div>
)

export default FavoriteItem
