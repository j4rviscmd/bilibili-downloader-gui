import type { RootState } from '@/app/store'
import { createSelector } from '@reduxjs/toolkit'
import type { WatchHistoryEntry } from '../types'

/**
 * Selects all watch history entries.
 *
 * @param state - Root Redux state
 * @returns Array of watch history entries
 */
export const selectWatchHistoryEntries = (state: RootState) =>
  state.watchHistory.entries

/**
 * Selects the pagination cursor.
 *
 * @param state - Root Redux state
 * @returns Current cursor or null
 */
export const selectWatchHistoryCursor = (state: RootState) =>
  state.watchHistory.cursor

/**
 * Selects the initial loading state.
 *
 * @param state - Root Redux state
 * @returns True if currently loading initial data
 */
export const selectWatchHistoryLoading = (state: RootState) =>
  state.watchHistory.loading

/**
 * Selects the loading more state.
 *
 * @param state - Root Redux state
 * @returns True if currently loading more entries
 */
export const selectWatchHistoryLoadingMore = (state: RootState) =>
  state.watchHistory.loadingMore

/**
 * Selects the error message.
 *
 * @param state - Root Redux state
 * @returns Error message or null
 */
export const selectWatchHistoryError = (state: RootState) =>
  state.watchHistory.error

/**
 * Selects the current search query.
 *
 * @param state - Root Redux state
 * @returns Current search query string
 */
export const selectSearchQuery = (state: RootState) =>
  state.watchHistory.searchQuery

/**
 * Selects the current date filter.
 *
 * @param state - Root Redux state
 * @returns Current date filter value
 */
export const selectDateFilter = (state: RootState) =>
  state.watchHistory.dateFilter

/**
 * Helper function to check if a timestamp falls within a date range.
 */
const isWithinDateRange = (
  timestamp: number,
  filter: 'all' | 'today' | 'week' | 'month',
): boolean => {
  if (filter === 'all') return true

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const filterDays: Record<'today' | 'week' | 'month', number> = {
    today: 0,
    week: 7,
    month: 30,
  }

  const cutoffDate = new Date(today)
  if (filter === 'month') {
    cutoffDate.setMonth(cutoffDate.getMonth() - 1)
  } else {
    cutoffDate.setDate(cutoffDate.getDate() - filterDays[filter])
  }

  return timestamp >= cutoffDate.getTime() / 1000
}

/**
 * Memoized selector for filtered watch history entries.
 *
 * Applies search query and date filter to the entries list.
 * Search matches against video title (case-insensitive).
 *
 * @returns Filtered array of watch history entries
 */
export const selectFilteredEntries = createSelector(
  [selectWatchHistoryEntries, selectSearchQuery, selectDateFilter],
  (entries, searchQuery, dateFilter): WatchHistoryEntry[] => {
    return entries.filter((entry) => {
      // Apply date filter
      if (!isWithinDateRange(entry.viewAt, dateFilter)) {
        return false
      }

      // Apply search filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim()
        return entry.title.toLowerCase().includes(query)
      }

      return true
    })
  },
)
