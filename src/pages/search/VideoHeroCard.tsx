import type { Video } from '@/features/video'
import { formatDuration } from '@/features/video-search/lib/formatDuration'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/animate-ui/radix/tooltip'
import { openUrl } from '@tauri-apps/plugin-opener'
import { ExternalLink } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'

/**
 * Loaded-video summary card: thumbnail (static, Part 1's — the API only
 * provides one per video), title, IDs, part count and total duration.
 * Gives the "did I fetch the right video?" check within the first second
 * of landing.
 *
 * No preview action here by design: the hero only has Part 1's data, so
 * a preview would silently play Part 1 regardless of what the user
 * wants. Each part row carries its own preview button with the correct
 * context. The Part-1 duration badge is likewise omitted — the card's
 * "total" chip is the honest number.
 *
 * The title is read-only: filenames are edited per part row, and for
 * single-part videos the part row's title IS the filename (same data).
 *
 * @example
 * ```tsx
 * <VideoHeroCard video={video} />
 * ```
 */
export function VideoHeroCard({
  video,
  onOpenLogin,
}: {
  video: Video
  /** Opens the QR login dialog from the quality-limit tooltip. */
  onOpenLogin?: () => void
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
      <div className="bg-muted relative aspect-video w-40 shrink-0 overflow-hidden rounded-lg md:w-62">
        {first.thumbnail.url ? (
          <img
            src={first.thumbnail.url}
            alt={first.part}
            className="block h-full w-full object-cover"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : null}
      </div>

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
          {/* Content type moved here from the compact bar: the sticky bar
              only needs to say WHICH video is loaded, and this row is the
              single place that describes it. */}
          <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-0.5 text-[11px] font-semibold">
            {t(
              video.contentType === 'bangumi'
                ? 'search.type_bangumi'
                : 'search.type_video',
            )}
          </span>
          <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-0.5 text-[11px] font-semibold">
            {t('search.parts_count', { count: video.parts.length })}
          </span>
          <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-0.5 text-[11px] font-semibold tabular-nums">
            {t('search.total_duration', {
              duration: formatDuration(totalSeconds),
            })}
          </span>
          {video.isLimitedQuality && (
            /* Hover/focus explanation: the chip alone ("quality
               limited") names the symptom without the fix. The tooltip
               reuses the login notice's copy and opens the QR dialog
               from its link. A button trigger keeps it keyboard-
               reachable (hover-only reveals are inaccessible). */
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="text-brand-strong bg-brand-strong/10 dark:text-brand rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                  >
                    {t('video.quality_limited_title')}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" arrow className="max-w-72">
                  <Trans
                    i18nKey="video.login_benefits_description"
                    components={{
                      1: (
                        <button
                          type="button"
                          onClick={onOpenLogin}
                          className="cursor-pointer font-semibold underline"
                        />
                      ),
                    }}
                  />
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        <div className="mt-auto flex gap-2 px-0.5">
          <button
            type="button"
            onClick={() => void openUrl(watchUrl)}
            className="bg-card hover:bg-muted inline-flex min-h-8.5 items-center gap-1.5 rounded-lg border px-2.75 py-1.5 text-xs font-medium transition-colors"
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
