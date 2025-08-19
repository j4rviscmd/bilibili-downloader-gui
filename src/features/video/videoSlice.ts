import type { Video } from '@/features/video/types'
import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'

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
    setVideo: (_, action: PayloadAction<Video>) => {
      return action.payload
    },
  },
})

export const { setVideo } = videoSlice.actions
export default videoSlice.reducer
