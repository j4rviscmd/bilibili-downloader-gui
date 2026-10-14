import { useVideoInfo, VideoForm1 } from '@/features/video'
import { Play } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * Accepted URL format chip (empty-state guidance).
 *
 * @private
 */
function FormatChip({
  pattern,
  categoryKey,
}: {
  pattern: string
  categoryKey: string
}) {
  const { t } = useTranslation()
  return (
    <span className="text-muted-foreground bg-card inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs">
      <span className="text-foreground font-mono text-[11px] font-semibold">
        {pattern}
      </span>
      <span className="text-brand-strong dark:text-brand text-[10px] font-bold">
        {t(categoryKey)}
      </span>
    </span>
  )
}

/**
 * URL entry bar for the search page.
 *
 * `hero` is the empty-state centerpiece (brand mark, headline, visible
 * label, accepted-format chips). `compact` is the sticky bar shown once a
 * video is loaded (input + content-type chip). Both variants embed
 * `VideoForm1` so the input engine — validation, the 500ms silent
 * auto-fetch, b23.tv expansion, explicit submit — stays single-sourced
 * instead of being duplicated per variant.
 *
 * @example
 * ```tsx
 * <CommandBar variant={video.parts.length > 0 ? 'compact' : 'hero'} />
 * ```
 */
export function CommandBar({ variant }: { variant: 'hero' | 'compact' }) {
  const { t } = useTranslation()
  const { video } = useVideoInfo()

  if (variant === 'hero') {
    return (
      <div className="w-full max-w-2xl text-center">
        <div className="bg-brand text-brand-foreground mx-auto mb-4 flex size-13 items-center justify-center rounded-xl shadow-lg">
          <Play className="size-6 fill-current" aria-hidden />
        </div>
        <h2 data-hero-title className="text-xl font-bold tracking-tight">
          {t('search.hero_title')}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('search.hero_subtitle')}
        </p>
        <div className="mt-5 flex items-center justify-between px-1 text-xs font-semibold">
          <label htmlFor="url">{t('search.url_label')}</label>
          <span className="text-muted-foreground font-normal">
            {t('search.paste_hint')}
          </span>
        </div>
        <VideoForm1 />
        <div
          role="group"
          className="mt-3.5 flex flex-wrap justify-center gap-2"
          aria-label={t('search.formats_label')}
        >
          <FormatChip pattern="BV1…" categoryKey="search.format_video" />
          <FormatChip pattern="av…" categoryKey="search.format_video" />
          <FormatChip pattern="ep… / ss…" categoryKey="search.format_bangumi" />
          <FormatChip pattern="b23.tv" categoryKey="search.format_short" />
        </div>
      </div>
    )
  }

  return (
    <div className="bg-background sticky top-0 z-20 flex items-center gap-2.5 border-b px-4 py-2.5 sm:px-6">
      <div className="min-w-0 flex-1">
        <VideoForm1 />
      </div>
      {video.parts.length > 0 && (
        <span className="text-brand-strong bg-brand-strong/10 border-brand-strong/30 dark:text-brand rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wide whitespace-nowrap">
          {t(
            video.contentType === 'bangumi'
              ? 'search.type_bangumi'
              : 'search.type_video',
          )}
          ･{t('search.parts_count', { count: video.parts.length })}
        </span>
      )}
    </div>
  )
}

export default CommandBar
