import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'

/**
 * Queue item representing a download task.
 */
export type QueueItem = {
  /** Unique download identifier */
  downloadId: string
  /** Optional parent ID for grouping multi-part downloads */
  parentId?: string
  /** Output filename */
  filename?: string
  /** Current status */
  status?: 'pending' | 'running' | 'done' | 'error'
  /** Error message if status is 'error' */
  errorMessage?: string
}

const initialState: QueueItem[] = []

/**
 * Redux slice for download queue management.
 *
 * Manages the queue of pending, running, and completed downloads.
 * Automatically updates parent status based on children.
 */
export const queueSlice = createSlice({
  name: 'queue',
  initialState,
  reducers: {
    /**
     * Adds a download to the queue.
     *
     * Skips if an item with the same downloadId already exists.
     *
     * @param state - Current queue state
     * @param action - Action containing the queue item
     */
    enqueue(state, action: PayloadAction<QueueItem>) {
      const payload = action.payload
      if (!state.find((i) => i.downloadId === payload.downloadId)) {
        state.push({ ...payload, status: payload.status || 'pending' })
      }
    },
    /**
     * Removes a download from the queue.
     *
     * Also removes all children if the provided ID is a parent.
     *
     * @param state - Current queue state
     * @param action - Action containing the download ID to remove
     */
    dequeue(state, action: PayloadAction<string>) {
      const id = action.payload
      return state.filter((i) => i.downloadId !== id && i.parentId !== id)
    },
    /**
     * Clears all items from the queue.
     */
    clearQueue() {
      return []
    },
    /**
     * Updates the status of a queue item.
     *
     * Automatically aggregates parent status based on children:
     * - If all children are 'done', parent becomes 'done'
     * - If any child is 'error', parent becomes 'error'
     * - If any child is 'running', parent becomes 'running'
     *
     * @param state - Current queue state
     * @param action - Action containing the download ID and new status
     */
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
