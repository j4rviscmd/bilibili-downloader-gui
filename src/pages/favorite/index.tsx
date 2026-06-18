import { useSelector } from '@/app/store'
import { useFavorite } from '@/features/favorite/hooks/useFavorite'
import type { FavoriteVideo } from '@/features/favorite/types'
import FavoriteList from '@/features/favorite/ui/FavoriteList'
import FolderSelector from '@/features/favorite/ui/FolderSelector'
import { usePendingDownload } from '@/shared/hooks/usePendingDownload'
import { PageTemplate } from '@/shared/layout'
import { selectHasActiveDownloads } from '@/shared/queue'
import { Button } from '@/shared/ui/button'
import { RefreshCw } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

/**
 * Favorite page content component.
 *
 * This is the content portion of the favorite page without the layout wrapper.
 * It should be rendered inside a PageLayoutShell or similar layout.
 *
 * Provides a favorites management interface including:
 * - Folder selection dropdown
 * - Virtual scrolling for large lists
 * - Download navigation with confirmation
 *
 * @example
 * ```tsx
 * // Inside PersistentPageLayout
 * <FavoriteContent />
 * ```
 */
export function FavoriteContent() {
  const { t } = useTranslation()
  const user = useSelector((state) => state.user)
  const hasActiveDownloads = useSelector(selectHasActiveDownloads)
  const handleDownload = usePendingDownload()

  const mid = user.data?.isLogin ? (user.data.mid ?? null) : null

  const {
    folders,
    selectedFolderId,
    videos,
    hasMore,
    loading,
    foldersLoading,
    selectFolder,
    loadMore,
    refresh,
  } = useFavorite(mid)

  useEffect(() => {
    document.title = `${t('favorite.title')} - ${t('app.title')}`
  }, [t])

  /**
   * Handles download request for a favorite video.
   *
   * Sets the video as pending download and navigates to the home page
   * where the actual download flow continues.
   *
   * @param video - The favorite video to download
   */
  const onDownload = (video: FavoriteVideo) => {
    handleDownload(video.bvid, null, video.page)
  }

  /**
   * Handles manual refresh of the favorite list.
   *
   * Re-fetches data and shows a success toast.
   */
  const handleRefresh = () => {
    refresh()
    toast.success(t('favorite.refreshed'))
  }

  if (!user.hasCookie || !user.data?.isLogin) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-4 p-8">
        <p className="text-muted-foreground text-center text-lg">
          {t('favorite.loginRequired')}
        </p>
      </div>
    )
  }

  return (
    <PageTemplate
      title={t('favorite.title')}
      actions={
        <>
          <div className="flex flex-1 items-center gap-2">
            <FolderSelector
              folders={folders}
              selectedId={selectedFolderId}
              onSelect={selectFolder}
              loading={foldersLoading}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={loading || !selectedFolderId}
            >
              <RefreshCw size={18} />
              <span className="hidden md:inline">{t('favorite.refresh')}</span>
            </Button>
          </div>
        </>
      }
    >
      <div className="min-h-0 flex-1">
        <FavoriteList
          videos={videos}
          loading={loading}
          foldersLoading={foldersLoading}
          hasMore={hasMore}
          onLoadMore={loadMore}
          onDownload={onDownload}
          disabled={hasActiveDownloads}
        />
      </div>
    </PageTemplate>
  )
}

export default FavoriteContent
