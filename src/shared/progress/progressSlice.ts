import type { Progress } from '@/components/lib/Progress'

// We'll store per-phase progress entries. Each entry will have an internalId and parentId.
// internalId = payload.stage ? `${payload.downloadId}:${payload.stage}` : payload.downloadId

import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'

const initialState: Progress[] = []

export const progressSlice = createSlice({
  name: 'progress',
  initialState,
  reducers: {
    setProgress(state, action: PayloadAction<Progress>) {
      const payload = action.payload
      // compute internal id and parent id
      const internalId = payload.stage
        ? `${payload.downloadId}:${payload.stage}`
        : payload.downloadId
      const parentId = payload.downloadId
      const entry = { ...payload, internalId, parentId }
      const idx = state.findIndex((p) => p.internalId === internalId)

      if (idx === -1) {
        state.push(entry)
      } else {
        state[idx] = entry
      }
    },
    clearProgress() {
      return []
    },
  },
})

export const { setProgress, clearProgress } = progressSlice.actions
export default progressSlice.reducer
