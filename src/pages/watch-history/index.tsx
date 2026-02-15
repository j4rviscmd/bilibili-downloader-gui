import { useSelector } from '@/app/store'
import type { WatchHistoryEntry } from '@/features/watch-history'
import {
  useWatchHistory,
  WatchHistoryFilters,
  WatchHistoryList,
  WatchHistorySearch,
} from '@/features/watch-history'
import { selectHasActiveDownloads } from '@/shared/queue'
import { usePendingDownload } from '@/shared/hooks/usePendingDownload'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

/**
 * Watch history page content component.
 *
 * This is the content portion of the watch history page without the layout wrapper.
 * It should be rendered inside a PageLayoutShell or similar layout.
 *
 * Displays the user's Bilibili watch history with search and filter
 * capabilities. Requires login to access. Provides direct navigation
 * to download selected videos from the history.
 *
 * @example
 * ```tsx
 * // Inside PersistentPageLayout
 * <WatchHistoryContent />
 * ```
 */
export function WatchHistoryContent() {
  const { t } = useTranslation()
  const user = useSelector((state) => state.user)
  const hasActiveDownloads = useSelector(selectHasActiveDownloads)
  const handleDownload = usePendingDownload()

  const {
    entries,
    loading,
    loadingMore,
    cursor,
    error,
    searchQuery,
    dateFilter,
    fetchInitial,
    fetchMore,
    refresh,
    setSearch,
    setDate,
  } = useWatchHistory()

  const isLoggedIn = Boolean(user.hasCookie && user.data?.isLogin)

  useEffect(() => {
    document.title = `${t('watchHistory.title')} - ${t('app.title')}`
  }, [t])

  useEffect(() => {
    if (isLoggedIn) {
      fetchInitial()
    }
  }, [isLoggedIn, fetchInitial])

  /**
   * Handles download request for a watch history entry.
   *
   * Sets the entry as pending download and navigates to the home page
   * where the actual download flow continues.
   *
   * @param entry - The watch history entry to download
   */
  const onDownload = (entry: WatchHistoryEntry) => {
    handleDownload(entry.bvid, entry.cid, entry.page)
  }

  /**
   * Handles manual refresh of watch history.
   *
   * Triggers a fresh data fetch and displays a success toast.
   */
  const handleRefresh = () => {
    refresh()
    toast.success(t('watchHistory.refreshed'))
  }

  if (!isLoggedIn) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-muted-foreground">
          {t('watchHistory.loginRequired')}
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-border shrink-0 border-b p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-xl font-semibold">{t('watchHistory.title')}</h1>
          <div className="flex flex-1 items-center gap-2">
            <WatchHistorySearch value={searchQuery} onChange={setSearch} />
            <WatchHistoryFilters value={dateFilter} onChange={setDate} />
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={loading}
            >
              <RefreshCw size={18} />
              <span className="hidden md:inline">
                {t('watchHistory.refresh')}
              </span>
            </Button>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <Alert variant="destructive" className="m-3">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* List */}
      <WatchHistoryList
        entries={entries}
        loading={loading}
        loadingMore={loadingMore}
        hasMore={!!cursor && !cursor.isEnd}
        onLoadMore={fetchMore}
        onDownload={onDownload}
        height="calc(100dvh - 2.3rem - 80px)"
        disabled={hasActiveDownloads}
      />
    </div>
  )
}

export default WatchHistoryContent
