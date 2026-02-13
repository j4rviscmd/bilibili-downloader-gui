import { useAppDispatch, useSelector } from '@/app/store'
import { setPendingDownload } from '@/features/video'
import type { WatchHistoryEntry } from '@/features/watch-history'
import {
  useWatchHistory,
  WatchHistoryFilters,
  WatchHistoryList,
  WatchHistorySearch,
} from '@/features/watch-history'
import { PageLayout } from '@/shared/layout'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

/**
 * Watch history page component.
 *
 * Displays the user's Bilibili watch history with search and filter
 * capabilities. Requires login to access. Provides direct navigation
 * to download selected videos from the history.
 */
function WatchHistoryPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const dispatch = useAppDispatch()
  const user = useSelector((state) => state.user)

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
    setSearch,
    setDate,
  } = useWatchHistory()

  // Check if user is logged in
  const isLoggedIn = user.hasCookie && user.data?.isLogin

  useEffect(() => {
    document.title = `${t('watchHistory.title')} - ${t('app.title')}`
  }, [t])

  useEffect(() => {
    if (isLoggedIn) {
      fetchInitial()
    }
  }, [isLoggedIn, fetchInitial])

  const handleDownload = (entry: WatchHistoryEntry) => {
    dispatch(
      setPendingDownload({
        bvid: entry.bvid,
        cid: entry.cid,
        page: entry.page,
      }),
    )
    navigate('/home')
  }

  if (!isLoggedIn) {
    return (
      <PageLayout>
        <div className="flex flex-col items-center justify-center py-12">
          <p className="text-muted-foreground">
            {t('watchHistory.loginRequired')}
          </p>
        </div>
      </PageLayout>
    )
  }

  return (
    <PageLayout withScrollArea={false} innerClassName="h-full gap-0 p-0">
      <div className="flex h-full flex-col overflow-hidden">
        <div className="border-border shrink-0 border-b p-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h1 className="text-xl font-semibold">{t('watchHistory.title')}</h1>
            <div className="flex flex-1 items-center gap-2">
              <WatchHistorySearch value={searchQuery} onChange={setSearch} />
              <WatchHistoryFilters value={dateFilter} onChange={setDate} />
            </div>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 rounded-lg border border-red-500 bg-red-50 p-4 text-red-600">
            {error}
          </div>
        )}

        {/* List */}
        <WatchHistoryList
          entries={entries}
          loading={loading}
          loadingMore={loadingMore}
          hasMore={cursor ? !cursor.isEnd : false}
          onLoadMore={fetchMore}
          onDownload={handleDownload}
          height="calc(100dvh - 2.3rem - 80px)"
        />
      </div>
    </PageLayout>
  )
}

export default WatchHistoryPage
