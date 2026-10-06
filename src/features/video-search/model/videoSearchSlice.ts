import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'
import type {
  VideoSearchFeed,
  VideoSearchFilters,
  VideoSearchResponse,
  VideoSearchState,
} from '../types'
import { DEFAULT_VIDEO_SEARCH_FILTERS } from '../types'

/** Session search-response cache capacity (entries). One entry is one
 * keyword+page+filters result page (~20 cards); 10 keeps history
 * back/forward hits free of refetches at trivial memory cost. */
const SEARCH_CACHE_LIMIT = 10

/** Per-keyword accumulated feeds kept in the stack (visited keywords). */
const FEEDS_LIMIT = 10

/** Inserts/refreshes one feed in the stack, evicting the oldest beyond
 * the capacity. Why an explicit order array instead of Object.keys
 * (unlike cacheStore): JS objects order integer-like keys ('2024' —
 * plausible year-number keywords) numerically first regardless of
 * insertion, which would evict the wrong entry. */
function storeFeed(
  state: VideoSearchState,
  keyword: string,
  feed: VideoSearchFeed,
) {
  const at = state.feedOrder.indexOf(keyword)
  if (at >= 0) state.feedOrder.splice(at, 1)
  state.feedOrder.push(keyword)
  state.feeds[keyword] = feed
  while (state.feedOrder.length > FEEDS_LIMIT) {
    const oldest = state.feedOrder.shift()
    if (oldest === undefined) break
    delete state.feeds[oldest]
  }
}

export const initialState: VideoSearchState = {
  keyword: '',
  page: 1,
  filters: DEFAULT_VIDEO_SEARCH_FILTERS,
  results: null,
  entries: [],
  loading: false,
  error: null,
  cache: {},
  feeds: {},
  feedOrder: [],
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
 * navigation. Filters persist toward never-visited keywords (bilibili
 * behavior); restoring a visited keyword brings back its own filters.
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
      const { keyword, page, response } = action.payload
      // Infinite-scroll accumulation: only a continuous next page of the
      // same keyword appends. Any page-1 fetch (new keyword, filter
      // change, cache restore) replaces the feed. Result pages can shift
      // between requests, so appends dedupe by bvid.
      const contiguous =
        page > 1 && keyword === state.keyword && page === state.page + 1
      if (contiguous) {
        const seen = new Set(state.entries.map((e) => e.bvid))
        state.entries = state.entries.concat(
          response.entries.filter((e) => !seen.has(e.bvid)),
        )
      } else {
        state.entries = response.entries
      }
      state.keyword = keyword
      state.page = page
      state.results = response
      state.error = null
      // Stack write-through: the keyword's stored feed always mirrors the
      // live accumulation, so switching back restores it instantly.
      storeFeed(state, keyword, {
        filters: state.filters,
        entries: state.entries,
        page,
        numPages: response.numPages,
        numResults: response.numResults,
      })
    },
    /** Restores a keyword's stored feed (history back/forward): sync,
     * no refetch — the page's stacked scroll container keeps its loaded
     * pages and scroll position on its own. */
    restoreFeed: (
      state,
      action: PayloadAction<{ keyword: string; feed: VideoSearchFeed }>,
    ) => {
      const { keyword, feed } = action.payload
      state.keyword = keyword
      state.filters = feed.filters
      state.entries = feed.entries
      state.page = feed.page
      // Synthesized response: the view derives numPages/numResults from
      // `results`; the entries themselves render from the feed.
      state.results = {
        page: feed.page,
        numResults: feed.numResults,
        numPages: feed.numPages,
        entries: feed.entries,
      }
      state.error = null
      // Why: the caller bumped reqId before dispatching, so a still
      // in-flight fetch for the previous feed never runs its guarded
      // finally — the restore clears the spinner itself (same as the
      // cache-hit path in useVideoSearch).
      state.loading = false
      // Why re-store an already-stored feed: storeFeed re-inserts the
      // keyword at the recency end of feedOrder, so eviction drops the
      // least-recently-visited feed, not the first-loaded one.
      storeFeed(state, keyword, feed)
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
    /** Clears the keyword feed stack (test seam; same role as
     * clearSearchCache). */
    clearFeeds: (state) => {
      state.feeds = {}
      state.feedOrder = []
    },
    /** Clears the accumulated cards (the list falls back to its skeleton
     * while a fresh page-1 fetch is in flight). */
    resetEntries: (state) => {
      state.entries = []
    },
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
  clearFeeds,
  resetEntries,
  restoreFeed,
} = videoSearchSlice.actions
export default videoSearchSlice.reducer
