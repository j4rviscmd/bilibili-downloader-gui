import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'

/**
 * A history entry representing a completed download.
 */
export type HistoryEntry = {
  /** Unique identifier for the history entry */
  id: string
  /** Video title */
  title: string
  /** Bilibili video ID (BV identifier, optional for backward compatibility) */
  bvid?: string
  /** Source URL */
  url: string
  /** Output filename */
  filename?: string
  /** Output directory path */
  outputPath?: string
  /** Download timestamp (ISO 8601 format) */
  downloadedAt: string
  /** Video duration in seconds */
  duration?: number
  /** Download status */
  status: 'completed' | 'failed'
  /** Error message when status is 'failed' */
  errorMessage?: string
  /** File size in bytes */
  fileSize?: number
  /** Video quality (e.g., '1080p', '720p') */
  quality?: string
  /** Thumbnail image URL */
  thumbnailUrl?: string
}

/**
 * Alias for HistoryEntry to maintain compatibility with existing code.
 */
export type HistoryItem = HistoryEntry

/**
 * Filters for history entry filtering.
 */
export type HistoryFilters = {
  /** Status filter (all = no filtering) */
  status?: 'all' | 'completed' | 'failed'
  /** Optional date range start (ISO 8601 format) */
  dateFrom?: string
}

/**
 * State for managing download history.
 */
export type HistoryState = {
  /** Array of history entries */
  entries: HistoryEntry[]
  /** Loading state for history operations */
  loading: boolean
  /** Error message when operation fails */
  error: string | null
  /** Currently applied filters */
  filters: HistoryFilters
  /** Search query string */
  searchQuery: string
}

const initialState: HistoryState = {
  entries: [],
  loading: false,
  error: null,
  filters: {},
  searchQuery: '',
}

/**
 * Redux slice for managing download history.
 * Manages completed download history with filtering and search capabilities.
 */
export const historySlice = createSlice({
  name: 'history',
  initialState,
  reducers: {
    /** Replaces history with entries loaded from the backend. */
    setEntries(state, action: PayloadAction<HistoryEntry[]>) {
      state.entries = action.payload
    },
    /** Adds an entry to the beginning of the array (newest first). */
    addEntry(state, action: PayloadAction<HistoryEntry>) {
      state.entries.unshift(action.payload)
    },
    /** Removes a history entry by ID. */
    removeEntry(state, action: PayloadAction<string>) {
      state.entries = state.entries.filter((e) => e.id !== action.payload)
    },
    /** Clears all history entries. */
    clearHistory(state) {
      state.entries = []
    },
    /** Updates history filters. */
    setFilters(state, action: PayloadAction<HistoryFilters>) {
      state.filters = action.payload
    },
    /** Updates search query. */
    setSearchQuery(state, action: PayloadAction<string>) {
      state.searchQuery = action.payload
    },
    /** Sets loading state. */
    setLoading(state, action: PayloadAction<boolean>) {
      state.loading = action.payload
    },
    /** Sets error message. */
    setError(state, action: PayloadAction<string | null>) {
      state.error = action.payload
    },
  },
})

export const {
  setEntries,
  addEntry,
  removeEntry,
  clearHistory,
  setFilters,
  setSearchQuery,
  setLoading,
  setError,
} = historySlice.actions

export default historySlice.reducer
