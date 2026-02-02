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
  /** Output file path (available after download completes) */
  outputPath?: string
  /** Video title */
  title?: string
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
     * - If any child is 'error', parent becomes 'error'
     * - Else if any child is 'running', parent becomes 'running'
     * - Else if all children are 'done', parent becomes 'done'
     * - Otherwise, parent becomes 'pending'
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

      // 親の自動集約
      const uniqueParentIds = new Set(
        state.map((i) => i.parentId).filter(Boolean) as string[],
      )

      uniqueParentIds.forEach((parentId) => {
        const parent = state.find((i) => i.downloadId === parentId)
        if (!parent) return

        const children = state.filter((i) => i.parentId === parentId)
        const childStatuses = children.map((c) => c.status)

        // 優先度順にチェック: error > running > done > pending
        if (childStatuses.includes('error')) {
          parent.status = 'error'
        } else if (childStatuses.includes('running')) {
          parent.status = 'running'
        } else if (
          children.length > 0 &&
          childStatuses.every((s) => s === 'done')
        ) {
          parent.status = 'done'
        } else {
          parent.status = parent.status || 'pending'
        }
      })
    },
    /**
     * Updates a queue item with new data.
     *
     * Merges provided fields with existing item data.
     *
     * @param state - Current queue state
     * @param action - Action containing the download ID and fields to update
     */
    updateQueueItem(
      state,
      action: PayloadAction<Partial<QueueItem> & { downloadId: string }>,
    ) {
      const { downloadId, ...fields } = action.payload
      const target = state.find((i) => i.downloadId === downloadId)
      if (target) {
        Object.assign(target, fields)
      }
    },
    /**
     * Removes a single queue item by download ID.
     *
     * @param state - Current queue state
     * @param action - Action containing the download ID to remove
     */
    clearQueueItem(state, action: PayloadAction<string>) {
      return state.filter((i) => i.downloadId !== action.payload)
    },
  },
})

export const {
  enqueue,
  dequeue,
  clearQueue,
  updateQueueStatus,
  updateQueueItem,
  clearQueueItem,
} = queueSlice.actions
export default queueSlice.reducer

/**
 * Selects download ID by part index from queue.
 *
 * Extracts part index from downloadId using regex pattern `-p(\d+)$`.
 * Returns the download ID if found and matches the part index.
 *
 * @param state - Redux root state
 * @param partIndex - Zero-based part index (will match +1 in downloadId)
 * @returns Download ID if found, undefined otherwise
 */
export const selectDownloadIdByPartIndex = (
  state: { queue: QueueItem[] },
  partIndex: number,
): string | undefined => {
  return state.queue.find((item) => {
    const match = item.downloadId.match(/-p(\d+)$/)
    return match && parseInt(match[1], 10) === partIndex + 1
  })?.downloadId
}
