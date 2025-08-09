import type { Progress } from '@/components/lib/Progress'
import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'

const initialState: Progress = {
  downloadId: '',
  filesize: 0,
  downloaded: 0,
  transferRate: 0,
  percentage: 0,
  elapsedTime: 0,
  isComplete: false,
}

export const progressSlice = createSlice({
  name: 'progress',
  initialState,
  reducers: {
    setProgress(_state, action: PayloadAction<Progress>) {
      return action.payload
    },
    clearProgress() {
      return initialState
    },
  },
})

export const { setProgress, clearProgress } = progressSlice.actions
export default progressSlice.reducer
