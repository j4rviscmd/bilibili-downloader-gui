import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'
import type { VideoSearchResponse, VideoSearchState } from '../types'

export const initialState: VideoSearchState = {
  keyword: '',
  page: 1,
  results: null,
  loading: false,
  error: null,
}

/**
 * Redux slice for the keyword video search feature.
 *
 * Stores the last submitted keyword, current page and the response so the
 * persistent page layout keeps results alive across navigation.
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
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload
    },
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload
    },
  },
})

export const { setResult, setLoading, setError } = videoSearchSlice.actions
export default videoSearchSlice.reducer
