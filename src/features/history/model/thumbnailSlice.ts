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

import {
  createAsyncThunk,
  createSlice,
  type PayloadAction,
} from '@reduxjs/toolkit'
import { getThumbnailBase64 } from '../api/thumbnailApi'

/** Maximum number of thumbnails to store in cache (LRU eviction threshold) */
const MAX_CACHE_ENTRIES = 200

/** Default cache TTL in milliseconds (1 hour) */
const DEFAULT_CACHE_MAX_AGE = 60 * 60 * 1000

/**
 * Represents a cached thumbnail entry.
 *
 * @property data - Base64-encoded image data URL
 * @property loading - Whether a fetch is in progress
 * @property error - Error message if fetch failed, null otherwise
 * @property timestamp - Unix timestamp in milliseconds when entry was created/updated
 */
export type CachedThumbnail = {
  data: string
  loading: boolean
  error: string | null
  timestamp: number
}

/**
 * Thumbnail cache state structure.
 *
 * @property cache - Map of URL to cached thumbnail entries
 * @property maxAge - Cache TTL in milliseconds (default: 1 hour)
 */
export type ThumbnailCacheState = {
  cache: Record<string, CachedThumbnail>
  maxAge: number
}

/** Initial cache state with empty cache and default TTL */
const initialState: ThumbnailCacheState = {
  cache: {},
  maxAge: DEFAULT_CACHE_MAX_AGE,
}

/**
 * Async thunk to fetch and cache a thumbnail image.
 *
 * Implements request deduplication to prevent concurrent fetches
 * of the same URL. Skips fetch if URL is already loading or cached.
 *
 * @param url - The thumbnail URL to fetch
 * @returns Promise resolving to { url, data } on success
 * @throws Rejects with { url, error } on failure
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
      return !(entry?.loading || (entry?.data && !entry.error))
    },
  },
)

/**
 * Creates a new cache entry with loading state.
 *
 * @param data - Optional initial data (default: empty string)
 * @returns A new CachedThumbnail entry
 */
const createEntry = (data = ''): CachedThumbnail => ({
  data,
  loading: true,
  error: null,
  timestamp: Date.now(),
})

const thumbnailSlice = createSlice({
  name: 'thumbnailCache',
  initialState,
  reducers: {
    /**
     * Manually sets a thumbnail in the cache.
     *
     * @param state - Current state
     * @param action - Action containing { url, data }
     */
    setThumbnail(state, action: PayloadAction<{ url: string; data: string }>) {
      const { url, data } = action.payload
      state.cache[url] = {
        data,
        loading: false,
        error: null,
        timestamp: Date.now(),
      }
    },
    /**
     * Sets an error state for a cached thumbnail.
     *
     * @param state - Current state
     * @param action - Action containing { url, error }
     */
    setThumbnailError(
      state,
      action: PayloadAction<{ url: string; error: string }>,
    ) {
      const entry = state.cache[action.payload.url]
      if (entry) {
        entry.loading = false
        entry.error = action.payload.error
      }
    },
    /**
     * Removes a thumbnail from the cache.
     *
     * @param state - Current state
     * @param action - Action containing the URL to remove
     */
    removeThumbnail(state, action: PayloadAction<string>) {
      delete state.cache[action.payload]
    },
    /**
     * Removes all expired cache entries based on TTL.
     *
     * Entries older than maxAge (default: 1 hour) are deleted.
     *
     * @param state - Current state
     */
    clearExpiredEntries(state) {
      const now = Date.now()
      const expiredUrls = Object.entries(state.cache)
        .filter(([, entry]) => now - entry.timestamp > state.maxAge)
        .map(([url]) => url)
      expiredUrls.forEach((url) => delete state.cache[url])
    },
    /**
     * Clears all cache entries.
     *
     * @param state - Current state
     */
    clearCache(state) {
      state.cache = {}
    },
    /**
     * Evicts oldest entries when cache exceeds maximum size.
     *
     * Implements LRU (Least Recently Used) eviction policy.
     * Removes oldest entries until cache size is within MAX_CACHE_ENTRIES.
     *
     * @param state - Current state
     */
    evictOldestEntries(state) {
      const entries = Object.entries(state.cache)
      if (entries.length <= MAX_CACHE_ENTRIES) return

      const sorted = entries.sort((a, b) => a[1].timestamp - b[1].timestamp)
      sorted.slice(0, entries.length - MAX_CACHE_ENTRIES).forEach(([url]) => {
        delete state.cache[url]
      })
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchThumbnail.pending, (state, action) => {
        const url = action.meta.arg
        if (!state.cache[url]) {
          state.cache[url] = createEntry()
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
