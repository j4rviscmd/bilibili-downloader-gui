import { Kbd } from '@/components/ui/kbd'
import { useVideoInfo, VideoForm1 } from '@/features/video'
import { Link2, Play, RefreshCw } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'

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
 * label, accepted-format chips, unified command bar). `compact` is the
 * sticky bar shown once a video is loaded (the URL input; the
 * video's type and part count live in the hero card above the list).
 * Both variants embed `VideoForm1` so the input engine — validation,
 * the 500ms silent auto-fetch, b23.tv expansion, explicit submit —
 * stays single-sourced instead of being duplicated per variant.
 *
 * The hero's command bar visually wraps the input, paste button, and
 * fetch CTA in ONE bordered container (matching the mockup's .cmdbar).
 * VideoForm1's inner shadcn Input border is stripped via descendant
 * selectors; the focus ring lands on the wrapper instead.
 *
 * @example
 * ```tsx
 * <CommandBar variant={video.parts.length > 0 ? 'compact' : 'hero'} />
 * ```
 */
export function CommandBar({ variant }: { variant: 'hero' | 'compact' }) {
  const { t } = useTranslation()
  // Platform-native modifier for the paste hint (Cmd on macOS, Ctrl
  // elsewhere). Same userAgent check as the settings GeneralSection
  // (`navigator.platform` is deprecated); two separate <kbd> chips make
  // the combination readable on both platforms without a "+".
  const isMac =
    typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent)
  const pasteMod = isMac ? '⌘' : 'Ctrl'
  const { onValid1 } = useVideoInfo()

  if (variant === 'hero') {
    return (
      <div className="w-full max-w-2xl text-center">
        <div className="bg-brand text-brand-foreground shadow-brand/40 mx-auto mb-4 flex size-13 items-center justify-center rounded-xl shadow-[0_6px_20px_-6px]">
          <Play className="size-6 fill-current" aria-hidden />
        </div>
        <h2 data-hero-title className="text-xl font-bold tracking-tight">
          {t('search.hero_title')}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('search.hero_subtitle')}
        </p>
        <div className="mt-5 mb-1.5 flex items-center justify-between px-1 text-xs font-semibold">
          <label htmlFor="url">{t('search.url_label')}</label>
          {/* Rich <kbd> chips: the locale string embeds literal <kbd> tags
              that Trans swaps for the styled Kbd component. */}
          <span className="text-muted-foreground font-normal">
            <Trans
              i18nKey="search.paste_hint"
              values={{ mod: pasteMod }}
              components={{ kbd: <Kbd /> }}
            />
          </span>
        </div>
        {/* Unified command bar: one bordered container wrapping the input
            and fetch CTA — the mockup's .cmdbar. The [&_input] overrides
            neutralize the shadcn Input's own chrome (border, radius, fixed
            height, horizontal padding, dark translucent background, focus
            ring) so the input sits bare inside the bar and the focus ring
            lands on this wrapper instead. */}
        <div className="group/cmdbar focus-within:border-brand-strong focus-within:ring-brand-strong/35 bg-card border-border flex items-center gap-2 rounded-xl border-[1.5px] p-1.5 pl-3.5 shadow-sm transition-all focus-within:ring-4 [&_input]:h-auto [&_input]:rounded-none [&_input]:border-0 [&_input]:bg-transparent! [&_input]:px-0 [&_input]:py-2 [&_input]:text-[14.5px] [&_input]:shadow-none [&_input]:focus-visible:ring-0 [&_input]:focus-visible:outline-none [&_input::placeholder]:opacity-75">
          <Link2
            className="text-muted-foreground size-4 shrink-0"
            aria-hidden
          />
          <div className="min-w-0 flex-1 text-left">
            <VideoForm1 />
          </div>
          <button
            type="button"
            onClick={() => {
              const el = document.querySelector<HTMLInputElement>('#url')
              if (el?.value) void onValid1(el.value.trim())
            }}
            className="bg-brand-strong text-brand-foreground inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold transition-opacity hover:opacity-90"
          >
            {t('search.fetch_cta')}
            <RefreshCw className="size-4" aria-hidden />
          </button>
        </div>
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
      {/* Same unified container as the hero cmdbar: lead link icon +
          borderless input, focus ring on the wrapper. Mirrors the
          mockup's .cb-input so the URL field reads as the same control
          in both states. */}
      <div className="bg-card border-border focus-within:border-brand-strong focus-within:ring-brand-strong/35 flex min-w-0 flex-1 items-center gap-2.5 rounded-[10px] border px-2.5 py-1 transition-all focus-within:ring-3 [&_input]:h-auto [&_input]:rounded-none [&_input]:border-0 [&_input]:bg-transparent! [&_input]:px-0 [&_input]:py-1.5 [&_input]:shadow-none [&_input]:focus-visible:ring-0 [&_input]:focus-visible:outline-none">
        <Link2 className="text-muted-foreground size-4 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <VideoForm1 />
        </div>
      </div>
    </div>
  )
}

export default CommandBar
