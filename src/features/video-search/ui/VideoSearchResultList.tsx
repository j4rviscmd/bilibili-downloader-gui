import { type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { useVideoSearch } from '../hooks/useVideoSearch'
import { VideoCardGrid, VideoCardSkeletonGrid } from './VideoCardGrid'
import { VideoSearchFeedTail } from './VideoSearchFeedTail'

/**
 * Live result list for the keyword video search's transient container
 * (a keyword without a stored feed yet): a card-shaped skeleton while
 * the first fetch is in flight, the prompt placeholder before any
 * search, then the grid plus the shared [`VideoSearchFeedTail`]
 * (spinner / error row / sentinel / zero-result state).
 *
 * Stacked per-keyword containers on the page render `VideoCardGrid` +
 * `VideoSearchFeedTail` directly instead, keeping the grid at a stable
 * tree position so its card `<img>` nodes survive live/hidden switches
 * (no thumbnail reload on keyword restores).
 */
export function VideoSearchResultList({
  scrollRootRef,
}: {
  /** Scroll container acting as the sentinel observer's root. */
  scrollRootRef?: RefObject<HTMLDivElement | null>
}) {
  const { t } = useTranslation()
  const { entries, loading, error, keyword } = useVideoSearch()

  // First fetch: skeleton grid keeps the layout stable. (Later pages
  // keep the loaded cards visible; only the tail's spinner rides below.)
  if (entries.length === 0) {
    if (loading) {
      return (
        <div className="flex flex-col gap-2" aria-busy="true">
          <span className="sr-only">{t('videoSearch.loading')}</span>
          <VideoCardSkeletonGrid />
        </div>
      )
    }
    // A failed first fetch renders nothing here: the page-level error
    // Alert owns the message — a "no results" hint below it would
    // misreport the failure as an empty result set.
    if (error) return null

    if (keyword === '') {
      return (
        <div className="text-muted-foreground flex flex-col items-center gap-2 py-12 text-center">
          <p className="text-sm">{t('videoSearch.placeholder')}</p>
        </div>
      )
    }
    // Zero results without an error/loading: fall through — the grid
    // renders nothing and the tail's empty state owns the message.
  }

  return (
    <div className="flex flex-col gap-2">
      <VideoCardGrid entries={entries} />
      <VideoSearchFeedTail scrollRootRef={scrollRootRef} />
    </div>
  )
}
