/**
 * Redux slice for managing thumbnail cache.
 *
 * Provides centralized caching for video thumbnails to avoid redundant
 * network requests and improve UI performance.
 *
 * Features:
 * - Base64 data URL storage
 * - TTL-based cache expiration (default: 1 hour)
 * - LRU eviction policy when cache exceeds max entries
 * - Duplicate request deduplication
 * @module history/model/thumbnailSlice
 */

import { getThumbnailBase64 } from '../api/thumbnailApi'
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'

/**
 * Maximum number of cached thumbnails before LRU eviction.
 */
const MAX_CACHE_ENTRIES = 200

/**
 * Default time-to-live for cache entries in milliseconds (1 hour).
 */
const DEFAULT_CACHE_MAX_AGE = 60 * 60 * 1000

/**
 * Cached thumbnail data structure.
 */
export type CachedThumbnail = {
  /** Base64 encoded data URL */
  data: string
  /** Whether the thumbnail is currently being fetched */
  loading: boolean
  /** Error message if fetch failed */
  error: string | null
  /** Timestamp when entry was created (for TTL) */
  timestamp: number
}

/**
 * Thumbnail cache state structure.
 */
export type ThumbnailCacheState = {
  /** Cache entries indexed by URL */
  cache: Record<string, CachedThumbnail>
  /** Maximum age for cache entries in milliseconds */
  maxAge: number
}

/**
 * Initial state for the thumbnail cache.
 */
const initialState: ThumbnailCacheState = {
  cache: {},
  maxAge: DEFAULT_CACHE_MAX_AGE,
}

/**
 * Async thunk to fetch a thumbnail and cache it.
 *
 * If the thumbnail is already being fetched (loading: true), this thunk
 * will not initiate a duplicate request.
 */
export const fetchThumbnail = createAsyncThunk(
  'thumbnailCache/fetchThumbnail',
  async (url: string, { rejectWithValue }) => {
    try {
      const data = await getThumbnailBase64(url)
      return { url, data }
    } catch (error) {
      return rejectWithValue({ url, error: String(error) })
    }
  },
  {
    condition: (url, { getState }) => {
      const state = getState() as { thumbnailCache: ThumbnailCacheState }
      const entry = state.thumbnailCache.cache[url]

      // Skip fetch if already loading or successfully cached
      if (entry?.loading || (entry?.data && !entry.error)) {
        return false
      }

      return true
    },
  },
)

const thumbnailSlice = createSlice({
  name: 'thumbnailCache',
  initialState,
  reducers: {
    /**
     * Manually set a thumbnail in the cache.
     */
    setThumbnail: (state, action: { payload: { url: string; data: string } }) => {
      const { url, data } = action.payload
      state.cache[url] = {
        data,
        loading: false,
        error: null,
        timestamp: Date.now(),
      }
    },

    /**
     * Mark a thumbnail as errored.
     */
    setThumbnailError: (
      state,
      action: { payload: { url: string; error: string } },
    ) => {
      const { url, error } = action.payload
      if (state.cache[url]) {
        state.cache[url].loading = false
        state.cache[url].error = error
      }
    },

    /**
     * Remove a specific thumbnail from the cache.
     */
    removeThumbnail: (state, action: { payload: string }) => {
      delete state.cache[action.payload]
    },

    /**
     * Clear expired cache entries based on TTL.
     */
    clearExpiredEntries: (state) => {
      const now = Date.now()
      Object.entries(state.cache).forEach(([url, entry]) => {
        if (now - entry.timestamp > state.maxAge) {
          delete state.cache[url]
        }
      })
    },

    /**
     * Clear all cached thumbnails.
     */
    clearCache: (state) => {
      state.cache = {}
    },

    /**
     * Evict oldest entries if cache exceeds max size (LRU policy).
     */
    evictOldestEntries: (state) => {
      const entries = Object.entries(state.cache)
      if (entries.length <= MAX_CACHE_ENTRIES) return

      // Sort by timestamp (oldest first) and remove excess
      const sorted = entries.sort((a, b) => a[1].timestamp - b[1].timestamp)
      const toRemove = sorted.slice(0, entries.length - MAX_CACHE_ENTRIES)

      toRemove.forEach(([url]) => {
        delete state.cache[url]
      })
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchThumbnail.pending, (state, action) => {
        const url = action.meta.arg
        if (!state.cache[url]) {
          state.cache[url] = {
            data: '',
            loading: true,
            error: null,
            timestamp: Date.now(),
          }
        } else {
          state.cache[url].loading = true
          state.cache[url].error = null
        }
      })
      .addCase(fetchThumbnail.fulfilled, (state, action) => {
        const { url, data } = action.payload
        state.cache[url] = {
          data,
          loading: false,
          error: null,
          timestamp: Date.now(),
        }
      })
      .addCase(fetchThumbnail.rejected, (state, action) => {
        const { url, error } = action.payload as { url: string; error: string }
        if (state.cache[url]) {
          state.cache[url].loading = false
          state.cache[url].error = error
        }
      })
  },
})

export const {
  setThumbnail,
  setThumbnailError,
  removeThumbnail,
  clearExpiredEntries,
  clearCache,
  evictOldestEntries,
} = thumbnailSlice.actions

export { thumbnailSlice }
export default thumbnailSlice.reducer
