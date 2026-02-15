import { useSelector } from '@/app/store'
import { useFavorite } from '@/features/favorite/hooks/useFavorite'
import type { FavoriteVideo } from '@/features/favorite/types'
import FavoriteList from '@/features/favorite/ui/FavoriteList'
import FolderSelector from '@/features/favorite/ui/FolderSelector'
import { Button } from '@/shared/ui/button'
import { RefreshCw } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
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
  const navigate = useNavigate()

  const user = useSelector((state) => state.user)

  const mid = user.data?.isLogin && user.data?.mid ? user.data.mid : null

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

  const handleDownload = (video: FavoriteVideo) => {
    const url = `https://www.bilibili.com/video/${video.bvid}${video.page > 1 ? `?p=${video.page}` : ''}`
    navigate(`/home?autoFetch=${encodeURIComponent(url)}`)
  }

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
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-border shrink-0 border-b p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-xl font-semibold">{t('favorite.title')}</h1>
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
        </div>
      </div>

      <FavoriteList
        videos={videos}
        loading={loading}
        foldersLoading={foldersLoading}
        hasMore={hasMore}
        onLoadMore={loadMore}
        onDownload={handleDownload}
        height="calc(100dvh - 2.3rem - 80px)"
      />
    </div>
  )
}

export default FavoriteContent
