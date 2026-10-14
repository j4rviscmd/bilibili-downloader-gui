import type { Video } from '@/features/video'
import { formatDuration } from '@/features/video-search/lib/formatDuration'
import { openUrl } from '@tauri-apps/plugin-opener'
import { ExternalLink, Play } from 'lucide-react'
import { useTranslation } from 'react-i18next'

// Shared styling for the hero action buttons (preview / open in browser).
const actionButtonClass =
  'bg-card hover:bg-muted inline-flex min-h-8.5 items-center gap-1.5 rounded-lg border px-2.75 py-1.5 text-xs font-medium transition-colors'

/**
 * Loaded-video summary card: thumbnail (click = preview), title, IDs,
 * part count and total duration. Gives the "did I fetch the right video?"
 * check within the first second of landing.
 *
 * The title is read-only here: filenames are edited per part row, and for
 * single-part videos the part row's title IS the filename (same data).
 *
 * @example
 * ```tsx
 * <VideoHeroCard video={video} onThumbnailClick={() => setPreview(...)} />
 * ```
 */
export function VideoHeroCard({
  video,
  onThumbnailClick,
}: {
  video: Video
  onThumbnailClick: () => void
}) {
  const { t } = useTranslation()
  const first = video.parts[0]
  const totalSeconds = video.parts.reduce((s, p) => s + p.duration, 0)
  // Bangumi entries fetched via ep/ss ids may carry no bvid: fall back to
  // the site root so the button always goes somewhere valid.
  const watchUrl = video.bvid
    ? `https://www.bilibili.com/video/${video.bvid}`
    : 'https://www.bilibili.com'

  return (
    <section className="bg-card flex gap-4 rounded-xl border p-4 shadow-sm">
      <button
        type="button"
        onClick={onThumbnailClick}
        aria-label={t('search.preview_part', { part: first.part })}
        className="group/thumb bg-muted relative aspect-video w-40 shrink-0 cursor-pointer overflow-hidden rounded-lg text-left md:w-62"
      >
        {first.thumbnail.url ? (
          <img
            src={first.thumbnail.url}
            alt={first.part}
            className="block h-full w-full object-cover"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : null}
        <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition-opacity duration-200 group-hover/thumb:bg-black/40 group-hover/thumb:opacity-100">
          <Play className="size-8 fill-current drop-shadow" aria-hidden />
        </span>
        <span className="absolute right-1.5 bottom-1.5 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-semibold text-white tabular-nums">
          {formatDuration(first.duration)}
        </span>
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h2 className="px-0.5 text-base leading-snug font-bold tracking-tight">
          {video.title}
        </h2>
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 px-0.5 text-xs">
          {video.contentType === 'bangumi' && video.seasonTitle && (
            <>
              <span className="font-medium">{video.seasonTitle}</span>
              <span aria-hidden>·</span>
            </>
          )}
          <span className="font-mono text-[11px]">{video.bvid}</span>
        </div>
        <div className="flex flex-wrap gap-1.5 px-0.5">
          <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-0.5 text-[11px] font-semibold">
            {t('search.parts_count', { count: video.parts.length })}
          </span>
          <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-0.5 text-[11px] font-semibold tabular-nums">
            {t('search.total_duration', {
              duration: formatDuration(totalSeconds),
            })}
          </span>
          {video.isLimitedQuality && (
            <span className="text-brand-strong bg-brand-strong/10 dark:text-brand rounded-full px-2.5 py-0.5 text-[11px] font-semibold">
              {t('video.quality_limited_title')}
            </span>
          )}
        </div>
        <div className="mt-auto flex gap-2 px-0.5">
          <button
            type="button"
            onClick={onThumbnailClick}
            className={actionButtonClass}
          >
            <Play className="size-3.5 fill-current" aria-hidden />
            {t('search.preview')}
          </button>
          <button
            type="button"
            onClick={() => void openUrl(watchUrl)}
            className={actionButtonClass}
          >
            <ExternalLink className="size-3.5" aria-hidden />
            {t('search.open_in_browser')}
          </button>
        </div>
      </div>
    </section>
  )
}

export default VideoHeroCard
