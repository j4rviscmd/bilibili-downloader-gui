import { VideoCardGrid, VideoCardSkeletonGrid } from '@/features/video-search'
import { Button } from '@/shared/ui/button'
import { AlertTriangle, Loader2, RotateCcw } from 'lucide-react'
import { type RefObject, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { usePopularFeed } from '../hooks/usePopularFeed'

/** One-line load failure row with a retry button (initial and pagination
 * failures share it; retry re-requests the failed page). */
function FeedErrorRow({
  error,
  onRetry,
}: {
  error: string
  onRetry: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="text-muted-foreground flex items-center justify-center gap-2 py-6 text-sm">
      <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
      <span>{t('popular.loadError')}</span>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RotateCcw className="size-4" aria-hidden="true" />
        {t('popular.retry')}
      </Button>
      {/* Raw backend error for diagnostics (not translated). */}
      <span className="sr-only">{error}</span>
    </div>
  )
}

/**
 * Popular (おすすめ) feed list with infinite scroll: a sentinel div at the
 * grid tail drives `loadMore` via IntersectionObserver scoped to the page's
 * scroll container.
 */
export function PopularFeedList({
  scrollRootRef,
}: {
  scrollRootRef: RefObject<HTMLDivElement | null>
}) {
  const { t } = useTranslation()
  const { items, loading, error, noMore, loadMore } = usePopularFeed()
  const sentinelRef = useRef<HTMLDivElement>(null)

  // Why re-create per items.length: IntersectionObserver fires on
  // intersection CHANGES only — after an append on a short viewport the
  // sentinel may still be intersecting without a new event, so the
  // observer is re-attached to re-check.
  useEffect(() => {
    const root = scrollRootRef.current
    const sentinel = sentinelRef.current
    if (!root || !sentinel || noMore) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        // Why !error: after a failed page fetch the sentinel often stays
        // in view; auto-retrying would hammer the backend in a tight
        // loop. The error row's retry button owns recovery — once it
        // clears the error, this observer resumes auto-loading.
        if (entry.isIntersecting && !error) loadMore()
      },
      { root },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [items.length, noMore, loadMore, scrollRootRef, error])

  // Initial load: skeleton grid keeps the layout stable.
  if (items.length === 0) {
    if (error) {
      return (
        <div className="flex flex-col items-center py-12">
          <FeedErrorRow error={error} onRetry={loadMore} />
        </div>
      )
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
      {error && <FeedErrorRow error={error} onRetry={loadMore} />}
      {!noMore && <div ref={sentinelRef} className="h-px" aria-hidden="true" />}
    </div>
  )
}
