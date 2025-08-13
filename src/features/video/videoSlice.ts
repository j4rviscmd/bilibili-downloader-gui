import type { Video } from '@/features/video/types'
import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'

// TODO: remove debug
const initialState: Video = {
  bvid: '',
  title: '',
  cid: 0,
  qualities: [],
}

export const videoSlice = createSlice({
  name: 'video',
  initialState,
  reducers: {
    setVideo: (state, action: PayloadAction<Video>) => {
      return (state = action.payload)
    },
  },
})

export const { setVideo } = videoSlice.actions
export default videoSlice.reducer
