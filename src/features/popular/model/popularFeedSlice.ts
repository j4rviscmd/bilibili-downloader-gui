import type { VideoSearchEntry } from '@/features/video-search'
import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'

/** Redux state of the popular (おすすめ) feed feature. */
export interface PopularFeedState {
  /** Loaded videos, accumulated across pages (infinite scroll). */
  items: VideoSearchEntry[]
  /** Last loaded page; 0 before the first load. */
  page: number
  /** True once the API reports `no_more` — sentinel stops loading. */
  noMore: boolean
  loading: boolean
  error: string | null
}

export const initialState: PopularFeedState = {
  items: [],
  page: 0,
  noMore: false,
  loading: false,
  error: null,
}

/**
 * Redux slice for the popular feed — the video-search feature's default
 * entry view (bilibili-style recommendations).
 *
 * Items accumulate (unlike the search slice's page replacement) so the
 * persistent layout keeps the whole loaded feed alive across navigation;
 * the page is kept mounted by PersistentPageLayout, so the state also
 * survives route switches without redux-persist.
 */
export const popularFeedSlice = createSlice({
  name: 'popularFeed',
  initialState,
  reducers: {
    /** Appends one fetched page, deduping by bvid (the feed rotates and
     * can repeat videos across page fetches). */
    appendPage: (
      state,
      action: PayloadAction<{
        page: number
        entries: VideoSearchEntry[]
        noMore: boolean
      }>,
    ) => {
      const seen = new Set(state.items.map((item) => item.bvid))
      state.items.push(
        ...action.payload.entries.filter((entry) => !seen.has(entry.bvid)),
      )
      state.page = action.payload.page
      state.noMore = action.payload.noMore
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload
    },
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload
    },
    /** Clears the feed back to the pre-first-load state (test seam;
     * a future refresh action would reuse it). */
    resetFeed: () => initialState,
  },
})

export const { appendPage, setLoading, setError, resetFeed } =
  popularFeedSlice.actions
export default popularFeedSlice.reducer
