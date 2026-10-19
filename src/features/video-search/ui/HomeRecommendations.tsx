import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/animate-ui/radix/tooltip'
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
export function HomeRecommendations({
  refreshing = false,
}: {
  /** Page-owned refresh (the title icon) runs on another hook instance,
   * so the page passes its in-flight state in. */
  refreshing?: boolean
}) {
  const { t } = useTranslation()
  const { entries, showSkeleton, refresh } = useHomeRecommendations()

  if (showSkeleton || refreshing) {
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
  // Why: any in-flight refresh already took the skeleton branch above,
  // so this settled branch never shows mid-refresh and carries no
  // aria-busy state.
  return (
    <section className="flex flex-col gap-2">
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
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground"
                onClick={refresh}
                aria-label={t('popular.refreshRecommendations')}
              >
                <RefreshCw aria-hidden="true" />
              </Button>
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
