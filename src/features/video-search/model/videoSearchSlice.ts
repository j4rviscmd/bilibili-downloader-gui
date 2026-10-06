import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'
import type {
  VideoSearchFilters,
  VideoSearchResponse,
  VideoSearchState,
} from '../types'
import { DEFAULT_VIDEO_SEARCH_FILTERS } from '../types'

/** Session search-response cache capacity (entries). One entry is one
 * keyword+page+filters result page (~20 cards); 10 keeps history
 * back/forward hits free of refetches at trivial memory cost. */
const SEARCH_CACHE_LIMIT = 10

export const initialState: VideoSearchState = {
  keyword: '',
  page: 1,
  filters: DEFAULT_VIDEO_SEARCH_FILTERS,
  results: null,
  loading: false,
  error: null,
  cache: {},
}

/**
 * Cache key of one search result page: every param that changes the
 * response (keyword, page, order/duration/zone filters).
 */
export function searchCacheKey(
  keyword: string,
  page: number,
  filters: VideoSearchFilters,
): string {
  return `${keyword}|${page}|${filters.order}|${filters.duration}|${filters.tids}`
}

/**
 * Redux slice for the keyword video search feature.
 *
 * Stores the last submitted keyword, current page, active filters and the
 * response so the persistent page layout keeps results alive across
 * navigation. Filters persist across keyword changes (bilibili behavior).
 *
 * `cache` holds recent responses per searchCacheKey so history
 * back/forward (and revisiting a page/filter combo) skips the API call —
 * rate-control (-412) risk grows with request count. An intentional
 * same-keyword resubmit bypasses the cache (refresh path in
 * useVideoSearch).
 */
export const videoSearchSlice = createSlice({
  name: 'videoSearch',
  initialState,
  reducers: {
    setResult: (
      state,
      action: PayloadAction<{
        keyword: string
        page: number
        response: VideoSearchResponse
      }>,
    ) => {
      state.keyword = action.payload.keyword
      state.page = action.payload.page
      state.results = action.payload.response
      state.error = null
    },
    /** Patches one or more filter fields (caller re-runs the search). */
    setFilter: (
      state,
      action: PayloadAction<Partial<VideoSearchState['filters']>>,
    ) => {
      state.filters = { ...state.filters, ...action.payload }
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload
    },
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload
    },
    /** Stores one fetched response under its key, evicting the
     * least-recently-stored entry beyond the capacity. */
    cacheStore: (
      state,
      action: PayloadAction<{ key: string; response: VideoSearchResponse }>,
    ) => {
      const { key, response } = action.payload
      // Delete first so a re-store refreshes the insertion-order position.
      delete state.cache[key]
      state.cache[key] = response
      const keys = Object.keys(state.cache)
      if (keys.length > SEARCH_CACHE_LIMIT) {
        delete state.cache[keys[0]]
      }
    },
    /** Clears the response cache (test seam; also a future refresh-all). */
    clearSearchCache: (state) => {
      state.cache = {}
    },
  },
})

export const {
  setResult,
  setFilter,
  setLoading,
  setError,
  cacheStore,
  clearSearchCache,
} = videoSearchSlice.actions
export default videoSearchSlice.reducer
