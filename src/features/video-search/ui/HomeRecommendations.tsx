import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/animate-ui/radix/tooltip'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { RefreshCw, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useHomeRecommendations } from '../hooks/useHomeRecommendations'
import { VideoCardGrid, VideoCardSkeletonGrid } from './VideoCardGrid'

/**
 * "For you" shelf on the popular (おすすめ) page: personalized web-home
 * recommendations above the popular grid. Renders nothing when logged
 * out, on failure, or when empty — the page then looks exactly as it
 * did before this shelf existed.
 */
export function HomeRecommendations() {
  const { t } = useTranslation()
  const { entries, showSkeleton, refreshing, refresh } =
    useHomeRecommendations()

  if (showSkeleton) {
    return (
      <section className="flex flex-col gap-2" aria-busy="true">
        <h2 className="text-base font-semibold">
          {t('popular.recommendationsTitle')}
        </h2>
        <VideoCardSkeletonGrid variant="featured" />
      </section>
    )
  }
  if (entries.length === 0) return null
  return (
    <section className="flex flex-col gap-2" aria-busy={refreshing}>
      {/* No scrollbar gutter inset: the popular page scrolls in the
          full-width page container, so the overlay scrollbar rides the
          window edge, clear of this header row. */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-primary flex items-center gap-2 text-base font-semibold">
          <Sparkles className="size-4" aria-hidden="true" />
          {t('popular.recommendationsTitle')}
        </h2>
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            {/* Span wrapper: a disabled button gets pointer-events: none
                and hover never reaches it (same idiom as HistoryItem). */}
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground"
                  onClick={refresh}
                  disabled={refreshing}
                  aria-label={t('popular.refreshRecommendations')}
                >
                  <RefreshCw
                    className={cn(refreshing && 'animate-spin')}
                    aria-hidden="true"
                  />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t('popular.refreshRecommendations')}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <VideoCardGrid entries={entries} variant="featured" />
    </section>
  )
}
