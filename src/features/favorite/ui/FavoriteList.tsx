import type { FavoriteVideo } from '@/features/favorite/types'
import FavoriteItem from '@/features/favorite/ui/FavoriteItem'
import { VideoListSkeleton } from '@/shared/ui/VideoListSkeleton'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Virtuoso } from 'react-virtuoso'

/** Props for the FavoriteList component. */
type Props = {
  /** Array of favorite videos to display. */
  videos: FavoriteVideo[]
  /** Whether the video list is currently loading. */
  loading: boolean
  /** Whether the folder list is currently loading. */
  foldersLoading: boolean
  /** Whether there are more videos to load via infinite scroll. */
  hasMore: boolean
  /** Callback invoked when more videos should be loaded. */
  onLoadMore: () => void
  /** Callback invoked when the user requests to download a video. */
  onDownload: (video: FavoriteVideo) => void
  /** The page-level scroll container (PageTemplate `bodyScroll`):
   *  Virtuoso rides it via `customScrollParent` instead of its own
   *  internal scroller, so the scrollbar sits at the window edge. */
  scrollParent: HTMLElement | null
  /** Whether download buttons should be disabled. */
  disabled?: boolean
}

/** Approximate height in pixels for each FavoriteItem (used for virtual scrolling). */
const DEFAULT_ITEM_HEIGHT = 120

/**
 * Empty state icon component.
 */
const EmptyStateIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="64"
    height="64"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="opacity-20"
  >
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
)

/**
 * Virtualized list component for favorite videos.
 *
 * Uses react-virtuoso for efficient rendering of large lists with infinite
 * scroll. Shows a loading skeleton while folders or videos are being fetched,
 * and an empty state when no videos are available.
 *
 * @example
 * ```tsx
 * <FavoriteList
 *   videos={videos}
 *   loading={loading}
 *   foldersLoading={foldersLoading}
 *   hasMore={hasMore}
 *   onLoadMore={loadMore}
 *   onDownload={onDownload}
 *   scrollParent={scrollEl}
 *   disabled={hasActiveDownloads}
 * />
 * ```
 */
function FavoriteList({
  videos,
  loading,
  foldersLoading,
  hasMore,
  onLoadMore,
  onDownload,
  scrollParent,
  disabled,
}: Props) {
  const { t } = useTranslation()
  // Why: `components` must keep a stable object identity — an inline literal
  // gives Footer a new component type each render, remounting it and
  // restarting the skeleton's animate-pulse (visible flicker).
  // (react.dev/learn/preserving-and-resetting-state: a different component
  // type at the same position remounts)
  const components = useMemo(
    () => ({
      Footer: () =>
        // Note: favorites expose a single `loading` flag (no dedicated
        // load-more flag), so this footer skeleton also shows during manual
        // refresh — refresh() sets loading while refetching page 1
        // (src/features/favorite/hooks/useFavorite.ts).
        loading ? (
          <VideoListSkeleton rows={3} label={t('favorite.loading')} />
        ) : null,
    }),
    [loading, t],
  )

  if ((loading || foldersLoading) && videos.length === 0) {
    return <VideoListSkeleton label={t('favorite.loading')} />
  }

  if (videos.length === 0) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-4 p-8">
        <div className="text-muted-foreground/60 flex size-32 items-center justify-center">
          <EmptyStateIcon />
        </div>
        <p className="text-muted-foreground text-center text-lg">
          {t('favorite.empty')}
        </p>
      </div>
    )
  }

  return (
    <Virtuoso
      // Why the paired fallback: scrollParent is null until the
      // template's scroller mounts (first render) and in standalone
      // tests — Virtuoso then needs its own height:100% scroller
      // instead of riding the page-level one.
      customScrollParent={scrollParent ?? undefined}
      style={scrollParent ? undefined : { height: '100%' }}
      data={videos}
      endReached={() => {
        if (hasMore && !loading) {
          onLoadMore()
        }
      }}
      itemContent={(_index, video) => (
        <div className="py-1">
          <FavoriteItem
            video={video}
            onDownload={onDownload}
            disabled={disabled}
          />
        </div>
      )}
      defaultItemHeight={DEFAULT_ITEM_HEIGHT}
      components={components}
    />
  )
}

export default FavoriteList
