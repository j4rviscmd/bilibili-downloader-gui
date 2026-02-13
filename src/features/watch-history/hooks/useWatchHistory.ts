import { useAppDispatch, useSelector as useAppSelector } from '@/app/store'
import { useCallback } from 'react'
import { fetchWatchHistory } from '../api/fetchWatchHistory'
import {
  selectDateFilter,
  selectFilteredEntries,
  selectSearchQuery,
  selectWatchHistoryCursor,
  selectWatchHistoryError,
  selectWatchHistoryLoading,
  selectWatchHistoryLoadingMore,
} from '../model/selectors'
import {
  appendEntries,
  setCursor,
  setDateFilter,
  setEntries,
  setError,
  setLoading,
  setLoadingMore,
  setSearchQuery,
} from '../model/watchHistorySlice'

/**
 * Custom hook for managing watch history state and operations.
 *
 * Provides a complete interface for fetching, filtering, and paginating
 * through the user's Bilibili watch history. Handles loading states,
 * error management, and infinite scroll support.
 *
 * @returns An object containing:
 * - `entries` - Filtered watch history entries
 * - `cursor` - Pagination cursor for infinite scroll
 * - `loading` - Initial load state
 * - `loadingMore` - Load more state
 * - `error` - Error message if any
 * - `fetchInitial` - Function to fetch initial history
 * - `fetchMore` - Function to load more entries
 * - `setSearch` - Function to update search query
 * - `setDate` - Function to update date filter
 *
 * @example
 * ```typescript
 * const {
 *   entries,
 *   loading,
 *   loadingMore,
 *   error,
 *   fetchInitial,
 *   fetchMore,
 *   setSearch,
 *   setDate,
 * } = useWatchHistory()
 *
 * // Fetch initial data on mount
 * useEffect(() => {
 *   fetchInitial()
 * }, [fetchInitial])
 *
 * // Handle search
 * <Input onChange={(e) => setSearch(e.target.value)} />
 *
 * // Handle infinite scroll
 * <div onScroll={() => {
 *   if (nearBottom && !loadingMore) fetchMore()
 * }}>
 * ```
 */
export function useWatchHistory() {
  const dispatch = useAppDispatch()
  const entries = useAppSelector(selectFilteredEntries)
  const cursor = useAppSelector(selectWatchHistoryCursor)
  const loading = useAppSelector(selectWatchHistoryLoading)
  const loadingMore = useAppSelector(selectWatchHistoryLoadingMore)
  const error = useAppSelector(selectWatchHistoryError)
  const searchQuery = useAppSelector(selectSearchQuery)
  const dateFilter = useAppSelector(selectDateFilter)

  /**
   * Fetches the initial batch of watch history entries.
   */
  const fetchInitial = useCallback(async () => {
    dispatch(setLoading(true))
    dispatch(setError(null))
    try {
      const response = await fetchWatchHistory(20, 0)
      dispatch(setEntries(response.entries))
      dispatch(setCursor(response.cursor))
    } catch (err) {
      dispatch(setError(err instanceof Error ? err.message : String(err)))
    } finally {
      dispatch(setLoading(false))
    }
  }, [dispatch])

  /**
   * Fetches the next batch of watch history entries.
   */
  const fetchMore = useCallback(async () => {
    if (!cursor || cursor.isEnd || loadingMore) return
    dispatch(setLoadingMore(true))
    try {
      const response = await fetchWatchHistory(20, cursor.viewAt)
      dispatch(appendEntries(response.entries))
      dispatch(setCursor(response.cursor))
    } catch (err) {
      dispatch(setError(err instanceof Error ? err.message : String(err)))
    } finally {
      dispatch(setLoadingMore(false))
    }
  }, [dispatch, cursor, loadingMore])

  const setSearch = useCallback(
    (query: string) => dispatch(setSearchQuery(query)),
    [dispatch],
  )

  const setDate = useCallback(
    (filter: 'all' | 'today' | 'week' | 'month') =>
      dispatch(setDateFilter(filter)),
    [dispatch],
  )

  return {
    entries,
    cursor,
    loading,
    loadingMore,
    error,
    searchQuery,
    dateFilter,
    fetchInitial,
    fetchMore,
    setSearch,
    setDate,
  }
}
