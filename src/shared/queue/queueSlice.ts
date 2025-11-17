import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'

export type QueueItem = {
  downloadId: string
  filename?: string
}

const initialState: QueueItem[] = []

export const queueSlice = createSlice({
  name: 'queue',
  initialState,
  reducers: {
    enqueue(state, action: PayloadAction<QueueItem>) {
      const payload = action.payload
      if (!state.find((i) => i.downloadId === payload.downloadId)) {
        state.push(payload)
      }
    },
    dequeue(state, action: PayloadAction<string>) {
      const id = action.payload
      return state.filter((i) => i.downloadId !== id)
    },
    clearQueue() {
      return []
    },
  },
})

export const { enqueue, dequeue, clearQueue } = queueSlice.actions
export default queueSlice.reducer
