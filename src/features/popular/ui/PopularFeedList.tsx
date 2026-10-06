import { VideoCardGrid, VideoCardSkeletonGrid } from '@/features/video-search'
import { useFeedSentinel } from '@/shared/hooks/useFeedSentinel'
import { FeedErrorRow } from '@/shared/ui/FeedErrorRow'
import { Loader2 } from 'lucide-react'
import { type RefObject, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { usePopularFeed } from '../hooks/usePopularFeed'

/**
 * Popular (おすすめ) feed list with infinite scroll: a sentinel div at the
 * grid tail drives `loadMore` via IntersectionObserver scoped to the page's
 * scroll container (see `useFeedSentinel`).
 */
export function PopularFeedList({
  scrollRootRef,
}: {
  scrollRootRef: RefObject<HTMLDivElement | null>
}) {
  const { t } = useTranslation()
  const { items, loading, error, noMore, loadMore } = usePopularFeed()
  const sentinelRef = useRef<HTMLDivElement>(null)

  useFeedSentinel({
    scrollRootRef,
    sentinelRef,
    disabled: noMore || error !== null,
    onReachEnd: loadMore,
    recheckKey: items.length,
  })

  // The same row serves the initial-error and tail-error branches below.
  const errorRow = error && (
    <FeedErrorRow
      error={error}
      message={t('popular.loadError')}
      retryLabel={t('popular.retry')}
      onRetry={loadMore}
    />
  )

  // Initial load: skeleton grid keeps the layout stable.
  if (items.length === 0) {
    if (error) {
      return <div className="flex flex-col items-center py-12">{errorRow}</div>
    }
    if (loading) {
      return (
        <div className="flex flex-col gap-2" aria-busy="true">
          <span className="sr-only">{t('videoSearch.loading')}</span>
          <VideoCardSkeletonGrid />
        </div>
      )
    }
    return null
  }

  return (
    <div className="flex flex-col gap-2">
      <VideoCardGrid entries={items} />
      {loading && (
        <div className="flex items-center justify-center py-4" aria-busy="true">
          <Loader2 className="text-muted-foreground size-5 animate-spin" />
          <span className="sr-only">{t('videoSearch.loading')}</span>
        </div>
      )}
      {errorRow}
      {/* shrink-0: guard against flex-column scroll containers collapsing the 1px sentinel (see useFeedSentinel) */}
      {!noMore && (
        <div ref={sentinelRef} className="h-px shrink-0" aria-hidden="true" />
      )}
    </div>
  )
}
