import type { Video } from '@/features/video/types'
import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'

const initialState: Video = {
  title: '',
  bvid: '',
  parts: [],
}

/**
 * Redux slice for video metadata state.
 *
 * Stores the currently fetched video information including title, ID,
 * parts, and available quality options.
 */
export const videoSlice = createSlice({
  name: 'video',
  initialState,
  reducers: {
    /**
     * Replaces the entire video metadata.
     *
     * @param _ - Previous state (unused, will be replaced)
     * @param action - Action containing the new video object
     */
    setVideo: (_, action: PayloadAction<Video>) => {
      return action.payload
    },
  },
})

export const { setVideo } = videoSlice.actions
export default videoSlice.reducer
