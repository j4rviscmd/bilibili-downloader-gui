import { Sparkles } from 'lucide-react'
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
  const { entries, showSkeleton } = useHomeRecommendations()

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
    <section className="flex flex-col gap-2">
      <h2 className="text-primary flex items-center gap-2 text-base font-semibold">
        <Sparkles className="size-4" aria-hidden="true" />
        {t('popular.recommendationsTitle')}
      </h2>
      <VideoCardGrid entries={entries} variant="featured" />
    </section>
  )
}
