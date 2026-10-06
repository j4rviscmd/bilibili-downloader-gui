import { useFeedSentinel } from '@/shared/hooks/useFeedSentinel'
import { FeedErrorRow } from '@/shared/ui/FeedErrorRow'
import { Loader2, SearchX } from 'lucide-react'
import { type RefObject, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useVideoSearch } from '../hooks/useVideoSearch'

/**
 * Live-only tail of one feed container: loading spinner, load-failure
 * row, infinite-scroll sentinel, and the zero-result empty state.
 *
 * Rendered as a sibling AFTER the container's `VideoCardGrid` — the grid
 * itself must stay at a stable tree position/type so React reuses the
 * card `<img>` nodes when a stacked container switches between its
 * hidden (stored cards only) and live forms: a remounted grid would
 * reload every thumbnail on keyword restores.
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
  // resubmit of a zero-result keyword) → spinner; a failed page-1
  // refetch → nothing (the page-level Alert owns the message — a
  // "no results" hint beside it would misreport the failure); only a
  // clean empty result set renders the zero-result state.
  if (entries.length === 0) {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-4" aria-busy="true">
          <Loader2 className="text-muted-foreground size-5 animate-spin" />
          <span className="sr-only">{t('videoSearch.loading')}</span>
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
        <div className="flex items-center justify-center py-4" aria-busy="true">
          <Loader2 className="text-muted-foreground size-5 animate-spin" />
          <span className="sr-only">{t('videoSearch.loading')}</span>
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
      {!noMore && <div ref={sentinelRef} className="h-px" aria-hidden="true" />}
    </>
  )
}
