import { useFeedSentinel } from '@/shared/hooks/useFeedSentinel'
import { FeedErrorRow } from '@/shared/ui/FeedErrorRow'
import { SearchX } from 'lucide-react'
import { type RefObject, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useVideoSearch } from '../hooks/useVideoSearch'
import { VideoCardSkeletonGrid } from './VideoCardGrid'

/**
 * Live-only tail of one feed container: loading skeletons, load-failure
 * row, infinite-scroll sentinel, and the zero-result empty state.
 *
 * Loading renders card-shaped skeletons (bilibili/YouTube infinite-scroll
 * convention; brand-tinted per the 2026-10-21 accent rollout) instead of
 * a circle spinner.
 *
 * Rendered as a sibling AFTER the container's `VideoCardGrid` — the grid
 * itself must stay at a stable tree position/type so React reuses the
 * card `<img>` nodes when a stacked container switches between its
 * hidden (stored cards only) and live forms: a remounted grid would
 * reload every thumbnail on keyword restores. The skeletons live INSIDE
 * this tail so that invariant is untouched.
 */
export function VideoSearchFeedTail({
  scrollRootRef,
}: {
  /** Scroll container acting as the sentinel observer's root. */
  scrollRootRef?: RefObject<HTMLDivElement | null>
}) {
  const { t } = useTranslation()
  const { entries, loading, error, noMore, loadMore } = useVideoSearch()
  const sentinelRef = useRef<HTMLDivElement>(null)

  useFeedSentinel({
    scrollRootRef,
    sentinelRef,
    disabled: noMore || error !== null,
    onReachEnd: loadMore,
    recheckKey: entries.length,
  })

  // Zero-entry feed. Same guards as VideoSearchResultList's empty
  // branch, in the same order: in-flight (filter change / fresh
  // resubmit of a zero-result keyword) → full skeleton grid (mirrors
  // the first-fetch view in VideoSearchResultList); a failed page-1
  // refetch → nothing (the page-level Alert owns the message — a
  // "no results" hint beside it would misreport the failure); only a
  // clean empty result set renders the zero-result state.
  if (entries.length === 0) {
    if (loading) {
      return (
        <div className="flex flex-col gap-2" aria-busy="true">
          <span className="sr-only">{t('videoSearch.loading')}</span>
          <VideoCardSkeletonGrid />
        </div>
      )
    }
    if (error) return null
    return (
      <div className="text-muted-foreground flex flex-col items-center gap-2 py-12 text-center">
        <SearchX className="size-8 opacity-70" aria-hidden="true" />
        <p className="text-sm">{t('videoSearch.noResults')}</p>
        <p className="text-xs">{t('videoSearch.noResultsHint')}</p>
      </div>
    )
  }

  return (
    <>
      {loading && (
        // Two xl grid rows (6 cards): enough to signal the next page
        // without a wall of placeholders below the loaded cards.
        <div className="flex flex-col gap-2" aria-busy="true">
          <span className="sr-only">{t('videoSearch.loading')}</span>
          <VideoCardSkeletonGrid />
        </div>
      )}
      {error && (
        <FeedErrorRow
          error={error}
          message={t('videoSearch.loadError')}
          retryLabel={t('videoSearch.retry')}
          onRetry={loadMore}
        />
      )}
      {/* shrink-0: guard against flex-column scroll containers collapsing the 1px sentinel (see useFeedSentinel) */}
      {!noMore && (
        <div ref={sentinelRef} className="h-px shrink-0" aria-hidden="true" />
      )}
    </>
  )
}
