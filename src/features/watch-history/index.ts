/**
 * Public API for the watch history feature.
 *
 * Displays the user's Bilibili watch history with search and filter
 * capabilities. Supports infinite scroll for loading more entries
 * and direct navigation to download selected videos.
 * @module features/watch-history
 */

// API functions
export { fetchWatchHistory } from './api/fetchWatchHistory'

// Hooks
export { useWatchHistory } from './hooks/useWatchHistory'

// Redux slice and actions
export {
  appendEntries,
  reset,
  setCursor,
  setDateFilter,
  setEntries,
  setError,
  setLoading,
  setLoadingMore,
  setSearchQuery,
  watchHistorySlice,
} from './model/watchHistorySlice'

// Selectors
export {
  selectFilteredEntries,
  selectWatchHistoryCursor,
  selectWatchHistoryEntries,
  selectWatchHistoryError,
  selectWatchHistoryLoading,
  selectWatchHistoryLoadingMore,
} from './model/selectors'

// Types
export type {
  WatchHistoryCursor,
  WatchHistoryEntry,
  WatchHistoryState,
} from './types'

// UI Components
export { WatchHistoryFilters } from './ui/WatchHistoryFilters'
export type { DateFilter } from './ui/WatchHistoryFilters'
export { WatchHistoryItem } from './ui/WatchHistoryItem'
export { WatchHistoryList } from './ui/WatchHistoryList'
export { WatchHistorySearch } from './ui/WatchHistorySearch'

// Utility functions
export {
  calculateProgress,
  formatDuration,
  formatRelativeTime,
} from './lib/utils'
