import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'
import type {
  WatchHistoryCursor,
  WatchHistoryEntry,
  WatchHistoryState,
} from '../types'

const initialState: WatchHistoryState = {
  entries: [],
  cursor: null,
  loading: false,
  loadingMore: false,
  error: null,
  searchQuery: '',
  dateFilter: 'all',
}

/**
 * Redux slice for watch history state management.
 *
 * Manages the list of watched videos, pagination cursor, loading states,
 * and filter options for the watch history feature.
 */
export const watchHistorySlice = createSlice({
  name: 'watchHistory',
  initialState,
  reducers: {
    setEntries: (state, action: PayloadAction<WatchHistoryEntry[]>) => {
      state.entries = action.payload
    },
    appendEntries: (state, action: PayloadAction<WatchHistoryEntry[]>) => {
      state.entries = [...state.entries, ...action.payload]
    },
    setCursor: (state, action: PayloadAction<WatchHistoryCursor | null>) => {
      state.cursor = action.payload
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload
    },
    setLoadingMore: (state, action: PayloadAction<boolean>) => {
      state.loadingMore = action.payload
    },
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload
    },
    setSearchQuery: (state, action: PayloadAction<string>) => {
      state.searchQuery = action.payload
    },
    setDateFilter: (
      state,
      action: PayloadAction<'all' | 'today' | 'week' | 'month'>,
    ) => {
      state.dateFilter = action.payload
    },
    reset: () => initialState,
  },
})

export const {
  setEntries,
  appendEntries,
  setCursor,
  setLoading,
  setLoadingMore,
  setError,
  setSearchQuery,
  setDateFilter,
  reset,
} = watchHistorySlice.actions

export default watchHistorySlice.reducer
