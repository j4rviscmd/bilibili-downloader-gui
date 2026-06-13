import type { FavoriteVideo } from '@/features/favorite/types'
import FavoriteItem from '@/features/favorite/ui/FavoriteItem'
import CircleIndicator from '@/shared/ui/CircleIndicator'
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
  disabled,
}: Props) {
  const { t } = useTranslation()

  if ((loading || foldersLoading) && videos.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <CircleIndicator size="lg" />
      </div>
    )
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
      style={{ height: '100%' }}
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
    />
  )
}

export default FavoriteList
