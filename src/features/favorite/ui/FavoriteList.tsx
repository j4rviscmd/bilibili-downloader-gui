import type { FavoriteVideo } from '@/features/favorite/types'
import FavoriteItem from '@/features/favorite/ui/FavoriteItem'
import { useTranslation } from 'react-i18next'
import { Virtuoso } from 'react-virtuoso'

type Props = {
  videos: FavoriteVideo[]
  loading: boolean
  foldersLoading: boolean
  hasMore: boolean
  onLoadMore: () => void
  onDownload: (video: FavoriteVideo) => void
  height?: string
}

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
 * Favorite video list component with infinite scroll.
 */
function FavoriteList({
  videos,
  loading,
  foldersLoading,
  hasMore,
  onLoadMore,
  onDownload,
  height,
}: Props) {
  const { t } = useTranslation()

  if ((loading || foldersLoading) && videos.length === 0) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-muted-foreground animate-pulse">
          {t('init.initializing')}
        </div>
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
      style={{ height }}
      data={videos}
      endReached={() => {
        if (hasMore && !loading) {
          onLoadMore()
        }
      }}
      itemContent={(_index, video) => (
        <div key={video.id} className="py-1">
          <FavoriteItem video={video} onDownload={onDownload} />
        </div>
      )}
      defaultItemHeight={DEFAULT_ITEM_HEIGHT}
    />
  )
}

export default FavoriteList
