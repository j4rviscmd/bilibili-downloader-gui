import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'
import type { VideoSearchResponse, VideoSearchState } from '../types'
import { DEFAULT_VIDEO_SEARCH_FILTERS } from '../types'

export const initialState: VideoSearchState = {
  keyword: '',
  page: 1,
  filters: DEFAULT_VIDEO_SEARCH_FILTERS,
  results: null,
  loading: false,
  error: null,
}

/**
 * Redux slice for the keyword video search feature.
 *
 * Stores the last submitted keyword, current page, active filters and the
 * response so the persistent page layout keeps results alive across
 * navigation. Filters persist across keyword changes (bilibili behavior).
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
  },
})

export const { setResult, setFilter, setLoading, setError } =
  videoSearchSlice.actions
export default videoSearchSlice.reducer
