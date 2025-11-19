import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'

export type QueueItem = {
  downloadId: string
  parentId?: string
  filename?: string
  status?: 'pending' | 'running' | 'done' | 'error'
  errorMessage?: string
}

const initialState: QueueItem[] = []

export const queueSlice = createSlice({
  name: 'queue',
  initialState,
  reducers: {
    enqueue(state, action: PayloadAction<QueueItem>) {
      const payload = action.payload
      if (!state.find((i) => i.downloadId === payload.downloadId)) {
        state.push({ ...payload, status: payload.status || 'pending' })
      }
    },
    dequeue(state, action: PayloadAction<string>) {
      const id = action.payload
      return state.filter((i) => i.downloadId !== id && i.parentId !== id)
    },
    clearQueue() {
      return []
    },
    updateQueueStatus(
      state,
      action: PayloadAction<{
        downloadId: string
        status: QueueItem['status']
        errorMessage?: string
      }>,
    ) {
      const { downloadId, status, errorMessage } = action.payload
      const target = state.find((i) => i.downloadId === downloadId)
      if (target) {
        target.status = status
        if (errorMessage) target.errorMessage = errorMessage
      }
      // 親の自動集約: 子が全てdoneなら親done / 子にerrorがあれば親error
      const parentIds = new Set(
        state.map((i) => i.parentId).filter(Boolean) as string[],
      )
      parentIds.forEach((pid) => {
        const children = state.filter((i) => i.parentId === pid)
        const parent = state.find((i) => i.downloadId === pid)
        if (!parent) return
        if (children.every((c) => c.status === 'done')) parent.status = 'done'
        else if (children.some((c) => c.status === 'error'))
          parent.status = 'error'
        else if (children.some((c) => c.status === 'running'))
          parent.status = 'running'
        else parent.status = parent.status || 'pending'
      })
    },
  },
})

export const { enqueue, dequeue, clearQueue, updateQueueStatus } =
  queueSlice.actions
export default queueSlice.reducer
