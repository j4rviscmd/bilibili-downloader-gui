import type { Progress } from '@/components/lib/Progress'
import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'

const initialState: Progress[] = []

export const progressSlice = createSlice({
  name: 'progress',
  initialState,
  reducers: {
    setProgress(state, action: PayloadAction<Progress>) {
      const payload = action.payload
      const idx = state.findIndex((p) => p.downloadId === payload.downloadId)

      if (idx === -1) {
        state.push(payload)
      } else {
        state[idx] = payload
      }
    },
    clearProgress(state, action: PayloadAction<string>) {
      const id = action.payload
      const idx = state.findIndex((p) => p.downloadId === id)
      if (idx !== -1) {
        state.splice(idx, 1)
      }
    },
  },
})

export const { setProgress, clearProgress } = progressSlice.actions
export default progressSlice.reducer
