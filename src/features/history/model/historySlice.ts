import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'

/**
 * History entry representing a completed download.
 */
export type HistoryEntry = {
  /** Unique history identifier */
  id: string
  /** Video title */
  title: string
  /** Source URL */
  url: string
  /** Output filename */
  filename?: string
  /** Output directory path */
  outputPath?: string
  /** Download timestamp in ISO 8601 format */
  downloadedAt: string
  /** Video duration in seconds */
  duration?: number
  /** Download status */
  status: 'completed' | 'failed'
  /** Error message if status is 'failed' */
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
 * History filters for filtering entries.
 */
export type HistoryFilters = {
  /** Status filter (all = no filtering) */
  status?: 'all' | 'completed' | 'failed'
  /** Optional date range start (ISO 8601) */
  dateFrom?: string
}

/**
 * History state managing download history.
 */
export type HistoryState = {
  /** Array of history entries */
  entries: HistoryEntry[]
  /** Loading state for history operations */
  loading: boolean
  /** Error message if any operation failed */
  error: string | null
  /** Current filters applied */
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
 * Redux slice for download history management.
 *
 * Manages completed download history with filtering and search capabilities.
 * History entries are persisted separately (not handled by this slice).
 */
export const historySlice = createSlice({
  name: 'history',
  initialState,
  reducers: {
    /**
     * Replaces all entries in history.
     *
     * Used when loading history from backend.
     *
     * @param state - Current history state
     * @param action - Action containing array of entries
     */
    setEntries(state, action: PayloadAction<HistoryEntry[]>) {
      state.entries = action.payload
    },
    /**
     * Adds a single entry to history.
     *
     * Prepends entry to array (newest first).
     *
     * @param state - Current history state
     * @param action - Action containing entry to add
     */
    addEntry(state, action: PayloadAction<HistoryEntry>) {
      state.entries.unshift(action.payload)
    },
    /**
     * Removes a history entry by ID.
     *
     * @param state - Current history state
     * @param action - Action containing entry ID to remove
     */
    removeEntry(state, action: PayloadAction<string>) {
      state.entries = state.entries.filter((e) => e.id !== action.payload)
    },
    /**
     * Clears all history entries.
     *
     * @param state - Current history state
     */
    clearHistory(state) {
      state.entries = []
    },
    /**
     * Updates history filters.
     *
     * @param state - Current history state
     * @param action - Action containing new filters
     */
    setFilters(state, action: PayloadAction<HistoryFilters>) {
      state.filters = action.payload
    },
    /**
     * Updates search query.
     *
     * @param state - Current history state
     * @param action - Action containing search query string
     */
    setSearchQuery(state, action: PayloadAction<string>) {
      state.searchQuery = action.payload
    },
    /**
     * Sets loading state.
     *
     * @param state - Current history state
     * @param action - Action containing loading boolean
     */
    setLoading(state, action: PayloadAction<boolean>) {
      state.loading = action.payload
    },
    /**
     * Sets error message.
     *
     * @param state - Current history state
     * @param action - Action containing error message or null
     */
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
